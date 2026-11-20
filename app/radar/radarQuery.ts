// app/radar/radarQuery.ts
// Данные «Книжного радара»: тренды недели, главное сейчас, мировая полка
// и афиша. Всё на серверных запросах, с деградацией: если колонки или таблицы
// ещё нет (миграция не применена) — блок просто не показывается.
import type { SupabaseClient } from '@supabase/supabase-js'

/** Одна тема, имя или книжное название из трендов радара */
export type TrendItem = {
  topic: string
  kind: 'theme' | 'name' | 'book'
  mentions: number
}

/** Новость для блоков радара */
export type RadarNewsItem = {
  id: string
  /** Русский заголовок, если редактор его вписал */
  titleRu: string | null
  title: string
  url: string
  source: string | null
  cover: string | null
  createdAt: string
  lang: string
  isForeign: boolean
}

const RADAR_SELECT =
  'id, title, title_ru, url, source, cover_url, created_at, lang, news_category'
/**
 * Минимальный набор: работает даже если ни одна из миграций портала
 * (news_category, lang, title_ru) ещё не применена.
 */
const RADAR_SELECT_LEGACY = 'id, title, url, source, cover_url, created_at'

type RadarRow = {
  id: string
  title: string
  title_ru?: string | null
  url: string
  source: string | null
  cover_url: string | null
  created_at: string
  lang?: string | null
  news_category?: string | null
}

function isMissingColumn(message: string, code?: string): boolean {
  return code === '42703' || /column .* does not exist/i.test(message)
}

function toItem(row: RadarRow): RadarNewsItem {
  const lang = row.lang ?? 'ru'

  return {
    id: row.id,
    titleRu: row.title_ru ?? null,
    title: row.title,
    url: row.url,
    source: row.source,
    cover: row.cover_url,
    createdAt: row.created_at,
    lang,
    isForeign: lang !== 'ru',
  }
}

/**
 * Универсальная выборка: сначала пробуем с колонками радара,
 * при отсутствии колонки — с базовым набором.
 */
async function selectRows(
  supabase: SupabaseClient,
  build: (select: string) => PromiseLike<{
    data: unknown
    error: { message: string; code?: string } | null
  }>,
  fallbackBuild: (select: string) => PromiseLike<{
    data: unknown
    error: { message: string; code?: string } | null
  }>,
): Promise<{ rows: RadarRow[]; error: string | null; degraded: boolean }> {
  const first = await build(RADAR_SELECT)

  if (first.error && isMissingColumn(first.error.message, first.error.code)) {
    const second = await fallbackBuild(RADAR_SELECT_LEGACY)

    if (second.error) {
      return { rows: [], error: null, degraded: true }
    }

    return { rows: (second.data ?? []) as RadarRow[], error: null, degraded: true }
  }

  if (first.error) {
    return { rows: [], error: first.error.message, degraded: false }
  }

  return { rows: (first.data ?? []) as RadarRow[], error: null, degraded: false }
}

/** Тренды недели: темы и имена, которые чаще всего упоминались */
export async function fetchTrends(
  supabase: SupabaseClient,
): Promise<TrendItem[]> {
  const { data, error } = await supabase
    .from('news_trends')
    .select('topic, kind, mentions, period_start')
    .order('mentions', { ascending: false })
    .limit(24)

  if (error) {
    // Таблицы ещё нет (миграция не применена) — блок трендов скрываем
    return []
  }

  return (data ?? []) as unknown as TrendItem[]
}

/** «Главное сейчас»: свежие новости за последние двое суток */
export async function fetchTopNow(
  supabase: SupabaseClient,
  limit = 5,
): Promise<RadarNewsItem[]> {
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()

  const { rows, error } = await selectRows(
    supabase,
    select =>
      supabase
        .from('external_news')
        .select(select)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(limit),
    select =>
      supabase
        .from('external_news')
        .select(select)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(limit),
  )

  if (error) console.error('[radar] top now failed:', error)

  return rows.map(toItem)
}

/** «Мировая полка»: зарубежные материалы, свежие сверху */
export async function fetchWorldShelf(
  supabase: SupabaseClient,
  limit = 6,
): Promise<RadarNewsItem[]> {
  const { rows, error } = await selectRows(
    supabase,
    select =>
      supabase
        .from('external_news')
        .select(select)
        .eq('lang', 'en')
        .order('created_at', { ascending: false })
        .limit(limit),
    // До миграции язык неизвестен: показываем просто свежие новости
    select =>
      supabase
        .from('external_news')
        .select(select)
        .order('created_at', { ascending: false })
        .limit(limit),
  )

  if (error) console.error('[radar] world shelf failed:', error)

  return rows.map(toItem)
}

export type EventBucket = {
  title: string
  items: RadarNewsItem[]
}

/** Афиша: анонсы, сгруппированные по свежести */
export async function fetchEventCalendar(
  supabase: SupabaseClient,
  limit = 12,
): Promise<EventBucket[]> {
  const { rows, error, degraded } = await selectRows(
    supabase,
    select =>
      supabase
        .from('external_news')
        .select(select)
        .eq('news_category', 'event')
        .order('created_at', { ascending: false })
        .limit(limit),
    select =>
      supabase
        .from('external_news')
        .select(select)
        .order('created_at', { ascending: false })
        .limit(limit * 3),
  )

  if (error) console.error('[radar] events failed:', error)

  // Рубрики в базе нет — отбираем анонсы по словам в заголовке
  const EVENT_RE = /(анонс|афиш|встреч|презентац|лекци|фестивал|ярмарк|выставк|концерт)/i
  const source = degraded ? rows.filter(row => EVENT_RE.test(row.title)) : rows

  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000

  const fresh = source.filter(row => new Date(row.created_at).getTime() >= weekAgo)
  const older = source.filter(row => new Date(row.created_at).getTime() < weekAgo)

  const buckets: EventBucket[] = []

  if (fresh.length > 0) {
    buckets.push({ title: 'Свежие анонсы', items: fresh.slice(0, limit).map(toItem) })
  }
  if (older.length > 0) {
    buckets.push({ title: 'Ранее', items: older.slice(0, limit).map(toItem) })
  }

  return buckets
}
