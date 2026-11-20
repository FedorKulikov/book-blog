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

/** Тип материала на карточке: бейдж рядом с источником */
type NewsType = 'Новость' | 'Анонс' | 'Статья'

/**
 * Рубрика книжного портала. Совпадает с фильтрами страницы /news.
 * «Конкурсов» здесь нет осознанно: их не автоматизируем.
 */
type NewsCategoryValue = 'news' | 'new_book' | 'event' | 'publisher'

type FeedSource = {
  url: string
  /** Подпись источника — попадает в колонку source */
  label: string
  /** Куда вести, если в ленте внезапно оказалась ссылка на магазин */
  siteUrl: string
  /** Тип по умолчанию: в этих лентах категорий нет вообще */
  defaultType: NewsType
  /** Рубрика по умолчанию, если правила не сработали */
  category: NewsCategoryValue
  /** Язык ленты: русские проверяем на кириллицу, английские — нет */
  lang: 'ru' | 'en'
  /**
   * Лента книжных новинок: там заголовки вида «Автор: Название»
   * и их полезно разделять. У новостных лент двоеточие — часть заголовка.
   */
  isBookFeed?: boolean
}

/**
 * Качественные русскоязычные ленты — только статьи и анонсы.
 * Литрес и «Музей книги» убраны: они отдавали карточки товаров
 * и главные страницы вместо новостей.
 *
 * Отдельных RSS «новых книг» у российских издательств нет (проверены
 * Альпина, МИФ, АСТ /new, Лабиринт, Читай-город — 404 или не RSS),
 * поэтому рубрика «Новинки» выводится правилами по словам в заголовке.
 */
const DEFAULT_FEEDS: FeedSource[] = [
  {
    url: 'http://www.litkarta.ru/rss/channel_news/',
    label: 'Новая карта русской литературы',
    siteUrl: 'http://www.litkarta.ru/',
    defaultType: 'Новость',
    category: 'news',
    lang: 'ru',
  },
  {
    url: 'http://www.litkarta.ru/rss/channel_afisha/',
    label: 'Афиша литературных событий',
    siteUrl: 'http://www.litkarta.ru/',
    defaultType: 'Анонс',
    category: 'event',
    lang: 'ru',
  },
  {
    url: 'https://eksmo.ru/feed/',
    label: 'Эксмо',
    siteUrl: 'https://eksmo.ru/',
    defaultType: 'Статья',
    category: 'news',
    lang: 'ru',
  },
  {
    url: 'https://ast.ru/news/rss/',
    label: 'Издательство АСТ',
    siteUrl: 'https://ast.ru/',
    defaultType: 'Новость',
    category: 'publisher',
    lang: 'ru',
  },
  {
    url: 'https://lgz.ru/rss/',
    label: 'Литературная газета',
    siteUrl: 'https://lgz.ru/',
    defaultType: 'Новость',
    category: 'news',
    lang: 'ru',
  },

  // ---- Зарубежные ленты: мировая полка «Книжного радара» ----
  // Заголовки остаются на языке оригинала, русский вариант редактор
  // вписывает вручную в /admin/news (машинный перевод не используем).
  {
    url: 'https://lithub.com/feed/',
    label: 'Literary Hub',
    siteUrl: 'https://lithub.com/',
    defaultType: 'Новость',
    category: 'news',
    lang: 'en',
  },
  {
    url: 'https://bookriot.com/feed/',
    label: 'Book Riot',
    siteUrl: 'https://bookriot.com/',
    defaultType: 'Новость',
    category: 'news',
    lang: 'en',
  },
  {
    url: 'https://themillions.com/feed',
    label: 'The Millions',
    siteUrl: 'https://themillions.com/',
    defaultType: 'Новость',
    category: 'news',
    lang: 'en',
  },
  {
    url: 'https://electricliterature.com/feed/',
    label: 'Electric Literature',
    siteUrl: 'https://electricliterature.com/',
    defaultType: 'Новость',
    category: 'news',
    lang: 'en',
  },
]

