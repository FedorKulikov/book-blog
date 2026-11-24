import { toPlainText } from '@/lib/text'

const OPEN_LIBRARY_BASE = 'https://openlibrary.org'
const OPEN_LIBRARY_REVALIDATE_SECONDS = 60 * 60 * 24 * 30
const OPEN_LIBRARY_TIMEOUT_MS = 8_000

export type OpenLibraryBookDetails = {
  description: string | null
  year: number | null
  subjects: string[]
}

type SearchDocument = {
  key?: string
  title?: string
  first_publish_year?: number
  subject?: string[]
}

type SearchResponse = { docs?: SearchDocument[] }
type WorkResponse = {
  description?: string | { value?: string }
  subjects?: string[]
}

const EMPTY_DETAILS: OpenLibraryBookDetails = {
  description: null,
  year: null,
  subjects: [],
}

function normalizeTitle(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanSubjects(values: string[] | undefined): string[] {
  return Array.from(new Set(
    (values ?? [])
      .map(value => value.trim())
      .filter(value => value.length > 1 && value.length <= 60),
  )).slice(0, 8)
}

function readDescription(value: WorkResponse['description']): string | null {
  const raw = typeof value === 'string'
    ? value
    : value && typeof value.value === 'string'
      ? value.value
      : ''
  return toPlainText(raw) || null
}

/** Open Library is queried for a human page request; responses are cached for 30 days. */
export async function getOpenLibraryBookDetails(
  title: string,
  author: string | null,
  options: { includeDescription?: boolean } = {},
): Promise<OpenLibraryBookDetails> {
  const normalizedTitle = normalizeTitle(title)
  if (!normalizedTitle) return EMPTY_DETAILS

  try {
    const params = new URLSearchParams({
      title,
      fields: 'key,title,first_publish_year,subject',
      limit: '10',
    })
    if (author?.trim()) params.set('author', author.trim())

    const searchResponse = await fetch(
      OPEN_LIBRARY_BASE + '/search.json?' + params.toString(),
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'BuklebBookPage/1.0 (+https://bukleb.ru)',
        },
        next: { revalidate: OPEN_LIBRARY_REVALIDATE_SECONDS },
        signal: AbortSignal.timeout(OPEN_LIBRARY_TIMEOUT_MS),
      },
    )

    if (!searchResponse.ok) return EMPTY_DETAILS

    const searchData = await searchResponse.json() as SearchResponse
    const match = searchData.docs?.find(document =>
      typeof document.title === 'string' &&
      normalizeTitle(document.title) === normalizedTitle,
    )
    if (!match) return EMPTY_DETAILS

    let description: string | null = null
    let subjects = cleanSubjects(match.subject)

    if (options.includeDescription) {
      const key = match.key?.startsWith('/')
        ? match.key
        : match.key
          ? '/works/' + match.key
          : ''

      if (/^\/works\/OL[0-9]+W$/.test(key)) {
        const workResponse = await fetch(OPEN_LIBRARY_BASE + key + '.json', {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'BuklebBookPage/1.0 (+https://bukleb.ru)',
          },
          next: { revalidate: OPEN_LIBRARY_REVALIDATE_SECONDS },
          signal: AbortSignal.timeout(OPEN_LIBRARY_TIMEOUT_MS),
        })

        if (workResponse.ok) {
          const work = await workResponse.json() as WorkResponse
          description = readDescription(work.description)
          subjects = cleanSubjects([...(subjects ?? []), ...(work.subjects ?? [])])
        }
      }
    }

    return {
      description,
      year: Number.isInteger(match.first_publish_year)
        ? match.first_publish_year as number
        : null,
      subjects,
    }
  } catch {
    // Open Library is optional: an outage must not break the book page.
    return EMPTY_DETAILS
  }
}
