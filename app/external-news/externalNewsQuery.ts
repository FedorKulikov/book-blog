// app/external-news/externalNewsQuery.ts
// Новости внешних источников (RSS-импорт + ручная модерация).
// Один модуль на серверную страницу и клиентскую догрузку.
import type { SupabaseClient } from '@supabase/supabase-js'

export const EXTERNAL_NEWS_PAGE_SIZE = 20

export type ExternalNewsItem = {
  id: string
  title: string
  url: string
  source: string
  summary: string | null
  created_at: string
  author: string | null
  cover_url: string | null
  content_type: string | null
  published_year: number | null
  /** Тип материала: «Новость» | «Анонс» | «Статья» (может быть null) */
  news_type: string | null
}

export type ExternalNewsPage = {
  items: ExternalNewsItem[]
  hasMore: boolean
  error: string | null
}

export type ExternalNewsCursor = {
  createdAt: string
  id: string
}

/** Полный набор колонок (после миграции с author/cover_url/news_type) */
const SELECT =
  'id, title, url, source, summary, created_at, author, cover_url, content_type, published_year, news_type'

/** Базовый набор — работает и до миграции */
const LEGACY_SELECT = 'id, title, url, source, summary, created_at'

export const EXTERNAL_NEWS_SELECT = SELECT
export const EXTERNAL_NEWS_LEGACY_SELECT = LEGACY_SELECT

type RawRow = Partial<ExternalNewsItem> & {
  id: string
  title: string
  url: string
  source: string
  created_at: string
}

/** Дозаполняем отсутствующие (до миграции) поля значениями по умолчанию */
export function normalizeExternalNewsRow(row: RawRow): ExternalNewsItem {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    source: row.source,
    summary: row.summary ?? null,
    created_at: row.created_at,
    author: row.author ?? null,
    cover_url: row.cover_url ?? null,
    content_type: row.content_type ?? null,
    published_year: row.published_year ?? null,
    news_type: row.news_type ?? null,
  }
}

/** 42703 = undefined_column: миграция ещё не применена */
function isMissingColumn(message: string): boolean {
  return /column .* does not exist/i.test(message) || message.includes('42703')
}

/**
 * Фиксированная таймзона: карточки рендерятся и на сервере (SSR), и в браузере,
 * поэтому без timeZone получили бы разный текст и hydration mismatch.
 */
const newsDateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  timeZone: 'Europe/Moscow',
})

export function formatNewsDate(iso: string): string {
  return newsDateFormatter.format(new Date(iso))
}

/**
 * Курсор — по created_at (сортировка DESC). Новости добавляются вручную
 * или импортом RSS, поэтому повторная защита — дедупликация по id при догрузке.
 */
export async function fetchExternalNewsPage(
  supabase: SupabaseClient,
  cursor: ExternalNewsCursor | null,
  pageSize: number = EXTERNAL_NEWS_PAGE_SIZE,
): Promise<ExternalNewsPage> {
  async function attempt(select: string) {
    let query = supabase
      .from('external_news')
      .select(select)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(pageSize + 1)

    if (cursor) {
      query = query.lt('created_at', cursor.createdAt)
    }

    return query
  }

  let { data, error } = await attempt(SELECT)

  // Колонок ещё нет (миграция не выполнена) — читаем базовый набор
  if (error && isMissingColumn(error.message)) {
    console.warn('[external-news] новые колонки отсутствуют, читаем базовый набор')
    const legacy = await attempt(LEGACY_SELECT)
    data = legacy.data
    error = legacy.error
  }

  if (error) {
    console.error('[external-news] fetch failed:', error.message)
    return { items: [], hasMore: false, error: error.message }
  }

  const rows = ((data ?? []) as unknown as RawRow[]).map(normalizeExternalNewsRow)
  const hasMore = rows.length > pageSize

  return {
    items: hasMore ? rows.slice(0, pageSize) : rows,
    hasMore,
    error: null,
  }
}
