/**
 * scripts/fetch-rss-news.ts
 *
 * Забирает новые книги из RSS-ленты «Литрес», обогащает данные
 * (автор, год, обложка через Open Library; перевод на русский) и складывает
 * всё в public.external_news.
 *
 * Скрипт автономен: не участвует в сборке сайта и не импортирует код приложения,
 * поэтому его падение ничего не ломает.
 *
 * Запуск:
 *   npx tsx scripts/fetch-rss-news.ts            # боевой режим (нужны env)
 *   npx tsx scripts/fetch-rss-news.ts --dry-run  # распарсить + обогатить, без записи
 *
 * Переменные окружения:
 *   SUPABASE_URL                — адрес проекта (или NEXT_PUBLIC_SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY   — service_role ключ (bypass RLS, только в CI!)
 *   RSS_FEED_URL                — опционально, по умолчанию https://www.litres.ru/rss/
 *   ENRICH_LIMIT                — сколько записей обогащать за прогон (по умолчанию 10)
 */
import Parser from 'rss-parser'
import { createClient } from '@supabase/supabase-js'
import { translate } from '@vitalets/google-translate-api'

const FEED_URL = process.env.RSS_FEED_URL ?? 'https://www.litres.ru/rss/'
const SOURCE = 'Литрес'
const MAX_ITEMS_PER_RUN = 30
const FETCH_TIMEOUT_MS = 30_000

const TITLE_MAX = 200
const SUMMARY_MAX = 300

/** Сколько записей обогащаем за один прогон (Open Library + перевод не бесплатны по времени) */
const ENRICH_LIMIT = Number(process.env.ENRICH_LIMIT ?? '10')

/** Пауза между запросами к переводчику — чтобы не получить 429 */
const TRANSLATE_DELAY_MS = 1_000
/** Пауза между запросами к Open Library — вежливость к публичному API */
const OPENLIBRARY_DELAY_MS = 300
const OPENLIBRARY_TIMEOUT_MS = 8_000

const DRY_RUN = process.argv.includes('--dry-run')

/* ------------------------------------------------------------------ */
/* Типы                                                                */
/* ------------------------------------------------------------------ */

type FeedItemLike = {
  title?: string
  link?: string
  description?: string
  contentSnippet?: string
  content?: string
  author?: string
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
  author: string | null
  cover_url: string | null
  content_type: 'book' | 'article'
  published_year: number | null
}

type OpenLibraryHit = {
  author: string | null
  year: number | null
  coverUrl: string | null
}

/* ------------------------------------------------------------------ */
/* Утилиты                                                             */
/* ------------------------------------------------------------------ */

function log(...args: unknown[]): void {
  console.log('[fetch-rss]', ...args)
}

function logWarn(...args: unknown[]): void {
  console.warn('[fetch-rss]', ...args)
}

