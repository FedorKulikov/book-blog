import { toPlainText } from '@/lib/text'

export const MIN_BOOK_DESCRIPTION_LENGTH = 120
export const MIN_INDEXABLE_BOOK_DESCRIPTION_LENGTH = 300
export const MIN_SIMILAR_BOOKS = 3
export const MAX_SIMILAR_BOOKS = 5

export type SimilarBook = {
  id: string
  title: string
  author: string | null
  year?: number | string | null
  cover_url?: string | null
}

/** Existing catalog enrichment threshold used for the Open Library fallback. */
export function hasBookDescription(description: string | null | undefined): boolean {
  return toPlainText(description ?? '').length >= MIN_BOOK_DESCRIPTION_LENGTH
}

export function hasAnyBookDescription(description: string | null | undefined): boolean {
  return toPlainText(description ?? '').trim().length > 0
}

export function hasLongBookDescription(description: string | null | undefined): boolean {
  return toPlainText(description ?? '').length >= MIN_INDEXABLE_BOOK_DESCRIPTION_LENGTH
}

function normalizeAuthor(author: string | null | undefined): string {
  return (author ?? '')
    .normalize('NFKC')
    .replace(/ё/gi, 'е')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('ru-RU')
}

/** Recommendations remain a reader aid and do not affect indexability. */
export function getSimilarBooks(
  book: Pick<SimilarBook, 'id' | 'author'>,
  candidates: SimilarBook[],
): SimilarBook[] {
  const author = normalizeAuthor(book.author)
  if (!author) return []

  const matches = candidates
    .filter(candidate =>
      candidate.id !== book.id &&
      normalizeAuthor(candidate.author) === author &&
      Boolean(candidate.title?.trim()),
    )
    .sort((a, b) => a.title.localeCompare(b.title, 'ru', { sensitivity: 'base' }))

  return matches.length >= MIN_SIMILAR_BOOKS
    ? matches.slice(0, MAX_SIMILAR_BOOKS)
    : []
}

/**
 * Index if there is some unique description and either:
 * - a 300+ character description with a cover; or
 * - at least one approved publication linked to this book.
 * Similar-book and discussion UI blocks do not participate in this rule.
 */
export function isBookIndexable(
  description: string | null | undefined,
  coverUrl: string | null | undefined,
  approvedPostsCount: number,
): boolean {
  if (!hasAnyBookDescription(description)) return false

  return (
    (hasLongBookDescription(description) && Boolean(coverUrl?.trim())) ||
    approvedPostsCount > 0
  )
}
