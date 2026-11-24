import { toPlainText } from '@/lib/text'

export const MIN_BOOK_DESCRIPTION_LENGTH = 120
export const MIN_SIMILAR_BOOKS = 3
export const MAX_SIMILAR_BOOKS = 5

export type SimilarBook = {
  id: string
  title: string
  author: string | null
  year?: number | string | null
  cover_url?: string | null
}

export function hasBookDescription(description: string | null | undefined): boolean {
  return toPlainText(description ?? '').length >= MIN_BOOK_DESCRIPTION_LENGTH
}

function normalizeAuthor(author: string | null | undefined): string {
  return (author ?? '')
    .normalize('NFKC')
    .replace(/ё/gi, 'е')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('ru-RU')
}

/** Возвращаем только полноценный список из 3–5 книг того же автора. */
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

/** Одно правило применяется и в metadata страницы, и в sitemap. */
export function isBookIndexable(
  description: string | null | undefined,
  similarBooksCount: number,
  approvedPostsCount: number,
): boolean {
  if (!hasBookDescription(description)) return false
  return similarBooksCount >= MIN_SIMILAR_BOOKS || approvedPostsCount > 0
}
