import { toPlainText } from '@/lib/text'

export const MIN_EXISTING_DESCRIPTION_LENGTH = 120
export const MAX_EXISTING_DESCRIPTION_LENGTH = 299
export const MIN_OPEN_LIBRARY_DESCRIPTION_LENGTH = 300
export const OPEN_LIBRARY_DESCRIPTION_MARKER = 'Дополнение из Open Library'

export type BookForDescriptionEnrichment = {
  id: string
  title: string
  author: string | null
  year: number | null
  description: string | null
  cover_url: string | null
}

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
