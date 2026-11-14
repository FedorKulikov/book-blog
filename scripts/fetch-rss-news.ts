/**
 * scripts/fetch-rss-news.ts
 *
 * Забирает новые книги из RSS-ленты «Литрес» и складывает их в public.external_news.
 * Скрипт полностью автономен: он НЕ участвует в сборке сайта и не импортирует
 * код приложения, поэтому его падение ничего не ломает.
 *
 * Запуск:
 *   npx tsx scripts/fetch-rss-news.ts            # боевой режим (нужны env)
 *   npx tsx scripts/fetch-rss-news.ts --dry-run  # только распарсить и показать
 *
 * Переменные окружения:
 *   SUPABASE_URL                — адрес проекта (или NEXT_PUBLIC_SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY   — service_role ключ (bypass RLS, только в CI!)
 *   RSS_FEED_URL                — опционально, по умолчанию https://www.litres.ru/rss/
 */
import Parser from 'rss-parser'
import { createClient } from '@supabase/supabase-js'

const FEED_URL = process.env.RSS_FEED_URL ?? 'https://www.litres.ru/rss/'
const SOURCE = 'Литрес'
const MAX_ITEMS_PER_RUN = 30
const FETCH_TIMEOUT_MS = 30_000
const TITLE_MAX = 200
const SUMMARY_MAX = 300

const DRY_RUN = process.argv.includes('--dry-run')

/* ------------------------------------------------------------------ */
/* Типы RSS (только то, что реально используем)                        */
/* ------------------------------------------------------------------ */

type FeedItemLike = {
  title?: string
  link?: string
  description?: string
  contentSnippet?: string
  content?: string
  isoDate?: string
  pubDate?: string
}

type FeedMeta = {
  title?: string
}

type NewRow = {
  title: string
  url: string
  source: string
  summary: string | null
  created_at: string
}

/* ------------------------------------------------------------------ */
/* Утилиты                                                             */
/* ------------------------------------------------------------------ */

function log(...args: unknown[]): void {
  console.log('[fetch-rss]', ...args)
}

function logError(...args: unknown[]): void {
  console.error('[fetch-rss]', ...args)
}

/** Грубое, но безопасное вычищение HTML из description */
function stripHtml(input: string): string {
  return input
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  return value.slice(0, max - 1).trimEnd() + '…'
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/** Дата публикации из RSS: isoDate приоритетнее pubDate, иначе «сейчас» */
function itemDate(item: FeedItemLike): string {
  const raw = item.isoDate ?? item.pubDate
  if (raw) {
    const parsed = new Date(raw)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  }
  return new Date().toISOString()
}

/* ------------------------------------------------------------------ */
/* Загрузка и парсинг                                                  */
/* ------------------------------------------------------------------ */

async function loadFeed(): Promise<{ feedTitle: string; items: FeedItemLike[] }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(FEED_URL, {
      // Заголовки обычного браузера: Литрес отдаёт 403 на «ботоподобные»
      // запросы из датацентров (GitHub Actions). Referer + Accept-Language
      // заметно снижают шанс попасть под фильтр.
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
        'Referer': 'https://www.litres.ru/',
        'Cache-Control': 'no-cache',
      },
      signal: controller.signal,
      redirect: 'follow',
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`)
    }

    const xml = await response.text()

    // Быстрая проверка, что нам отдали именно ленту, а не HTML-заглушку
    if (!xml.includes('<rss') && !xml.includes('<feed')) {
      throw new Error('ответ не похож на RSS/Atom (нет <rss> или <feed>)')
    }

    const parser = new Parser<FeedMeta, FeedItemLike>()
    const parsed = await parser.parseString(xml)

    return {
      feedTitle: parsed.title ?? 'RSS',
      items: parsed.items ?? [],
    }
  } finally {
    clearTimeout(timer)
  }
}

/** Нормализует сырые items в строки таблицы и чистит дубли внутри пачки */
function buildRows(items: FeedItemLike[]): NewRow[] {
  const seen = new Set<string>()
  const rows: NewRow[] = []

  for (const item of items) {
    const rawTitle = (item.title ?? '').trim()
    const url = (item.link ?? '').trim()

    if (!rawTitle || !url) continue
    if (!isHttpUrl(url)) continue
    if (seen.has(url)) continue
    seen.add(url)

    const rawSummary = stripHtml(
      item.contentSnippet ?? item.description ?? item.content ?? '',
    )

    rows.push({
      title: truncate(stripHtml(rawTitle), TITLE_MAX),
      url,
      source: SOURCE,
      summary: rawSummary ? truncate(rawSummary, SUMMARY_MAX) : null,
      // В таблице нет отдельного published_at: created_at = дата публикации,
      // чтобы лента на сайте сортировалась по свежести книг, а не по времени импорта.
      created_at: itemDate(item),
    })
  }

  return rows
}

/* ------------------------------------------------------------------ */
/* Запись в Supabase                                                   */
/* ------------------------------------------------------------------ */

async function saveRows(rows: NewRow[]): Promise<void> {
  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      'не заданы SUPABASE_URL (или NEXT_PUBLIC_SUPABASE_URL) и SUPABASE_SERVICE_ROLE_KEY',
    )
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const urls = rows.map(r => r.url)

  // Один запрос вместо N: забираем уже известные url
  const { data: existing, error: selectError } = await supabase
    .from('external_news')
    .select('url')
    .in('url', urls)

  if (selectError) {
    throw new Error(`не удалось проверить дубликаты: ${selectError.message}`)
  }

  const known = new Set(
    ((existing ?? []) as { url: string }[]).map(row => row.url),
  )
  const fresh = rows.filter(row => !known.has(row.url))

  if (fresh.length === 0) {
    log(`новых записей нет (проверено ${rows.length}, все уже в базе)`)
    return
  }

  const { error: insertError } = await supabase
    .from('external_news')
    .insert(fresh)

  if (insertError) {
    throw new Error(`не удалось вставить записи: ${insertError.message}`)
  }

  log(`добавлено записей: ${fresh.length} (пропущено дубликатов: ${rows.length - fresh.length})`)
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  log(`источник: ${FEED_URL}${DRY_RUN ? ' (dry-run)' : ''}`)

  const { feedTitle, items } = await loadFeed()
  log(`лента: «${feedTitle}», записей в фиде: ${items.length}`)

  const rows = buildRows(items).slice(0, MAX_ITEMS_PER_RUN)

  if (rows.length === 0) {
    log('в ленте нет пригодных записей — выходим без изменений')
    return
  }

  if (DRY_RUN) {
    log(`dry-run: распознано ${rows.length} записей, в базу не пишем`)
    for (const row of rows.slice(0, 5)) {
      log(
        `  • ${row.title} | ${row.source} | ${row.created_at} | ${row.url}` +
          (row.summary ? `\n    ${truncate(row.summary, 90)}` : ''),
      )
    }
    return
  }

  await saveRows(rows)
}

main().catch((error: unknown) => {
  logError('ОШИБКА:', error instanceof Error ? error.message : error)
  // Ненулевой код: GitHub Actions покажет красный запуск, сайт это не затрагивает
  process.exitCode = 1
})