function logError(...args: unknown[]): void {
  console.error('[fetch-rss]', ...args)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Грубое, но безопасное вычищение HTML и раскодирование основных сущностей */
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

function hasCyrillic(value: string): boolean {
  return /[а-яё]/i.test(value)
}

/**
 * Нужен ли перевод. Простой «есть ли кириллица» не годится: у Литреса описание
 * начинается с русского слова «Аннотация:», а дальше идёт английский текст.
 * Поэтому сравниваем количество латинских и кириллических букв.
 */
function needsTranslation(value: string): boolean {
  const cyrillic = (value.match(/[а-яё]/gi) ?? []).length
  const latin = (value.match(/[a-z]/gi) ?? []).length
  if (latin === 0) return false
  return cyrillic === 0 || latin > cyrillic
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

/**
 * Литрес часто отдаёт название книги строкой «Автор: Название»
 * (в том числе на английском). Достаём автора, если он там есть.
 */
function splitAuthorFromTitle(title: string): { author: string | null; title: string } {
  const match = /^([^:]{2,60}):\s+(.+)$/.exec(title)
  if (!match) return { author: null, title }

  const possibleAuthor = (match[1] ?? '').trim()
  const rest = (match[2] ?? '').trim()

  // «Гарри Поттер: часть 2» — это не автор, поэтому фильтруем по виду:
  // автор обычно содержит инициалы/несколько слов и не содержит цифр подряд
  if (!rest || possibleAuthor.length < 3) return { author: null, title }
  if (/\d{2,}/.test(possibleAuthor)) return { author: null, title }

  return { author: possibleAuthor, title: rest }
}

/* ------------------------------------------------------------------ */
/* Open Library                                                        */
/* ------------------------------------------------------------------ */

function buildQuery(title: string, author: string | null): string {
  const parts = [title, author ?? ''].join(' ').trim()
  return parts.replace(/\s+/g, ' ')
}

async function openLibraryLookup(
  title: string,
  author: string | null,
): Promise<OpenLibraryHit | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), OPENLIBRARY_TIMEOUT_MS)

  try {
    const query = new URLSearchParams({
      q: buildQuery(title, author),
      fields: 'title,author_name,cover_i,first_publish_year',
      limit: '1',
    })

    const response = await fetch(
      `https://openlibrary.org/search.json?${query.toString()}`,
      {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      },
    )

    if (!response.ok) {
      logWarn(`Open Library: HTTP ${response.status} для «${title}»`)
      return null
    }

    const payload = (await response.json()) as {
      docs?: {
        author_name?: string[]
        cover_i?: number
        first_publish_year?: number
      }[]
    }

    const doc = payload.docs?.[0]
    if (!doc) return null

    const coverId = doc.cover_i
    return {
      author: doc.author_name?.[0] ?? null,
      year: typeof doc.first_publish_year === 'number' ? doc.first_publish_year : null,
      coverUrl: coverId
        ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg`
        : null,
    }
  } catch (error) {
    logWarn(
      'Open Library недоступен:',
      error instanceof Error ? error.message : error,
    )
    return null
  } finally {
    clearTimeout(timer)
  }
}

/* ------------------------------------------------------------------ */
/* Перевод                                                             */
/* ------------------------------------------------------------------ */

async function translateToRussian(text: string): Promise<string | null> {
  const clean = text.trim()
  if (!clean || !needsTranslation(clean)) return null

  try {
    // Google Translate (неофициальный публичный endpoint через библиотеку).
    // Лимит на длину запроса — режем длинные описания до перевода.
    const result = await translate(clean.slice(0, 1000), { to: 'ru' })
    return (result.text ?? '').trim() || null
  } catch (error) {
    logWarn(
      'перевод не удался:',
      error instanceof Error ? error.message : error,
    )
    return null
  } finally {
    // Пауза даже при ошибке: не заваливаем переводчик запросами
    await sleep(TRANSLATE_DELAY_MS)
  }
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

    const { author: authorFromTitle, title } = splitAuthorFromTitle(
      stripHtml(rawTitle),
    )
    const author = (item.author ?? '').trim() || authorFromTitle

    // Книга, если есть автор или ссылка ведёт на карточку книги/аудиокниги
    const isBook = Boolean(author) || /\/(book|audiobook)\//.test(url)

    rows.push({
      title: truncate(title, TITLE_MAX),
      url,
      source: SOURCE,
      summary: rawSummary ? truncate(stripHtml(rawSummary), SUMMARY_MAX) : null,
      // В таблице нет отдельного published_at: created_at = дата публикации,
      // чтобы лента на сайте сортировалась по свежести книг, а не по времени импорта.
      created_at: itemDate(item),
      author: author ? truncate(author, 120) : null,
      cover_url: null,
      content_type: isBook ? 'book' : 'article',
      published_year: null,
    })
  }

  return rows
}

/* ------------------------------------------------------------------ */
/* Обогащение: Open Library + перевод                                  */
/* ------------------------------------------------------------------ */

async function enrichRows(rows: NewRow[]): Promise<NewRow[]> {
  const enriched: NewRow[] = []
  const limit = Math.min(rows.length, Math.max(0, ENRICH_LIMIT))

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (!row || i >= limit) {
      if (row) enriched.push(row)
      continue
    }

    let next: NewRow = { ...row }

    // 1. Автор / год / обложка — только для книг и только если чего-то не хватает
    if (
      next.content_type === 'book' &&
      (!next.author || !next.published_year || !next.cover_url)
    ) {
      const hit = await openLibraryLookup(next.title, next.author)
      if (hit) {
        next = {
          ...next,
          author: next.author ?? hit.author,
          published_year: next.published_year ?? hit.year,
          cover_url: next.cover_url ?? hit.coverUrl,
        }
      }
      await sleep(OPENLIBRARY_DELAY_MS)
    }

    // 2. Перевод — только если текста нет кириллицы
    if (needsTranslation(next.title)) {
      const translated = await translateToRussian(next.title)
      if (translated) next.title = truncate(translated, TITLE_MAX)
    }

    if (next.summary && needsTranslation(next.summary)) {
      const translated = await translateToRussian(next.summary)
      if (translated) next.summary = truncate(translated, SUMMARY_MAX)
    }

    enriched.push(next)
  }

  return enriched
}

/* ------------------------------------------------------------------ */
/* Запись в Supabase                                                   */
/* ------------------------------------------------------------------ */

/** Базовый набор колонок — на случай, если миграция ещё не применена */
function toLegacyRow(row: NewRow) {
  return {
    title: row.title,
    url: row.url,
    source: row.source,
    summary: row.summary,
    created_at: row.created_at,
  }
}

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
    // 42703 = undefined_column: миграция из шага 3 ещё не применена
    const isMissingColumn =
      insertError.code === '42703' ||
      /column .* does not exist/i.test(insertError.message)

    if (!isMissingColumn) {
      throw new Error(`не удалось вставить записи: ${insertError.message}`)
    }

    logWarn(
      'в external_news нет новых колонок — пишем базовый набор (выполни SQL из шага 3)',
    )

    const { error: legacyError } = await supabase
      .from('external_news')
      .insert(fresh.map(toLegacyRow))

    if (legacyError) {
      throw new Error(
        `не удалось вставить записи (legacy): ${legacyError.message}`,
      )
    }
  }

  log(
    `добавлено записей: ${fresh.length} (пропущено дубликатов: ${rows.length - fresh.length})`,
  )
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  log(`источник: ${FEED_URL}${DRY_RUN ? ' (dry-run)' : ''}`)

  const { feedTitle, items } = await loadFeed()
  log(`лента: «${feedTitle}», записей в фиде: ${items.length}`)

  const baseRows = buildRows(items).slice(0, MAX_ITEMS_PER_RUN)
  if (baseRows.length === 0) {
    log('в ленте нет пригодных записей — выходим без изменений')
    return
  }

  log(
    `обогащаем первые ${Math.min(baseRows.length, ENRICH_LIMIT)} записей (Open Library + перевод)…`,
  )
  const rows = await enrichRows(baseRows)

  if (DRY_RUN) {
    log(`dry-run: распознано ${rows.length} записей, в базу не пишем`)
    for (const row of rows.slice(0, 5)) {
      log(
        `  • ${row.title}\n` +
          `    автор: ${row.author ?? '—'} | год: ${row.published_year ?? '—'} | тип: ${row.content_type}` +
          `${row.cover_url ? '\n    обложка: ' + row.cover_url : ''}` +
          `${row.summary ? '\n    ' + truncate(row.summary, 110) : ''}` +
          `\n    ${row.url}`,
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
