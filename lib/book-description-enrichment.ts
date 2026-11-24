import { toPlainText } from '@/lib/text'

export const MIN_EXISTING_DESCRIPTION_LENGTH = 120
export const MAX_EXISTING_DESCRIPTION_LENGTH = 299
export const MIN_OPEN_LIBRARY_DESCRIPTION_LENGTH = 300
export const MINIMUM_DESCRIPTIONS_TO_APPLY = 5
export const OPEN_LIBRARY_DESCRIPTION_MARKER = 'Дополнение из Open Library'

export type BookForDescriptionEnrichment = {
  id: string
  title: string
  author: string | null
  year: number | null
  description: string | null
  cover_url: string | null
}

export type OpenLibraryAuthorDocument = {
  key?: string
  name?: string
  alternate_names?: string[]
}

export type OpenLibrarySearchDocument = {
  key?: string
  title?: string
  author_key?: string[]
  author_name?: string[]
  first_publish_year?: number
}

export type BookTitleMatchType = 'exact' | 'contained'

export type OpenLibraryWorkMatchSelection =
  | {
      status: 'matched'
      document: OpenLibrarySearchDocument
      titleMatch: BookTitleMatchType
      yearDifference: number | null
    }
  | { status: 'no_author_match' | 'no_title_match' }

export function selectBookDescriptionCandidates(
  books: BookForDescriptionEnrichment[],
  approvedBookIds: ReadonlySet<string>,
): BookForDescriptionEnrichment[] {
  return books.filter(book => {
    const descriptionLength = toPlainText(book.description ?? '').length

    return (
      descriptionLength >= MIN_EXISTING_DESCRIPTION_LENGTH &&
      descriptionLength <= MAX_EXISTING_DESCRIPTION_LENGTH &&
      Boolean(book.cover_url?.trim()) &&
      !approvedBookIds.has(book.id) &&
      !(book.description ?? '').includes(OPEN_LIBRARY_DESCRIPTION_MARKER)
    )
  })
}

