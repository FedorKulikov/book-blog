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

/** Порог 120 используется только для решения, нужен ли Open Library fallback. */
export function hasBookDescription(description: string | null | undefined): boolean {
  return toPlainText(description ?? '').length >= MIN_BOOK_DESCRIPTION_LENGTH
}

export function hasAnyBookDescription(description: string | null | undefined): boolean {
  return toPlainText(description ?? '').length > 0
}

function normalizeAuthor(author: string | null | undefined): string {
  return (author ?? '')
    .normalize('NFKC')
    .replace(/ё/gi, 'е')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('ru-RU')
}

/** Рекомендации остаются пользовательским блоком и не влияют на индексацию. */
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
 * Общая проверка для metadata страницы и sitemap.
 * Одобренная публикация снимает порог длины и требование обложки,
 * но пустое описание не индексируется ни при каких условиях.
 */
export function isBookIndexable(
  description: string | null | undefined,
  coverUrl: string | null | undefined,
  approvedPostsCount: number,
): boolean {
  const descriptionLength = toPlainText(description ?? '').length
  if (descriptionLength === 0) return false

  if (approvedPostsCount > 0) return true

  return (
    descriptionLength >= MIN_INDEXABLE_BOOK_DESCRIPTION_LENGTH &&
    Boolean(coverUrl?.trim())
  )
}
