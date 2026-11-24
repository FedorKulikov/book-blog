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
  cleanOpenLibraryDescription,
  normalizeBookTitle,
  selectBookDescriptionCandidates,
  type BookForDescriptionEnrichment,
} from '../lib/book-description-enrichment'

const OPEN_LIBRARY_BASE = 'https://openlibrary.org'
const OPEN_LIBRARY_TIMEOUT_MS = 8_000
const OPEN_LIBRARY_DELAY_MS = 350
const DESCRIPTION_PAGE_SIZE = 500

type SearchDocument = {
  key?: string
  title?: string
  author_name?: string[]
  first_publish_year?: number
}

type SearchResponse = { docs?: SearchDocument[] }
type WorkResponse = { description?: string | { value?: string } }

type LookupResult =
  | { status: 'found'; description: string; workKey: string }
  | { status: 'no_exact_match' }
  | { status: 'year_mismatch' }
  | { status: 'no_work_key' }
  | { status: 'no_description' }
  | { status: 'description_too_short'; descriptionLength: number }
  | { status: 'api_error'; detail: string }

type ReportRow = {
  id: string
  title: string
  status: string
  oldLength: number
  newLength?: number
  workKey?: string
  detail?: string
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
  const params = new URLSearchParams({
    title: book.title,
    fields: 'key,title,author_name,first_publish_year',
    limit: '10',
  })
  if (book.author?.trim()) params.set('author', book.author.trim())

  try {
    const search = await fetchJson<SearchResponse>(
      OPEN_LIBRARY_BASE + '/search.json?' + params.toString(),
    )
    const exactMatches = (search?.docs ?? []).filter(document =>
      typeof document.title === 'string' &&
      normalizeBookTitle(document.title) === normalizeBookTitle(book.title),
    )

    if (exactMatches.length === 0) return { status: 'no_exact_match' }

    const expectedYear = book.year
    const compatibleMatches = exactMatches.filter(document =>
      !expectedYear ||
      !document.first_publish_year ||
      Math.abs(document.first_publish_year - expectedYear) <= 2,
    )
    if (compatibleMatches.length === 0) return { status: 'year_mismatch' }

    const match = compatibleMatches[0]
    const workKey = match?.key?.split('/').filter(Boolean).at(-1)
    if (!workKey || !/^OL\d+W$/.test(workKey)) {
      return { status: 'no_work_key' }
    }

    const work = await fetchJson<WorkResponse>(
      OPEN_LIBRARY_BASE + '/works/' + workKey + '.json',
    )
    const rawDescription = getDescriptionValue(work?.description)
    if (!rawDescription.trim()) return { status: 'no_description' }

    const description = cleanOpenLibraryDescription(rawDescription)
    if (description.length < 300) {
      return { status: 'description_too_short', descriptionLength: description.length }
    }

    return { status: 'found', description, workKey }
  } catch (error) {
    return {
      status: 'api_error',
      detail: error instanceof Error ? error.message : 'unknown error',
    }
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
        .limit(5000),
    ])

  if (booksError) throw new Error('books select failed: ' + booksError.message)
  if (postsError) throw new Error('approved posts select failed: ' + postsError.message)
  if ((books ?? []).length >= DESCRIPTION_PAGE_SIZE) {
    throw new Error('Book inventory reached safety limit; refusing partial backfill')
  }
  if ((linkedPosts ?? []).length >= 5000) {
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

  const report: ReportRow[] = []
  let updated = 0

  for (const book of candidates) {
    const oldLength = book.description?.length ?? 0
    const lookup = await lookupOpenLibraryDescription(book)

    if (lookup.status !== 'found') {
      report.push({
        id: book.id,
        title: book.title,
        status: lookup.status,
        oldLength,
        ...(lookup.status === 'api_error' ? { detail: lookup.detail } : {}),
        ...(lookup.status === 'description_too_short'
          ? { newLength: lookup.descriptionLength }
          : {}),
      })
      log(book.title + ': ' + lookup.status)
      await sleep(OPEN_LIBRARY_DELAY_MS)
      continue
    }

    const original = book.description ?? ''
    const mergedDescription = appendOpenLibraryDescription(
      original,
      lookup.description,
      lookup.workKey,
    )
    if (!mergedDescription) {
      report.push({
        id: book.id,
        title: book.title,
        status: 'description_not_appended',
        oldLength,
        workKey: lookup.workKey,
      })
      await sleep(OPEN_LIBRARY_DELAY_MS)
      continue
    }

    if (apply) {
      const { data: updatedRows, error: updateError } = await supabase
        .from('books')
        .update({ description: mergedDescription })
        .eq('id', book.id)
        .eq('description', original)
        .select('id')

      if (updateError) {
        report.push({
          id: book.id,
          title: book.title,
          status: 'update_error',
          oldLength,
          workKey: lookup.workKey,
        })
        log(book.title + ': update_error=' + updateError.message)
      } else if ((updatedRows ?? []).length !== 1) {
        report.push({
          id: book.id,
          title: book.title,
          status: 'changed_concurrently',
          oldLength,
          workKey: lookup.workKey,
        })
        log(book.title + ': changed_concurrently; no overwrite')
      } else {
        updated++
        report.push({
          id: book.id,
          title: book.title,
          status: 'updated',
          oldLength,
          newLength: mergedDescription.length,
          workKey: lookup.workKey,
        })
        log(book.title + ': updated; chars=' + mergedDescription.length)
      }
    } else {
      report.push({
        id: book.id,
        title: book.title,
        status: 'ready',
        oldLength,
        newLength: mergedDescription.length,
        workKey: lookup.workKey,
      })
      log(book.title + ': ready; chars=' + mergedDescription.length)
    }

    await sleep(OPEN_LIBRARY_DELAY_MS)
  }

  const counts = report.reduce<Record<string, number>>((result, row) => {
    result[row.status] = (result[row.status] ?? 0) + 1
    return result
  }, {})
  const descriptionsFound = report.filter(row => Boolean(row.workKey)).length

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    totalCandidates: candidates.length,
    descriptionsFound,
    updated,
    withoutSuitableOpenLibraryDescription: candidates.length - descriptionsFound,
    updatesNotSaved: apply ? descriptionsFound - updated : null,
    counts,
    manualBooks: report
      .filter(row => !row.workKey)
      .map(row => ({ id: row.id, title: row.title, status: row.status })),
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