/** Своя лента из RSS_FEED_URLS: подпись и сайт выводим из домена */
function feedFromUrl(url: string): FeedSource {
  const parsed = new URL(url)
  return {
    url,
    label: parsed.hostname.replace(/^www\./, ''),
    siteUrl: `${parsed.protocol}//${parsed.host}/`,
    defaultType: 'Статья',
    // Свои ленты раскладываем по рубрикам теми же правилами, что и остальные
    category: 'news',
    lang: 'ru',
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
 * одна лента: у Эксмо, например, 20 материалов подряд против 10 у афиши.
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
  'content:encoded'?: string
  author?: string
  isoDate?: string
  pubDate?: string
  /** <enclosure url="..."> — основной источник картинок в RSS 2.0 */
  enclosure?: { url?: string }
  /** <media:content url="..."> — Media RSS (rss-parser отдаёт через customFields) */
  mediaContent?: { $?: { url?: string } }[]
  mediaThumbnail?: { $?: { url?: string } }[]
  /** <category> — из неё выводим тип материала */
  categories?: string[]
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
  news_type: NewsType
  news_category: NewsCategoryValue
  lang: 'ru' | 'en'
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

/**
 * «Колонки нет» PostgREST сообщает двумя способами:
 *   • 42703 / «column … does not exist» — при чтении;
 *   • PGRST204 / «Could not find the 'x' column … in the schema cache» — при записи.
 * Для нас это одно и то же: миграция ещё не применена, деградируем.
 */
function isMissingColumnError(
  error: { message: string; code?: string } | null,
): boolean {
  if (!error) return false
  if (error.code === '42703' || error.code === 'PGRST204') return true

  return (
    /column .* does not exist/i.test(error.message) ||
    /could not find the '.*' column/i.test(error.message)
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Грубое, но безопасное вычищение HTML и раскодирование основных сущностей */
/** Именованные HTML-сущности, которые встречаются в лентах */
const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  mdash: '—',
  ndash: '–',
  laquo: '«',
  raquo: '»',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  bdquo: '„',
  shy: '',
}

/**
 * Раскрывает HTML-сущности: без этого в базе оставался литерал «&mdash;»
 * и он же показывался на сайте текстом.
 */
function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) =>
      String.fromCodePoint(Number.parseInt(dec, 10)),
    )
    .replace(
      /&([a-z]+);/gi,
      (match: string, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match,
    )
}

function stripHtml(input: string): string {
  return normalizeTitle(decodeEntities(input.replace(/<[^>]*>/g, ' ')))
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  return value.slice(0, max - 1).trimEnd() + '…'
}

/**
 * Заголовки лент приходят с неразрывными пробелами (U+00A0).
 * Нормализуем их, чтобы сравнение «заголовок в базе == заголовок в ленте»
 * не срабатывало ложно: иначе каждый прогон перезаписывал бы десятки
 * невинно отличающихся строк.
 */
function normalizeTitle(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
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

async function loadFeedOnce(
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

    // rss-parser по умолчанию выбрасывает поля из чужих namespace,
    // поэтому media:content подключаем через customFields
    const parser = new Parser<FeedMeta, FeedItemLike>({
      customFields: {
        item: [
          ['media:content', 'mediaContent', { keepArray: true }],
          ['media:thumbnail', 'mediaThumbnail', { keepArray: true }],
        ],
      },
    })
    const parsed = await parser.parseString(xml)

    return {
      feedTitle: parsed.title ?? 'RSS',
      items: parsed.items ?? [],
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Оборачивает загрузку одной повторной попыткой: антибот-защита
 * (403/429) и разовые 5xx часто отпускают после короткой паузы.
 */
async function loadFeed(
  feed: FeedSource,
): Promise<{ feedTitle: string; items: FeedItemLike[] }> {
  try {
    return await loadFeedOnce(feed)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    if (!/\b40[39]\b|\b429\b|\b5\d\d\b/.test(message)) throw error

    logWarn(`  повтор запроса к ${feed.url} через 3 с (${message})`)
    await sleep(3_000)
    return loadFeedOnce(feed)
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

function isHttpUrl(value: string | null | undefined): value is string {
  if (!value) return false

  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/** Значение Media RSS приходит массивом объектов вида { $: { url } } */
function mediaUrl(entries: { $?: { url?: string } }[] | undefined): string | null {
  for (const entry of entries ?? []) {
    const url = entry?.$?.url
    if (url) return url
  }

  return null
}

/**
 * Картинка материала: enclosure → media:content/thumbnail → первая <img> в HTML.
 * Если ничего нет — null, и фронтенд рисует градиентную заглушку
 * (у «Литературной карты» картинок в RSS нет вообще).
 */
function extractImageUrl(item: FeedItemLike): string | null {
  const enclosureUrl = item.enclosure?.url
  if (isHttpUrl(enclosureUrl)) return enclosureUrl.trim()

  const media = mediaUrl(item.mediaContent) ?? mediaUrl(item.mediaThumbnail)
  if (isHttpUrl(media)) return media.trim()

  const html = item['content:encoded'] ?? item.content ?? item.description ?? ''
  const match = /<img[^>]+src=["']([^"']+)["']/i.exec(html)
  if (match?.[1] && isHttpUrl(match[1])) return match[1]

  return null
}

/** Тип материала: из <category>, иначе тип по умолчанию для этой ленты */
function detectNewsType(item: FeedItemLike, feed: FeedSource): NewsType {
  const categories = (item.categories ?? []).join(' ').toLowerCase()

  if (/новост|news/.test(categories)) return 'Новость'
  if (/анонс|афиш|встреч|постанов|событ/.test(categories)) return 'Анонс'
  if (/стать|обзор|реценз|тест|занимательн|автор/.test(categories)) {
    return 'Статья'
  }

  return feed.defaultType
}

/**
 * Рубрика портала: сначала правила по <category> и заголовку,
 * потом рубрика по умолчанию для ленты.
 *
 * Порядок правил важен: «Постанонсы встреч» у Эксмо начинаются
 * со слова «постанов», а не «анонс», и должны попадать в «События».
 */
const CATEGORY_RULES: { re: RegExp; category: NewsCategoryValue }[] = [
  {
    re: /(анонс|афиш|встреч|постанов|презентац|лекци|фестивал|ярмарк|выставк|концерт)/i,
    category: 'event',
  },
  {
    re: /(новост[а-я]*\s+эксмо|издательств|издател|тираж|выпустил)/i,
    category: 'publisher',
  },
  {
    re: /(новинк|новая книга|новые книги|новый роман|вышел|вышла|вышло|издан)/i,
    category: 'new_book',
  },
]

function detectNewsCategory(
  item: FeedItemLike,
  feed: FeedSource,
): NewsCategoryValue {
  const haystack = `${(item.categories ?? []).join(' ')} ${item.title ?? ''}`

  for (const rule of CATEGORY_RULES) {
    if (rule.re.test(haystack)) return rule.category
  }

  return feed.category
}

/* ------------------------------------------------------------------ */
/* og:image для статей без картинки                                    */
/* ------------------------------------------------------------------ */

const OG_TIMEOUT_MS = 3_000
/** Сколько страниц тянем параллельно: литкара не любит пачки запросов */
const OG_CONCURRENCY = 4

/**
 * Кэш «страница → картинка» на один прогон: одну и ту же статью
 * не качаем дважды (например, если запись пришла из двух лент).
 * null в кэше — тоже результат: повторять таймаут смысла нет.
 */
const ogImageCache = new Map<string, string | null>()

/**
 * Служебная графика сайта: логотипы, иконки, уголки меню, кнопки навигации.
 * На страницах литкары первые <img> — ровно такие картинки
 * (logo_in_new.gif, home_in.gif, letter_in.gif…), а og:image не размечен.
 */
const CHROME_IMAGE_RE =
  /(logo|icon|sprite|banner|corner|arrow|bullet|button|menu|sitemap|spacer|pixel|placeholder|avatar|counter|home|letter|regions|nav|footer|header|search|print|mail|share|social|divider|border|_in\.|_in_)/i

/** Абсолютный http(s)-URL или null */
function toAbsoluteUrl(raw: string, base: string): string | null {
  try {
    const url = new URL(raw, base)
    return isHttpUrl(url.toString()) ? url.toString() : null
  } catch {
    return null
  }
}

/**
 * Пути, где обычно лежат настоящие иллюстрации статей.
 * У литкары это /images/doc/..., у Эксмо — /upload/iblock/...
 */
const CONTENT_IMAGE_RE =
  /(\/doc\/|\/upload|\/media\/|\/photo|\/content|\/files\/|article_images?)/i

/**
 * Первая осмысленная картинка страницы: og:image → twitter:image → <img>.
 * Служебную графику (логотипы, уголки, карты сайта) отбрасываем,
 * а «контентные» пути получают приоритет — иначе вместо обложки
 * прилетал очередной home_in.gif.
 */
function pickPageImageCandidates(html: string, pageUrl: string): string[] {
  const candidates: { raw: string; fromMeta: boolean }[] = []

  const metaPatterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
  ]

  for (const pattern of metaPatterns) {
    const match = pattern.exec(html)
    if (match?.[1]) candidates.push({ raw: match[1], fromMeta: true })
  }

  for (const match of html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) {
    const src = match[1]
    if (src) candidates.push({ raw: src, fromMeta: false })
  }

  const scored: { url: string; score: number }[] = []

  for (const { raw, fromMeta } of candidates) {
    const absolute = toAbsoluteUrl(raw, pageUrl)
    if (!absolute) continue

    // Обложкой берём только фото: gif-бейджи литкары весят 0,5 КБ
    // и в карточке 16:9 выглядят как битые пиксели
    if (!/\.(jpe?g|png|webp|avif)(\?|$)/i.test(absolute)) continue
    if (CHROME_IMAGE_RE.test(absolute)) continue

    let score = 0
    if (CONTENT_IMAGE_RE.test(absolute)) score += 3
    if (fromMeta) score += 2

    // Картинка без «контентного» пути и не из мета-тегов — почти наверняка хром
    if (score === 0) continue

    scored.push({ url: absolute, score })
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .map(item => item.url)
    .filter((url, index, all) => all.indexOf(url) === index)
}

/**
 * Обложка должна быть настоящей картинкой, а не иконкой:
 * проверяем тип и вес (файлы меньше 8 КБ в карточке мылят).
 */
const MIN_COVER_BYTES = 8 * 1024

type ImageSize = { width: number; height: number }

/**
 * Размер картинки из её заголовка — без внешних зависимостей.
 * Нужен, чтобы выбрать между превью из ленты и og:image страницы:
 * Эксмо в RSS отдаёт 95×95, а на странице лежит 720×480 —
 * без этой проверки карточка растягивала квадратик и мылила.
 */
function readImageSize(buffer: Buffer): ImageSize | null {
  // PNG: сигнатура + IHDR
  if (buffer.length > 24 && buffer.toString('ascii', 1, 4) === 'PNG') {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    }
  }

  // GIF: логический экран
  if (buffer.length > 10 && buffer.toString('ascii', 0, 3) === 'GIF') {
    return {
      width: buffer.readUInt16LE(6),
      height: buffer.readUInt16LE(8),
    }
  }

  // WebP (VP8X / VP8L / VP8 с потерями)
  if (
    buffer.length > 30 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    const format = buffer.toString('ascii', 12, 16)

    if (format === 'VP8X') {
      return {
        width: 1 + buffer.readUIntLE(24, 3),
        height: 1 + buffer.readUIntLE(27, 3),
      }
    }

    if (format === 'VP8 ') {
      return {
        width: buffer.readUInt16LE(26) & 0x3fff,
        height: buffer.readUInt16LE(28) & 0x3fff,
      }
    }
  }

  // JPEG: идём по маркерам до кадра SOF0..SOF3/SOF5..SOF7/SOF9..SOF11
  if (buffer.length > 4 && buffer.readUInt16BE(0) === 0xffd8) {
    let offset = 2

    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset++
        continue
      }

      const marker = buffer[offset + 1] ?? 0

      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2
        continue
      }

      const length = buffer.readUInt16BE(offset + 2)
      const isFrame =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb)

      if (isFrame) {
        return {
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7),
        }
      }

      if (length <= 0) break
      offset += 2 + length
    }
  }

  return null
}

/** Размер картинки по URL (null, если не удалось получить) */
async function fetchImageSize(url: string): Promise<ImageSize | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), OG_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120', Accept: 'image/*' },
      signal: controller.signal,
    })

    if (!response.ok) return null
    const buffer = Buffer.from(await response.arrayBuffer())
    return readImageSize(buffer)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function isUsableImage(url: string): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), OG_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120', Accept: 'image/*' },
      signal: controller.signal,
    })

    if (!response.ok) return false
    if (!(response.headers.get('content-type') ?? '').startsWith('image/')) {
      return false
    }

    const bytes = (await response.arrayBuffer()).byteLength
    return bytes >= MIN_COVER_BYTES
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Выбирает лучшую обложку между текущей (например, enclosure из ленты)
 * и og:image со страницы статьи. Сравниваем по площади: так 720×480
 * со страницы побеждает квадратное превью 95×95 из RSS.
 */
