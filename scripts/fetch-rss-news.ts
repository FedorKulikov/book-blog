/**
 * scripts/fetch-rss-news.ts
 *
 * Забирает новые книги из RSS-ленты «Литрес», обогащает данные
 * (автор, год, обложка через Open Library) и складывает
 * всё в public.external_news.
 *
 * Скрипт автономен: не участвует в сборке сайта и не импортирует код приложения,
 * поэтому его падение ничего не ломает.
 *
 * Запуск:
 *   npx tsx scripts/fetch-rss-news.ts                 # боевой режим (нужны env)
 *   npx tsx scripts/fetch-rss-news.ts --dry-run       # распарсить + обогатить, без записи
 *   npx tsx scripts/fetch-rss-news.ts --backfill      # обогатить уже сохранённые записи
 *   npx tsx scripts/fetch-rss-news.ts --purge-foreign # удалить новости без кириллицы
 *
 * Заголовки без кириллицы («Soy un gato», «Japanisch magisch einfach») не
 * импортируются вовсе: лента сайта — русскоязычная.
 *
 * Переменные окружения:
 *   SUPABASE_URL                — адрес проекта (или NEXT_PUBLIC_SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY   — service_role ключ (bypass RLS, только в CI!)
 *   RSS_FEED_URLS               — свои ленты через запятую (переопределяют список)
 *   ENRICH_LIMIT                — сколько записей обогащать за прогон (по умолчанию 10)
 */
import Parser from 'rss-parser'
import iconv from 'iconv-lite'
import { createClient } from '@supabase/supabase-js'

/* ------------------------------------------------------------------ */
/* Источники                                                           */
/* ------------------------------------------------------------------ */

type FeedSource = {
  url: string
  /** Подпись источника — попадает в колонку source */
  label: string
  /** Куда вести, если в ленте внезапно оказалась ссылка на магазин */
  siteUrl: string
}

/**
 * Качественные русскоязычные ленты.
 * Литрес убран: он отдавал карточки товаров и главные страницы вместо новостей.
 *
 * museumbook.ru отдаём по http: у него битая цепочка TLS-сертификата,
 * на https обычный fetch падает с ошибкой защищённого канала.
 */
const DEFAULT_FEEDS: FeedSource[] = [
  {
    url: 'http://www.museumbook.ru/rss2.php?feed=news',
    label: 'Музей книги',
    siteUrl: 'http://www.museumbook.ru/',
  },
  {
    url: 'http://www.museumbook.ru/rss2.php?feed=new_products&limit=10',
    label: 'Музей книги',
    siteUrl: 'http://www.museumbook.ru/',
  },
  {
    url: 'http://www.litkarta.ru/rss/channel_news/',
    label: 'Новая карта русской литературы',
    siteUrl: 'http://www.litkarta.ru/',
  },
  {
    url: 'http://www.litkarta.ru/rss/channel_afisha/',
    label: 'Афиша литературных событий',
    siteUrl: 'http://www.litkarta.ru/',
  },
  {
    url: 'https://www.eksmo.ru/feed/',
    label: 'Эксмо',
    siteUrl: 'https://eksmo.ru/',
  },
]

/** Своя лента из RSS_FEED_URLS: подпись и сайт выводим из домена */
function feedFromUrl(url: string): FeedSource {
  const parsed = new URL(url)
  return {
    url,
    label: parsed.hostname.replace(/^www\./, ''),
    siteUrl: `${parsed.protocol}//${parsed.host}/`,
  }
}

const FEEDS: FeedSource[] = (() => {
  const custom = (process.env.RSS_FEED_URLS ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)

  if (custom.length === 0) return DEFAULT_FEEDS

  const parsed: FeedSource[] = []
  for (const url of custom) {
    try {
      parsed.push(feedFromUrl(url))
    } catch {
      logWarn(`пропущен некорректный адрес из RSS_FEED_URLS: ${url}`)
    }
  }

  return parsed
})()

const MAX_ITEMS_PER_RUN = 30
const FETCH_TIMEOUT_MS = 30_000

/** Сколько записей берём из одной ленты: один источник не должен забить всю выдачу */
const MAX_ITEMS_PER_FEED = 10

/**
 * Чередует записи из лент (по одной с каждой), чтобы в топе была не только
 * одна лента. Музей книги, например, отдаёт 10 альбомов подряд.
 */
