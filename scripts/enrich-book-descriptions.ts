/**
 * Backfill of short book descriptions from Open Library.
 *
 * Default mode is read-only and prints the books for which a substantial
 * Open Library work description was found. Pass --apply to append it to the
 * existing public.books.description field. Existing text is preserved.
 *
 * Required environment:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage:
 *   npx tsx scripts/enrich-book-descriptions.ts
 *   npx tsx scripts/enrich-book-descriptions.ts --apply
 */
import { createClient } from '@supabase/supabase-js'
import {
  appendOpenLibraryDescription,
  canApplyOpenLibraryDescriptions,
  cleanOpenLibraryDescription,
  selectBookDescriptionCandidates,
  selectOpenLibraryWorkMatch,
  type BookForDescriptionEnrichment,
  type OpenLibraryAuthorDocument,
  type OpenLibrarySearchDocument,
} from '../lib/book-description-enrichment'

const OPEN_LIBRARY_BASE = 'https://openlibrary.org'
const OPEN_LIBRARY_TIMEOUT_MS = 8_000
const OPEN_LIBRARY_DELAY_MS = 350
const DESCRIPTION_PAGE_SIZE = 500
const APPROVED_POST_PAGE_SIZE = 5000

type AuthorSearchResponse = { docs?: OpenLibraryAuthorDocument[] }
type SearchResponse = { docs?: OpenLibrarySearchDocument[] }
type WorkResponse = { description?: string | { value?: string } }

type MatchMetadata = {
  openLibraryTitle?: string
  openLibraryAuthors?: string[]
  openLibraryYear?: number | null
  yearDifference?: number | null
  titleMatch?: 'exact' | 'contained'
  workKey?: string
}

type LookupResult =
  | ({ status: 'found'; description: string; workKey: string } & MatchMetadata)
  | ({ status: 'description_too_short'; descriptionLength: number } & MatchMetadata)
  | ({ status: 'no_author_match' | 'no_title_match' | 'no_work_key' | 'no_description' } & MatchMetadata)
  | { status: 'api_error'; detail: string }

type ReportRow = {
  id: string
  title: string
  author: string | null
  status: string
  oldLength: number
  expectedYear: number | null
  newLength?: number
  openLibraryTitle?: string
  openLibraryAuthors?: string[]
  openLibraryYear?: number | null
  yearDifference?: number | null
  titleMatch?: 'exact' | 'contained'
  workKey?: string
  detail?: string
  bookUrl: string
}

type EnrichmentPlan = {
  book: BookForDescriptionEnrichment
  oldLength: number
  lookup: LookupResult
  mergedDescription: string | null
}

function log(message: string): void {
  console.log('[book-description-enrichment]', message)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function getDescriptionValue(value: WorkResponse['description']): string {
  if (typeof value === 'string') return value
  if (value && typeof value.value === 'string') return value.value
  return ''
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'BuklebBookDescriptionBackfill/1.0 (+https://bukleb.ru)',
    },
    signal: AbortSignal.timeout(OPEN_LIBRARY_TIMEOUT_MS),
  })

  if (!response.ok) throw new Error('Open Library HTTP ' + response.status)
  return await response.json() as T
}

async function lookupOpenLibraryDescription(
  book: BookForDescriptionEnrichment,
): Promise<LookupResult> {
  if (!book.author?.trim()) return { status: 'no_author_match' }

  const authorParams = new URLSearchParams({
    q: book.author,
    fields: 'key,name,alternate_names',
    limit: '25',
  })
  const searchParams = new URLSearchParams({
    title: book.title,
    fields: 'key,title,author_key,author_name,first_publish_year',
    limit: '50',
  })

  try {
    const [authorSearch, search] = await Promise.all([
      fetchJson<AuthorSearchResponse>(
        OPEN_LIBRARY_BASE + '/search/authors.json?' + authorParams.toString(),
      ),
      fetchJson<SearchResponse>(
        OPEN_LIBRARY_BASE + '/search.json?' + searchParams.toString(),
      ),
    ])

    const selection = selectOpenLibraryWorkMatch(
      book,
      authorSearch?.docs ?? [],
      search?.docs ?? [],
    )
    if (selection.status !== 'matched') return selection

    const workKey = selection.document.key?.split('/').filter(Boolean).at(-1)
    const metadata: MatchMetadata = {
      openLibraryTitle: selection.document.title,
      openLibraryAuthors: selection.document.author_name ?? [],
      openLibraryYear: selection.document.first_publish_year ?? null,
      yearDifference: selection.yearDifference,
      titleMatch: selection.titleMatch,
      ...(workKey ? { workKey } : {}),
    }

    if (!workKey || !/^OL\d+W$/.test(workKey)) {
      return { status: 'no_work_key', ...metadata }
    }

    const work = await fetchJson<WorkResponse>(
      OPEN_LIBRARY_BASE + '/works/' + workKey + '.json',
    )
    const rawDescription = getDescriptionValue(work?.description)
    if (!rawDescription.trim()) {
      return { status: 'no_description', ...metadata }
    }

    const description = cleanOpenLibraryDescription(rawDescription)
    if (description.length < 300) {
      return {
        status: 'description_too_short',
        descriptionLength: description.length,
        ...metadata,
      }
    }

    return { status: 'found', description, workKey, ...metadata }
  } catch (error) {
    return {
      status: 'api_error',
      detail: error instanceof Error ? error.message : 'unknown error',
    }
  }
}