async function pickBetterCover(
  pageUrl: string,
  currentUrl: string | null,
): Promise<string | null> {
  const better = await fetchOgImage(pageUrl)
  if (!better) return null
  if (!currentUrl) return better
  if (better === currentUrl) return null

  const [current, candidate] = await Promise.all([
    fetchImageSize(currentUrl),
    fetchImageSize(better),
  ])

  if (!candidate) return null
  if (!current) return better

  return candidate.width * candidate.height > current.width * current.height
    ? better
    : null
}

/** Первая картинка со страницы: og:image → twitter:image → первый содержательный <img> */
async function fetchOgImage(pageUrl: string): Promise<string | null> {
  const cached = ogImageCache.get(pageUrl)
  if (cached !== undefined) return cached

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), OG_TIMEOUT_MS)

  try {
    const response = await fetch(pageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ru-RU,ru;q=0.9',
      },
      signal: controller.signal,
      redirect: 'follow',
    })

    if (!response.ok) {
      ogImageCache.set(pageUrl, null)
      return null
    }

    // Страницы литкары в windows-1251 — декодируем как RSS
    const buffer = Buffer.from(await response.arrayBuffer())
    const contentType = response.headers.get('content-type') ?? ''
    const charset =
      /charset=([\w-]+)/i.exec(contentType)?.[1]?.toLowerCase() ?? 'utf-8'
    const html = /1251|cp1251|win-1251/.test(charset)
      ? iconv.decode(buffer, 'win1251')
      : buffer.toString('utf8')

    const result = pickPageImageCandidates(html, pageUrl)

    // Проверяем кандидатов по порядку: первый, который реально фото и не иконка
    let cover: string | null = null
    for (const candidate of result.slice(0, 3)) {
      if (await isUsableImage(candidate)) {
        cover = candidate
        break
      }
    }

    ogImageCache.set(pageUrl, cover)
    return cover
  } catch {
    // Таймаут/сеть: запоминаем null, чтобы не ждать снова в этом прогоне
    ogImageCache.set(pageUrl, null)
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Подбирает обложки для новых записей: ставит картинку тем, у кого её нет,
 * и меняет мелкое превью из ленты на крупный og:image со страницы статьи
 * (Эксмо в RSS отдаёт 95×95 — в карточке это мыло).
 * Возвращает { filled, upgraded }.
 */
async function enrichCovers(
  rows: NewRow[],
): Promise<{ filled: number; upgraded: number }> {
  const targets = rows.slice()
  let cursor = 0
  let filled = 0
  let upgraded = 0

  async function worker(): Promise<void> {
    while (cursor < targets.length) {
      const row = targets[cursor]
      cursor++
      if (!row) continue

      const hadCover = Boolean(row.cover_url)
      const better = await pickBetterCover(row.url, row.cover_url)
      if (!better) continue

      row.cover_url = better
      if (hadCover) upgraded++
      else filled++
    }
  }

  const workers = Array.from(
    { length: Math.min(OG_CONCURRENCY, targets.length) },
    () => worker(),
  )
  await Promise.all(workers)

  return { filled, upgraded }
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

    // Русские ленты чистим от иностранных заголовков, английские — нет:
    // у них латиница и есть норма
    if (feed.lang === 'ru' && !looksRussian(stripHtml(rawTitle))) {
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

    const cleanTitle = stripHtml(rawTitle)

    // «Автор: Название» — только у книжных лент. В новостях двоеточие
    // часть заголовка («Итоги сезона: что читали»), и резать его нельзя.
    const { author: authorFromTitle, title } = feed.isBookFeed
      ? splitAuthorFromTitle(cleanTitle)
      : { author: null, title: cleanTitle }

    const author = (item.author ?? '').trim() || authorFromTitle

    // Книга, если есть автор или ссылка ведёт на карточку книги/аудиокниги
    const isBook = Boolean(author) || /\/(book|audiobook)\//.test(url)

    rows.push({
      title: truncate(normalizeTitle(title), TITLE_MAX),
      url,
      source: feed.label,
      summary: rawSummary ? truncate(stripHtml(rawSummary), SUMMARY_MAX) : null,
      // В таблице нет отдельного published_at: created_at = дата публикации,
      // чтобы лента на сайте сортировалась по свежести книг, а не по времени импорта.
      created_at: itemDate(item),
      author: author ? truncate(author, 120) : null,
      cover_url: extractImageUrl(item),
      content_type: isBook ? 'book' : 'article',
      published_year: null,
      news_type: detectNewsType(item, feed),
      news_category: detectNewsCategory(item, feed),
      lang: feed.lang,
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

  // Название книги могло сохраниться вместе с префиксом «Автор: » — разделяем,
  // иначе Open Library ищет по строке вида «Kazuo Ishiguro: Klara and the Sun».
  // Для статей этого не делаем: там двоеточие — часть заголовка.
  if (!next.author && (next.content_type ?? 'book') === 'book') {
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

/** То же, но без колонок портала: их добавляют отдельными миграциями */
function withoutNewsType(row: NewRow) {
  return {
    title: row.title,
    url: row.url,
    source: row.source,
    summary: row.summary,
    created_at: row.created_at,
    author: row.author,
    cover_url: row.cover_url,
    content_type: row.content_type,
    published_year: row.published_year,
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
    // Миграция ещё не применена — деградируем постепенно:
    // сначала теряем только новые колонки, потом пишем базовый набор.
    const isMissingColumn = isMissingColumnError(insertError)

    if (!isMissingColumn) {
      throw new Error(`не удалось вставить записи: ${insertError.message}`)
    }

    logWarn(
      'в external_news нет колонки news_type — пишем без неё ' +
        '(выполни supabase/migrations/20261121_external_news_type.sql)',
    )

    const { error: typedError } = await supabase
      .from('external_news')
      .insert(fresh.map(withoutNewsType))

    if (!typedError) {
      log(
        `добавлено записей: ${fresh.length} (без news_type; дубликатов пропущено: ${rows.length - fresh.length})`,
      )
      return
    }

    if (!isMissingColumnError(typedError)) {
      throw new Error(
        `не удалось вставить записи: ${typedError.message}`,
      )
    }

    logWarn(
      'в external_news не хватает и других колонок — пишем базовый набор ' +
        '(выполни миграции external_news)',
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
/* Догонка обложек для старых записей                                  */
/* ------------------------------------------------------------------ */

/**
 * Сколько записей догоняем за прогон.
 * Импорт только вставляет новые url, поэтому старые строки сами
 * не обновятся — дозаполняем их при каждом обычном запуске.
 */
const META_REFRESH_LIMIT = 200
/** Сколько страниц статей максимум открываем ради og:image */
const OG_REFRESH_LIMIT = 20

/**
 * Догоняет cover_url и news_type у старых записей.
 *
 * Порядок важен: сначала берём данные из самих RSS-лент (там есть
 * enclosure/media:content — то есть ровно то, что нужно для Эксмо),
 * и только потом идём на страницы статей. Страницы Эксмо с IP
 * GitHub Actions отвечают 403, поэтому опираться только на og:image нельзя.
 */
async function refreshNewsMeta(): Promise<void> {
  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

  // Без service_role обновление упрётся в RLS — молча выходим
  if (!supabaseUrl || !serviceKey) return

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Колонку news_category добавляют отдельной миграцией: если её ещё нет,
  // работаем без рубрик, но остальные метаданные всё равно догоняем.
  let categoryAvailable = true

  const full = await supabase
    .from('external_news')
    .select('id, url, title, cover_url, news_type, news_category')
    .order('created_at', { ascending: false })
    .limit(META_REFRESH_LIMIT)

  let data: unknown[] | null = (full.data ?? null) as unknown[] | null
  let error = full.error

  const missingCategory = isMissingColumnError(error)

  if (missingCategory) {
    categoryAvailable = false
    logWarn(
      'в external_news нет колонки news_category — догоняем без рубрик ' +
        '(выполни supabase/migrations/20261122_external_news_category.sql)',
    )

    const retry = await supabase
      .from('external_news')
      .select('id, url, title, cover_url, news_type')
      .order('created_at', { ascending: false })
      .limit(META_REFRESH_LIMIT)

    data = (retry.data ?? null) as unknown[] | null
    error = retry.error
  }

  if (error) {
    logWarn(`метаданные: не удалось прочитать записи (${error.message})`)
    return
  }

  const rows = (data ?? []) as unknown as {
    id: string
    url: string
    title: string
    cover_url: string | null
    news_type: string | null
    news_category?: string | null
  }[]

  if (rows.length === 0) {
    log('метаданные: таблица пуста — обновлять нечего')
    return
  }

  log(`метаданные: сверяем ${rows.length} записей с текущими лентами…`)

  // 1. Собираем заголовки, обложки и типы из актуальных лент: url → данные.
  //    Заголовок тоже берём из ленты: старые записи могли сохраниться
  //    обрезанными (баг разбиения «Автор: Название» до фикса).
  const fromFeeds = new Map<
    string,
    {
      title: string
      cover_url: string | null
      news_type: NewsType
      news_category: NewsCategoryValue
    }
  >()

  for (const feed of FEEDS) {
    try {
      const { items } = await loadFeed(feed)
      const built = buildRows(items, feed)

      for (const row of built.rows) {
        fromFeeds.set(row.url, {
          title: row.title,
          cover_url: row.cover_url,
          news_type: row.news_type,
          news_category: row.news_category,
        })
      }
    } catch (feedError) {
      logWarn(
        `метаданные: лента ${feed.url} недоступна (${feedError instanceof Error ? feedError.message : feedError})`,
      )
    }
  }

  let updatedTitles = 0
  let updatedCovers = 0
  let updatedTypes = 0
  let updatedCategories = 0
  let ogRequests = 0

  for (const row of rows) {
    const patch: {
      title?: string
      cover_url?: string
      news_type?: string
      news_category?: string
    } = {}
    const fromFeed = fromFeeds.get(row.url)

    // Заголовок отличается от ленты → значит сохранён обрезанный, правим.
    // Сравниваем нормализованные версии: неразрывные пробелы — не повод
    // перезаписывать строку.
    const feedTitle = fromFeed?.title ? normalizeTitle(fromFeed.title) : null
    if (feedTitle && feedTitle !== normalizeTitle(row.title)) {
      patch.title = feedTitle
    }
    // Стартовая обложка: то, что уже в базе, иначе — из ленты
    let cover = row.cover_url ?? fromFeed?.cover_url ?? null

    // 2. Сравниваем с og:image страницы: если там крупнее — берём её.
    //    Так лечится квадратное превью 95×95, которое Эксмо отдаёт в RSS.
    //    Ограничиваем число запросов, чтобы прогон не растягивался.
    if (ogRequests < OG_REFRESH_LIMIT) {
      ogRequests++
      const better = await pickBetterCover(row.url, cover)
      if (better) cover = better
    }

    if (cover && cover !== row.cover_url) {
      patch.cover_url = cover
    }

    // Тип материала: заполняем, только если в базе его ещё нет
    if (fromFeed?.news_type && !row.news_type) {
      patch.news_type = fromFeed.news_type
    }

    // Рубрика портала: нужна, чтобы запись попала в ленту /news
    if (categoryAvailable && fromFeed?.news_category && !row.news_category) {
      patch.news_category = fromFeed.news_category
    }

    if (
      !patch.title &&
      !patch.cover_url &&
      !patch.news_type &&
      !patch.news_category
    ) {
      continue
    }

    if (DRY_RUN) {
      log(
        `  [dry] заголовок: ${patch.title ?? '—'} | обложка: ${patch.cover_url ?? '—'} | тип: ${patch.news_type ?? '—'} | рубрика: ${patch.news_category ?? '—'} ← ${row.url}`,
      )
      if (patch.title) updatedTitles++
      if (patch.cover_url) updatedCovers++
      if (patch.news_type) updatedTypes++
      if (patch.news_category) updatedCategories++
      continue
    }

    const { data: changed, error: updateError } = await supabase
      .from('external_news')
      .update(patch)
      .eq('id', row.id)
      .select('id')

    if (updateError) {
      logWarn(`  не удалось обновить ${row.id}: ${updateError.message}`)
      continue
    }

    if (!changed || changed.length === 0) continue

    if (patch.title) updatedTitles++
    if (patch.cover_url) updatedCovers++
    if (patch.news_type) updatedTypes++
    if (patch.news_category) updatedCategories++
  }

  log(
    `метаданные: заголовков ${updatedTitles}, обложек ${updatedCovers}, типов ${updatedTypes}, рубрик ${updatedCategories} из ${rows.length}`,
  )
}

/* ------------------------------------------------------------------ */
/* Книжный радар: тренды недели                                        */
/* ------------------------------------------------------------------ */

const TREND_PERIOD_DAYS = 7
const TREND_LIMIT = 40

/** Темы, которые ищем в заголовках прямым совпадением */
const THEME_PATTERNS: { re: RegExp; topic: string }[] = [
  { re: /букер/i, topic: 'Букеровская премия' },
  { re: /нобел/i, topic: 'Нобелевская премия' },
  { re: /пулитцер/i, topic: 'Пулитцеровская премия' },
  { re: /экранизац|сериал|фильм по книге/i, topic: 'Экранизации' },
  { re: /перевод/i, topic: 'Переводы' },
  { re: /ярмарк|фестивал/i, topic: 'Ярмарки и фестивали' },
  { re: /аудиокниг/i, topic: 'Аудиокниги' },
  { re: /библиотек/i, topic: 'Библиотеки' },
  { re: /новинк|новые книги/i, topic: 'Новинки' },
  { re: /запрет|цензур|изъят/i, topic: 'Запреты и цензура' },
  { re: /нейросет|искусственн\w+ интеллект|\bAI\b/i, topic: 'ИИ и книги' },
  { re: /тираж/i, topic: 'Тиражи' },
  { re: /электронн\w+ книг/i, topic: 'Электронные книги' },
  { re: /букинист|антикварн/i, topic: 'Букинистика' },
  { re: /поэзи|стих/i, topic: 'Поэзия' },
  { re: /детск\w+ книг|подростков/i, topic: 'Детские книги' },
]

/** Слова, которые не могут быть «именем в тренде» */
const NAME_STOPWORDS = new Set([
  'новости', 'новость', 'книга', 'книги', 'книг', 'издательство', 'издательства',
  'литература', 'литературная', 'литературный', 'роман', 'романа', 'автор',
  'авторы', 'читатели', 'читатель', 'обзор', 'рецензия', 'лучшие', 'главные',
  'почему', 'как', 'что', 'когда', 'новая', 'новый', 'новое', 'большой',
  'первый', 'первая', 'самые', 'самый', 'итоги', 'неделя', 'недели', 'год',
  'года', 'день', 'дня', 'время', 'место', 'история', 'жизнь', 'мир',
  'the', 'book', 'books', 'new', 'why', 'how', 'best', 'review', 'reviews',
  'literary', 'literature', 'author', 'authors', 'reader', 'readers',
  'novel', 'novels', 'story', 'stories', 'week', 'year', 'day', 'time',
])

/** Что ищем в одном заголовке: темы + имена собственные */
function extractTrends(
  title: string,
): { topic: string; kind: 'theme' | 'name' }[] {
  const found: { topic: string; kind: 'theme' | 'name' }[] = []
  const seen = new Set<string>()

  for (const pattern of THEME_PATTERNS) {
    if (pattern.re.test(title) && !seen.has(pattern.topic)) {
      seen.add(pattern.topic)
      found.push({ topic: pattern.topic, kind: 'theme' })
    }
  }

  // Имена: последовательности слов с заглавной буквы («Хван Согён», «Sally Rooney»)
  const names = title.match(
    /[A-ZА-ЯЁ][a-zа-яё'-]{3,}(?:\s+[A-ZА-ЯЁ][a-zа-яё'-]{3,}){0,2}/g,
  )

  for (const name of names ?? []) {
    const clean = name.trim()
    const firstWord = clean.split(/\s+/)[0]?.toLowerCase() ?? ''

    if (NAME_STOPWORDS.has(firstWord)) continue
    if (clean.length < 5) continue
    if (seen.has(clean)) continue

    seen.add(clean)
    found.push({ topic: clean, kind: 'name' })

    // Больше двух имён из одного заголовка не берём: это уже шум
    if (found.filter(item => item.kind === 'name').length >= 2) break
  }

  return found
}

/** Начало текущей недели (понедельник, UTC) — ключ периода трендов */
function weekStart(): Date {
  const now = new Date()
  const dayFromMonday = (now.getUTCDay() + 6) % 7

  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dayFromMonday),
  )
}

/**
 * Пересчитывает тренды недели по заголовкам всех новостей (РФ + зарубежные).
 * Пишем через service_role: читателям таблица доступна только на чтение.
 */
async function updateTrends(): Promise<void> {
  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

  if (!supabaseUrl || !serviceKey) return

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const since = new Date(
    Date.now() - TREND_PERIOD_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString()

  const { data, error } = await supabase
    .from('external_news')
    .select('title, title_ru')
    .gte('created_at', since)
    .limit(1000)

  if (error) {
    // Колонки title_ru может ещё не быть — тогда считаем по оригиналу
    if (isMissingColumnError(error)) {
      logWarn('тренды: нет колонки title_ru — считаем по оригинальным заголовкам')
      return
    }

    logWarn(`тренды: не удалось прочитать новости (${error.message})`)
    return
  }

  const rows = (data ?? []) as unknown as {
    title: string
    title_ru: string | null
  }[]

  const counters = new Map<
    string,
    { topic: string; kind: 'theme' | 'name'; mentions: number }
  >()

  for (const row of rows) {
    const text = `${row.title_ru ?? ''} ${row.title}`

    for (const { topic, kind } of extractTrends(text)) {
      const key = `${kind}:${topic.toLowerCase()}`
      const existing = counters.get(key)

      if (existing) existing.mentions++
      else counters.set(key, { topic, kind, mentions: 1 })
    }
  }

  const top = [...counters.values()]
    .filter(item => item.mentions >= 2)
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, TREND_LIMIT)

  if (top.length === 0) {
    log(`тренды: за ${TREND_PERIOD_DAYS} дней повторяющихся тем не нашлось`)
    return
  }

  const periodStart = weekStart().toISOString()

  if (DRY_RUN) {
    log(`тренды (dry-run): рассчитано ${top.length} тем`)
    for (const item of top.slice(0, 5)) {
      log(`  ${item.topic} ×${item.mentions} (${item.kind})`)
    }
    return
  }

  const { error: deleteError } = await supabase
    .from('news_trends')
    .delete()
    .eq('period_start', periodStart)

  if (deleteError) {
    logWarn(`тренды: не удалось очистить период (${deleteError.message})`)
    return
  }

  const { error: insertError } = await supabase.from('news_trends').insert(
    top.map(item => ({
      topic: item.topic,
      kind: item.kind,
      mentions: item.mentions,
      period_start: periodStart,
    })),
  )

  if (insertError) {
    logWarn(`тренды: не удалось сохранить (${insertError.message})`)
    return
  }

  const themes = top.filter(item => item.kind === 'theme').length
  log(
    `тренды: сохранено ${top.length} (тем ${themes}, имён ${top.length - themes}), топ: ${top
      .slice(0, 3)
      .map(item => `${item.topic} ×${item.mentions}`)
      .join(', ')}`,
  )
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

  // Обложки со страниц статей: у «Литературной карты» картинок в RSS нет,
  // а у Эксмо в ленте только квадратное превью 95×95 — берём og:image крупнее.
  log(`подбираем обложки для ${baseRows.length} записей (og:image со страниц)…`)
  const covers = await enrichCovers(baseRows)
  log(`обложки: добавлено ${covers.filled}, улучшено ${covers.upgraded}`)

  log(
    `обогащаем первые ${Math.min(baseRows.length, ENRICH_LIMIT)} записей (Open Library)…`,
  )
  const rows = await enrichRows(baseRows)

  // Сразу видно в логах CI, сколько картинок нашли в лентах
  const withCover = rows.filter(row => row.cover_url).length
  log(`найдено обложек в лентах: ${withCover} из ${rows.length}`)

  // Раскладка по рубрикам портала: видно, чем наполнится /news
  const byCategory = new Map<string, number>()
  for (const row of rows) {
    byCategory.set(row.news_category, (byCategory.get(row.news_category) ?? 0) + 1)
  }
  log(
    `рубрики: ${[...byCategory.entries()]
      .map(([category, count]) => `${category}=${count}`)
      .join(', ')}`,
  )

  // Дозаполняем обложки, заголовки и рубрики у старых записей
  await refreshNewsMeta()

  // И пересчитываем тренды недели для «Книжного радара»
  await updateTrends()

  if (DRY_RUN) {
    log(`dry-run: распознано ${rows.length} записей, в базу не пишем`)
    for (const row of rows.slice(0, 10)) {
      log(
        `  • ${row.title}\n` +
          `    источник: ${row.source} | рубрика: ${row.news_category} | тип: ${row.news_type} | автор: ${row.author ?? '—'} | content: ${row.content_type}` +
          `${row.cover_url ? '\n    обложка: ' + row.cover_url : '\n    обложка: нет (заглушка)'}` +
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