export function normalizeBookTitle(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeBookAuthor(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function getBookTitleMatchType(
  bookTitle: string,
  openLibraryTitle: string,
): BookTitleMatchType | null {
  const expected = normalizeBookTitle(bookTitle)
  const actual = normalizeBookTitle(openLibraryTitle)

  if (!expected || !actual) return null
  if (expected === actual) return 'exact'

  const paddedExpected = ' ' + expected + ' '
  const paddedActual = ' ' + actual + ' '
  return paddedActual.includes(paddedExpected) || paddedExpected.includes(paddedActual)
    ? 'contained'
    : null
}

function normalizeOpenLibraryAuthorKey(value: string): string {
  const key = value.split('/').filter(Boolean).at(-1) ?? ''
  return /^OL\d+A$/.test(key) ? key : ''
}

/**
 * Match authors through Open Library's canonical author record and its
 * alternate_names. The exact normalized catalog author must occur in that
 * record; a fuzzy search result alone is never enough to accept a book.
 */
export function selectOpenLibraryWorkMatch(
  book: Pick<BookForDescriptionEnrichment, 'title' | 'author' | 'year'>,
  authorDocuments: OpenLibraryAuthorDocument[],
  searchDocuments: OpenLibrarySearchDocument[],
): OpenLibraryWorkMatchSelection {
  const expectedAuthor = normalizeBookAuthor(book.author ?? '')
  if (!expectedAuthor) return { status: 'no_author_match' }

  const matchedAuthors = authorDocuments.filter(author =>
    [author.name, ...(author.alternate_names ?? [])]
      .filter((name): name is string => typeof name === 'string')
      .some(name => normalizeBookAuthor(name) === expectedAuthor),
  )

  const authorKeys = new Set(
    matchedAuthors
      .map(author => normalizeOpenLibraryAuthorKey(author.key ?? ''))
      .filter(Boolean),
  )
  const authorAliases = new Set(
    matchedAuthors
      .flatMap(author => [author.name, ...(author.alternate_names ?? [])])
      .filter((name): name is string => typeof name === 'string')
      .map(normalizeBookAuthor)
      .filter(Boolean),
  )

  if (authorKeys.size === 0 && authorAliases.size === 0) {
    return { status: 'no_author_match' }
  }

  const authoredDocuments = searchDocuments.filter(document => {
    const documentAuthorKeys = (document.author_key ?? [])
      .map(normalizeOpenLibraryAuthorKey)
      .filter(Boolean)

    if (documentAuthorKeys.length > 0) {
      return documentAuthorKeys.some(key => authorKeys.has(key))
    }

    return (document.author_name ?? [])
      .some(name => authorAliases.has(normalizeBookAuthor(name)))
  })

  if (authoredDocuments.length === 0) return { status: 'no_author_match' }

  const titleMatches = authoredDocuments
    .map(document => ({
      document,
      titleMatch: getBookTitleMatchType(book.title, document.title ?? ''),
    }))
    .filter(
      (match): match is {
        document: OpenLibrarySearchDocument
        titleMatch: BookTitleMatchType
      } => match.titleMatch !== null,
    )

  if (titleMatches.length === 0) return { status: 'no_title_match' }

  titleMatches.sort((left, right) => {
    if (left.titleMatch !== right.titleMatch) {
      return left.titleMatch === 'exact' ? -1 : 1
    }

    const leftYearDifference =
      book.year && left.document.first_publish_year
        ? Math.abs(book.year - left.document.first_publish_year)
        : Number.MAX_SAFE_INTEGER
    const rightYearDifference =
      book.year && right.document.first_publish_year
        ? Math.abs(book.year - right.document.first_publish_year)
        : Number.MAX_SAFE_INTEGER

    return leftYearDifference - rightYearDifference
  })

  const selected = titleMatches[0]
  if (!selected) return { status: 'no_title_match' }

  return {
    status: 'matched',
    document: selected.document,
    titleMatch: selected.titleMatch,
    yearDifference:
      book.year && selected.document.first_publish_year
        ? Math.abs(book.year - selected.document.first_publish_year)
        : null,
  }
}

export function canApplyOpenLibraryDescriptions(foundCount: number): boolean {
  return Number.isSafeInteger(foundCount) && foundCount >= MINIMUM_DESCRIPTIONS_TO_APPLY
}

export function cleanOpenLibraryDescription(value: string): string {
  return value
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x([\da-f]+);/gi, (_match, hex: string) => {
      const codePoint = Number.parseInt(hex, 16)
      return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : ''
    })
    .replace(/&#(\d+);/g, (_match, decimal: string) => {
      const codePoint = Number.parseInt(decimal, 10)
      return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : ''
    })
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Append only a substantial, sourced description. The catalog annotation is
 * retained verbatim; this function never replaces or rewrites its text.
 */
export function appendOpenLibraryDescription(
  originalDescription: string,
  openLibraryDescription: string,
  workKey: string,
): string | null {
  const cleaned = cleanOpenLibraryDescription(openLibraryDescription)
  if (toPlainText(cleaned).length < MIN_OPEN_LIBRARY_DESCRIPTION_LENGTH) return null
  if (!/^OL\d+W$/.test(workKey)) return null
  if (originalDescription.includes(OPEN_LIBRARY_DESCRIPTION_MARKER)) return null

  const original = originalDescription.trim()
  if (!original) return null

  return [
    original,
    '---',
    'Дополнение из Open Library (источник: https://openlibrary.org/works/' + workKey + ')',
    cleaned,
  ].join('\n\n')
}


export type BookDescriptionSections = {
  originalDescription: string
  additionalDescription: string | null
  sourceUrl: string | null
}

/**
 * Separates the catalog annotation from the appended Open Library section for
 * presentation only. The stored description is not modified, so SEO and
 * indexability continue to use the complete original database value.
 */
export function splitBookDescription(
  description: string | null,
): BookDescriptionSections {
  const storedDescription = description ?? ''
  const markerIndex = storedDescription.indexOf(OPEN_LIBRARY_DESCRIPTION_MARKER)

  if (markerIndex < 0) {
    return {
      originalDescription: storedDescription.trim(),
      additionalDescription: null,
      sourceUrl: null,
    }
  }

  const lineStart = storedDescription.lastIndexOf('\n', markerIndex - 1) + 1
  const lineEnd = storedDescription.indexOf('\n', markerIndex)
  if (lineEnd < 0) {
    return {
      originalDescription: storedDescription.trim(),
      additionalDescription: null,
      sourceUrl: null,
    }
  }

  const headerLine = storedDescription.slice(lineStart, lineEnd).trim()
  if (!headerLine.startsWith(OPEN_LIBRARY_DESCRIPTION_MARKER)) {
    return {
      originalDescription: storedDescription.trim(),
      additionalDescription: null,
      sourceUrl: null,
    }
  }

  const sourceMatch = headerLine.match(
    /^Дополнение из Open Library\s+\(источник:\s*(https:\/\/openlibrary\.org\/works\/OL\d+W)\)$/,
  )
  const originalDescription = storedDescription
    .slice(0, lineStart)
    .trim()
    .replace(/\s*---\s*$/, '')
    .trim()
  const additionalDescription = storedDescription.slice(lineEnd + 1).trim()

  return {
    originalDescription,
    additionalDescription: additionalDescription || null,
    sourceUrl: sourceMatch?.[1] ?? null,
  }
}

function hasRussianScript(value: string): boolean {
  const letters = value.match(/\p{L}/gu) ?? []
  const cyrillicLetters = value.match(/\p{Script=Cyrillic}/gu) ?? []

  return letters.length >= 20 && cyrillicLetters.length / letters.length >= 0.25
}

function hasEnglishWordPattern(value: string): boolean {
  const words = value.toLocaleLowerCase('en').match(/[a-z]+(?:'[a-z]+)?/g) ?? []
  if (words.length < 20) return false

  const commonEnglishWords = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by',
    'for', 'from', 'had', 'has', 'have', 'he', 'her', 'his', 'in',
    'into', 'is', 'it', 'its', 'not', 'of', 'on', 'or', 'she', 'that',
    'the', 'their', 'they', 'this', 'to', 'was', 'were', 'which', 'who',
    'with',
  ])
  const commonWordCount = words.filter(word => commonEnglishWords.has(word)).length

  return commonWordCount >= 4 && commonWordCount / words.length >= 0.04
}

/**
 * A conservative script/word-pattern check used only for a reader-facing note.
 * It never changes stored content or metadata.
 */
export function isEnglishAdditionToRussianAnnotation(
  originalDescription: string,
  additionalDescription: string,
): boolean {
  return (
    hasRussianScript(originalDescription) &&
    hasEnglishWordPattern(additionalDescription)
  )
}