function toReportRow(plan: EnrichmentPlan): ReportRow {
  const { book, oldLength, lookup, mergedDescription } = plan
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    status:
      lookup.status === 'found' && !mergedDescription
        ? 'description_not_appended'
        : lookup.status === 'found'
          ? 'ready'
          : lookup.status,
    oldLength,
    expectedYear: book.year,
    ...(lookup.status === 'api_error' ? { detail: lookup.detail } : {}),
    ...('descriptionLength' in lookup ? { newLength: lookup.descriptionLength } : {}),
    ...('openLibraryTitle' in lookup && lookup.openLibraryTitle
      ? { openLibraryTitle: lookup.openLibraryTitle }
      : {}),
    ...('openLibraryAuthors' in lookup
      ? { openLibraryAuthors: lookup.openLibraryAuthors }
      : {}),
    ...('openLibraryYear' in lookup
      ? { openLibraryYear: lookup.openLibraryYear }
      : {}),
    ...('yearDifference' in lookup
      ? { yearDifference: lookup.yearDifference }
      : {}),
    ...('titleMatch' in lookup ? { titleMatch: lookup.titleMatch } : {}),
    ...('workKey' in lookup ? { workKey: lookup.workKey } : {}),
    ...(mergedDescription && lookup.status === 'found'
      ? { newLength: mergedDescription.length }
      : {}),
    bookUrl: 'https://bukleb.ru/book/' + book.id,
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const invalidArgs = args.filter(argument => argument !== '--apply')
  if (invalidArgs.length > 0) {
    throw new Error('Unsupported argument: ' + invalidArgs.join(', '))
  }
  const apply = args.includes('--apply')

  const supabaseUrl = (process.env.SUPABASE_URL ?? '').trim()
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const [{ data: books, error: booksError }, { data: linkedPosts, error: postsError }] =
    await Promise.all([
      supabase
        .from('books')
        .select('id, title, author, year, description, cover_url')
        .limit(DESCRIPTION_PAGE_SIZE),
      supabase
        .from('posts')
        .select('book_id')
        .eq('status', 'approved')
        .not('book_id', 'is', null)
        .limit(APPROVED_POST_PAGE_SIZE),
    ])

  if (booksError) throw new Error('books select failed: ' + booksError.message)
  if (postsError) throw new Error('approved posts select failed: ' + postsError.message)
  if ((books ?? []).length >= DESCRIPTION_PAGE_SIZE) {
    throw new Error('Book inventory reached safety limit; refusing partial backfill')
  }
  if ((linkedPosts ?? []).length >= APPROVED_POST_PAGE_SIZE) {
    throw new Error('Approved-post inventory reached safety limit; refusing partial backfill')
  }

  const approvedBookIds = new Set(
    (linkedPosts ?? [])
      .map(post => post.book_id)
      .filter((id): id is string => typeof id === 'string'),
  )
  const candidates = selectBookDescriptionCandidates(
    (books ?? []) as BookForDescriptionEnrichment[],
    approvedBookIds,
  )

  log('mode=' + (apply ? 'apply' : 'dry-run'))
  log('short_description_candidates=' + candidates.length)

  const plans: EnrichmentPlan[] = []
  for (const book of candidates) {
    const oldLength = book.description?.length ?? 0
    const lookup = await lookupOpenLibraryDescription(book)
    const mergedDescription =
      lookup.status === 'found'
        ? appendOpenLibraryDescription(
            book.description ?? '',
            lookup.description,
            lookup.workKey,
          )
        : null

    plans.push({ book, oldLength, lookup, mergedDescription })
    log(book.title + ': ' + (
      lookup.status === 'found'
        ? (mergedDescription ? 'ready' : 'description_not_appended')
        : lookup.status
    ))
    await sleep(OPEN_LIBRARY_DELAY_MS)
  }

  const suitablePlans = plans.filter(plan =>
    plan.lookup.status === 'found' && Boolean(plan.mergedDescription),
  )
  const descriptionsFound = suitablePlans.length
  const applyBlocked = apply && !canApplyOpenLibraryDescriptions(descriptionsFound)

  if (applyBlocked) {
    log(
      'apply_blocked: found ' + descriptionsFound +
      ' suitable descriptions; at least 5 are required. No database updates were attempted.',
    )
  }

  const report = plans.map(toReportRow)
  let updated = 0

  if (apply && !applyBlocked) {
    for (const plan of suitablePlans) {
      if (plan.lookup.status !== 'found' || !plan.mergedDescription) continue

      const original = plan.book.description ?? ''
      const { data: updatedRows, error: updateError } = await supabase
        .from('books')
        .update({ description: plan.mergedDescription })
        .eq('id', plan.book.id)
        .eq('description', original)
        .select('id')

      const row = report.find(item => item.id === plan.book.id)
      if (updateError) {
        if (row) row.status = 'update_error'
        log(plan.book.title + ': update_error=' + updateError.message)
      } else if ((updatedRows ?? []).length !== 1) {
        if (row) row.status = 'changed_concurrently'
        log(plan.book.title + ': changed_concurrently; no overwrite')
      } else {
        updated++
        if (row) {
          row.status = 'updated'
          row.newLength = plan.mergedDescription.length
        }
        log(plan.book.title + ': updated; chars=' + plan.mergedDescription.length)
      }
    }
  }

  const counts = report.reduce<Record<string, number>>((result, row) => {
    result[row.status] = (result[row.status] ?? 0) + 1
    return result
  }, {})
  const manualStatuses = new Set([
    'no_author_match',
    'no_title_match',
    'no_work_key',
    'no_description',
    'description_too_short',
    'description_not_appended',
    'api_error',
  ])

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    applyBlocked,
    minimumDescriptionsToApply: 5,
    totalCandidates: candidates.length,
    descriptionsFound,
    updated,
    withoutSuitableOpenLibraryDescription: candidates.length - descriptionsFound,
    updatesNotSaved: apply ? descriptionsFound - updated : null,
    yearDifferencesOverTwoYears: report.filter(row =>
      typeof row.yearDifference === 'number' && row.yearDifference > 2,
    ).length,
    counts,
    matchedBooks: report
      .filter(row => row.status === 'ready' || row.status === 'updated')
      .map(row => ({
        title: row.title,
        bookUrl: row.bookUrl,
        titleMatch: row.titleMatch,
        openLibraryTitle: row.openLibraryTitle,
        openLibraryAuthors: row.openLibraryAuthors,
        expectedYear: row.expectedYear,
        openLibraryYear: row.openLibraryYear,
        yearDifference: row.yearDifference,
        workKey: row.workKey,
        newLength: row.newLength,
      })),
    manualBooks: report
      .filter(row => manualStatuses.has(row.status))
      .map(row => ({
        id: row.id,
        title: row.title,
        author: row.author,
        year: row.expectedYear,
        status: row.status,
        bookUrl: row.bookUrl,
        openLibraryTitle: row.openLibraryTitle,
        openLibraryAuthors: row.openLibraryAuthors,
        openLibraryYear: row.openLibraryYear,
        yearDifference: row.yearDifference,
      })),
    report,
  }, null, 2))

  if (apply && report.some(row =>
    row.status === 'api_error' ||
    row.status === 'update_error' ||
    row.status === 'changed_concurrently',
  )) {
    throw new Error('Backfill completed with unresolved errors; inspect the report')
  }
}

main().catch(error => {
  console.error('[book-description-enrichment] failed:', error)
  process.exitCode = 1
})