function interleave(groups: NewRow[][]): NewRow[] {
  const result: NewRow[] = []
  const longest = groups.reduce((max, group) => Math.max(max, group.length), 0)

  for (let index = 0; index < longest; index++) {
    for (const group of groups) {
      const row = group[index]
      if (row) result.push(row)
    }
  }

  return result
}

const TITLE_MAX = 200
const SUMMARY_MAX = 300

/** Сколько записей обогащаем за один прогон (запросы к Open Library не бесплатны по времени) */
const ENRICH_LIMIT = Number(process.env.ENRICH_LIMIT ?? '10')

/** Пауза между запросами к Open Library — вежливость к публичному API */
const OPENLIBRARY_DELAY_MS = 300
const OPENLIBRARY_TIMEOUT_MS = 8_000

const DRY_RUN = process.argv.includes('--dry-run')

/** --backfill: не тянем ленту, а обогащаем уже сохранённые записи */
const BACKFILL = process.argv.includes('--backfill')

/** --purge-foreign: удалить из базы записи, в заголовке которых нет кириллицы */
const PURGE_FOREIGN = process.argv.includes('--purge-foreign')

/**
 * Блог русскоязычный: заголовки без кириллицы (Soy un gato, Japanisch magisch
 * einfach) в русской ленте выглядят мусором. Фильтруем и при импорте,
 * и при очистке базы.
 */
const CYRILLIC_RE = /[а-яё]/gi
const LATIN_RE = /[a-z]/gi

/**
 * «Русский» заголовок: кириллицы минимум 3 буквы и не меньше, чем латиницы.
 * Простое «есть хоть одна кириллическая буква» пропускает немецкие книги,
 * у которых в названии встречается «и др.».
 */
function looksRussian(title: string): boolean {
  const cyrillic = (title.match(CYRILLIC_RE) ?? []).length
  if (cyrillic < 3) return false

  const latin = (title.match(LATIN_RE) ?? []).length
  return cyrillic >= latin
}

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
/* Загрузка и парсинг                                                  */
/* ------------------------------------------------------------------ */

