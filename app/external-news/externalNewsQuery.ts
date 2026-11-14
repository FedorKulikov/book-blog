// app/external-news/externalNewsQuery.ts
// Новости внешних источников (manual curation через админку).
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

const SELECT = 'id, title, url, source, summary, created_at'

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
 * Курсор — по created_at (сортировка DESC). Новости добавляются вручную,
 * поэтому одинаковые timestamptz практически исключены; повторная защита —
 * дедупликация по id при догрузке.
 */
export async function fetchExternalNewsPage(
  supabase: SupabaseClient,
  cursor: ExternalNewsCursor | null,
  pageSize: number = EXTERNAL_NEWS_PAGE_SIZE,
): Promise<ExternalNewsPage> {
  let query = supabase
    .from('external_news')
    .select(SELECT)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(pageSize + 1)

  if (cursor) {
    query = query.lt('created_at', cursor.createdAt)
  }

  const { data, error } = await query

  if (error) {
    console.error('[external-news] fetch failed:', error.message)
    return { items: [], hasMore: false, error: error.message }
  }

  const rows = (data ?? []) as unknown as ExternalNewsItem[]
  const hasMore = rows.length > pageSize

  return {
    items: hasMore ? rows.slice(0, pageSize) : rows,
    hasMore,
    error: null,
  }
}