async function loadFeed(
  feed: FeedSource,
): Promise<{ feedTitle: string; items: FeedItemLike[] }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(feed.url, {
      // Заголовки обычного браузера: часть сайтов режет «ботоподобные» запросы
      // из датацентров (GitHub Actions).
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5',
        'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
      },
      signal: controller.signal,
      redirect: 'follow',
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`)
    }

    // Ленты бывают в windows-1251 (litkarta.ru): без декодирования кириллица
    // превращается в кракозябры и фильтр «русского заголовка» отбрасывает всё.
    const buffer = Buffer.from(await response.arrayBuffer())
    const contentType = response.headers.get('content-type') ?? ''
    const charset =
      /charset=([\w-]+)/i.exec(contentType)?.[1]?.toLowerCase() ?? 'utf-8'

    const xml = /1251|cp1251|win-1251/.test(charset)
      ? iconv.decode(buffer, 'win1251')
      : buffer.toString('utf8')

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

/* ------------------------------------------------------------------ */
/* Фильтры записей                                                     */
/* ------------------------------------------------------------------ */

/** Коммерческий мусор: такие заголовки в ленте новостей не нужны */
const STOP_WORDS = [
  'купить',
  'акция',
  'скидка',
  'распродажа',
  'промокод',
  'доставка',
  'заказать',
  'цена',
  'товар',
]

/** Домены магазинов: если лента ведёт туда, подменяем ссылку на сайт источника */
const SHOP_HOSTS = ['litres.ru', 'chitai-gorod.ru']

function hasStopWord(title: string): boolean {
  const lower = title.toLowerCase()
  return STOP_WORDS.some(word => lower.includes(word))
}

/**
 * Ссылка на материал или null, если запись бесполезна.
 * - пустая ссылка или главная страница сайта → пропуск;
 * - ссылка на магазин (Литрес, Читай-город) → ссылка на сайт источника.
 */
function resolveItemLink(rawLink: string, feed: FeedSource): string | null {
  const link = rawLink.trim()
  if (!link) return null

  let parsed: URL
  try {
    parsed = new URL(link)
  } catch {
    return null
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null

  if (SHOP_HOSTS.some(host => parsed.hostname.endsWith(host))) {
    return feed.siteUrl
  }

  // «http://site.ru/» и «http://site.ru» — это главная, а не статья
  if (parsed.pathname === '/' || parsed.pathname === '') return null

  return link
}

/** Нормализует сырые items в строки таблицы и чистит дубли внутри пачки */
function buildRows(
  items: FeedItemLike[],
  feed: FeedSource,
): {
  rows: NewRow[]
  skippedForeign: number
  skippedStopWords: number
  skippedLinks: number
} {
  const seen = new Set<string>()
  const rows: NewRow[] = []
  let skippedForeign = 0
  let skippedStopWords = 0
  let skippedLinks = 0

  for (const item of items) {
    const rawTitle = (item.title ?? '').trim()
    if (!rawTitle) continue

    // Иностранные новинки в русскую ленту не берём
    if (!looksRussian(stripHtml(rawTitle))) {
      skippedForeign++
      continue
    }

    // Коммерческий мусор: «купить», «скидка», «доставка» и т.п.
    if (hasStopWord(stripHtml(rawTitle))) {
      skippedStopWords++
      continue
    }

    // Ссылка: магазины → сайт источника, главные страницы → пропуск
    const url = resolveItemLink(item.link ?? '', feed)
    if (!url) {
      skippedLinks++
      continue
    }
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
      source: feed.label,
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

  return { rows, skippedForeign, skippedStopWords, skippedLinks }
}

/* ------------------------------------------------------------------ */
/* Обогащение: Open Library                                           */
/* ------------------------------------------------------------------ */

type EnrichableRow = {
  title: string
  summary: string | null
  author: string | null
  cover_url: string | null
  content_type: string | null
  published_year: number | null
}

/** Обогащает одну запись: автор, год и обложка из Open Library */
async function enrichOne<T extends EnrichableRow>(row: T): Promise<T> {
  let next: T = { ...row }

  // Название могло сохраниться вместе с префиксом «Автор: » — разделяем,
  // иначе Open Library ищет по строке вида «Kazuo Ishiguro: Klara and the Sun»
  if (!next.author) {
    const split = splitAuthorFromTitle(next.title)
    if (split.author) {
      next = { ...next, title: split.title, author: split.author }
    }
  }

  // 1. Автор / год / обложка — только для книг и только если чего-то не хватает
  if (
    (next.content_type ?? 'book') === 'book' &&
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

  return next
}

async function enrichRows(rows: NewRow[]): Promise<NewRow[]> {
  const enriched: NewRow[] = []
  const limit = Math.min(rows.length, Math.max(0, ENRICH_LIMIT))

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (!row) continue
    enriched.push(i < limit ? await enrichOne(row) : row)
  }

  return enriched
}

/** Нужно ли дообогащать сохранённую запись (перевод больше не используем) */
function needsBackfill(row: EnrichableRow): boolean {
  return !row.author || !row.cover_url || !row.published_year
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
/* Backfill: обогащение уже сохранённых записей                        */
/* ------------------------------------------------------------------ */

async function backfill(): Promise<void> {
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

  const { data, error } = await supabase
    .from('external_news')
    .select(
      'id, title, url, summary, author, cover_url, content_type, published_year',
    )
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) {
    throw new Error(`не удалось прочитать external_news: ${error.message}`)
  }

  const rows = (data ?? []) as unknown as (EnrichableRow & {
    id: string
    url: string
  })[]

  const pending = rows.filter(needsBackfill)
  const targets = pending.slice(0, Math.max(0, ENRICH_LIMIT))

  log(
    `backfill: записей всего ${rows.length}, требуют обогащения ${pending.length}, обработаем ${targets.length}`,
  )

  if (targets.length === 0) {
    log('все записи уже обогащены — делать нечего')
    return
  }

  let updated = 0

  for (const row of targets) {
    const enriched = await enrichOne(row)

    const patch = {
      title: enriched.title,
      summary: enriched.summary,
      author: enriched.author,
      cover_url: enriched.cover_url,
      published_year: enriched.published_year,
    }

    if (DRY_RUN) {
      log(
        `  [dry] «${row.title}» → «${patch.title}» | автор: ${patch.author ?? '—'} | год: ${patch.published_year ?? '—'} | обложка: ${patch.cover_url ? 'да' : '—'}`,
      )
      continue
    }

    const { error: updateError } = await supabase
      .from('external_news')
      .update(patch)
      .eq('id', row.id)

    if (updateError) {
      logWarn(`не удалось обновить ${row.id}: ${updateError.message}`)
      continue
    }

    updated++
    log(`  ✓ «${row.title}» → «${patch.title}»`)
  }

  log(
    DRY_RUN
      ? 'dry-run: изменения не сохранены'
      : `обновлено записей: ${updated} из ${targets.length}`,
  )
}

/* ------------------------------------------------------------------ */
/* Очистка базы от иностранных новостей                                */
/* ------------------------------------------------------------------ */

/**
 * Удаляет записи, в заголовке которых нет ни одной буквы кириллицы.
 * Требует SUPABASE_SERVICE_ROLE_KEY: с anon-ключом RLS «молча» удалит
 * 0 строк (PostgREST вернёт 200 и пустой список).
 */
async function purgeForeignNews(): Promise<void> {
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

  const { data, error } = await supabase
    .from('external_news')
    .select('id, title')
    .limit(1000)

  if (error) {
    throw new Error(`не удалось прочитать external_news: ${error.message}`)
  }

  const rows = (data ?? []) as { id: string; title: string | null }[]
  const foreign = rows.filter(row => !looksRussian(row.title ?? ''))

  log(
    `записей всего: ${rows.length}, без кириллицы в заголовке: ${foreign.length}`,
  )

  if (foreign.length === 0) {
    log('нечего удалять')
    return
  }

  for (const row of foreign.slice(0, 5)) {
    log(`  • ${row.title ?? '(без названия)'}`)
  }
  if (foreign.length > 5) log(`  … и ещё ${foreign.length - 5}`)

  if (DRY_RUN) {
    log('dry-run: ничего не удалено')
    return
  }

  let deleted = 0
  const BATCH = 50

  for (let i = 0; i < foreign.length; i += BATCH) {
    const ids = foreign.slice(i, i + BATCH).map(row => row.id)

    const { data: removed, error: deleteError } = await supabase
      .from('external_news')
      .delete()
      .in('id', ids)
      .select('id')

    if (deleteError) {
      logWarn(`ошибка удаления пачки: ${deleteError.message}`)
      continue
    }

    deleted += (removed ?? []).length
  }

  log(`удалено записей: ${deleted} из ${foreign.length}`)

  if (deleted === 0) {
    logWarn(
      '0 удалённых строк: обычно это RLS — нужен ключ service_role, а не anon',
    )
  }
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  if (PURGE_FOREIGN) {
    log(`режим: purge-foreign${DRY_RUN ? ' (dry-run)' : ''}`)
    await purgeForeignNews()
    return
  }

  if (BACKFILL) {
    log(`режим: backfill${DRY_RUN ? ' (dry-run)' : ''}`)
    await backfill()
    return
  }

  log(`источников: ${FEEDS.length}${DRY_RUN ? ' (dry-run)' : ''}`)

  const groups: NewRow[][] = []
  let skippedForeign = 0
  let skippedStopWords = 0
  let skippedLinks = 0

  for (const feed of FEEDS) {
    try {
      const { feedTitle, items } = await loadFeed(feed)
      const result = buildRows(items, feed)
      const limited = result.rows.slice(0, MAX_ITEMS_PER_FEED)

      groups.push(limited)
      skippedForeign += result.skippedForeign
      skippedStopWords += result.skippedStopWords
      skippedLinks += result.skippedLinks

      log(
        `«${feedTitle}» (${feed.label}): записей ${items.length}, принято ${limited.length}`,
      )
    } catch (error) {
      // Одна упавшая лента не должна ломать весь импорт
      logWarn(
        `источник ${feed.url} пропущен: ${error instanceof Error ? error.message : error}`,
      )
    }
  }

  log(
    `отфильтровано: иностранных ${skippedForeign}, стоп-слов ${skippedStopWords}, ` +
      `пустых/главных ссылок ${skippedLinks}`,
  )

  // Дубли между лентами (одна новость может прийти из news и afisha)
  const uniqueByUrl = new Map<string, NewRow>()
  for (const row of interleave(groups)) {
    if (!uniqueByUrl.has(row.url)) uniqueByUrl.set(row.url, row)
  }

  const baseRows = [...uniqueByUrl.values()].slice(0, MAX_ITEMS_PER_RUN)
  if (baseRows.length === 0) {
    log('в лентах нет пригодных записей — выходим без изменений')
    return
  }

  log(
    `обогащаем первые ${Math.min(baseRows.length, ENRICH_LIMIT)} записей (Open Library)…`,
  )
  const rows = await enrichRows(baseRows)

  if (DRY_RUN) {
    log(`dry-run: распознано ${rows.length} записей, в базу не пишем`)
    for (const row of rows.slice(0, 10)) {
      log(
        `  • ${row.title}\n` +
          `    источник: ${row.source} | автор: ${row.author ?? '—'} | тип: ${row.content_type}` +
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
