// app/news/newsQuery.ts
// Данные и словари «Книжного портала». Один модуль на страницу и на фильтры,
// чтобы серверный рендер и ссылки фильтра не разъехались.
import type { SupabaseClient } from '@supabase/supabase-js'
import { toPlainText, truncate } from '@/lib/text'

/** Категории новостей. 'publisher' — витрина «Издательства». */
export const NEWS_CATEGORIES = [
  'news',
  'contest',
  'new_book',
  'event',
  'publisher',
] as const

export type NewsCategory = (typeof NEWS_CATEGORIES)[number]

/** Что может прийти из URL: категория или «всё подряд». */
export type NewsFilter = 'all' | NewsCategory

export const NEWS_CATEGORY_LABEL: Record<NewsCategory, string> = {
  news: 'Новость',
  contest: 'Конкурс',
  new_book: 'Книжная новинка',
  event: 'Мероприятие',
  publisher: 'Издательства',
}

/** Кнопки-фильтры: порядок и подписи задаются здесь же. */
export const NEWS_FILTERS: { value: NewsFilter; label: string }[] = [
  { value: 'all', label: 'Все новости' },
  { value: 'contest', label: 'Конкурсы' },
  { value: 'new_book', label: 'Новинки' },
  { value: 'event', label: 'События' },
  { value: 'publisher', label: 'Издательства' },
]

export const NEWS_LIMIT = 13

/**
 * Цвета бейджей категорий. Один источник правды для ленты (/news)
 * и для страницы поста, чтобы они не разъезжались.
 */
export const NEWS_CATEGORY_BADGE: Record<NewsCategory, string> = {
  news: 'bg-[#014b32] text-[#E2E2E0]',
  contest: 'bg-[#681F2D] text-[#E2E2E0]',
  event: 'bg-[#681F2D] text-[#E2E2E0]',
  new_book: 'bg-[#014b32] text-[#E2E2E0]',
  publisher: 'bg-[#493344] text-[#E2E2E0]',
}

/** Строка из базы — это категория портала? */
export function isNewsCategory(
  value: string | null | undefined,
): value is NewsCategory {
  return (
    typeof value === 'string' &&
    (NEWS_CATEGORIES as readonly string[]).includes(value)
  )
}

export const NEWS_SELECT =
  'id, title, content, created_at, news_category, deadline_at, source_url, views_count, profiles!posts_user_id_fkey(username, avatar_url), post_images(url), comments(count), likes(count)'

export type NewsPost = {
  id: string
  title: string
  content: string | null
  created_at: string
  news_category: string | null
  deadline_at: string | null
  source_url: string | null
  views_count: number | null
  profiles: { username: string | null; avatar_url: string | null } | null
  post_images: { url: string }[] | null
  comments: { count: number }[] | null
  likes: { count: number }[] | null
}

export type NewsFeed = {
  hero: NewsPost | null
  posts: NewsPost[]
  error: string | null
}

/**
 * Значение из URL → безопасный фильтр.
 * Всё неизвестное («?category=<script>», опечатки) считаем «all»,
 * чтобы запрос не уходил в базу с произвольной строкой.
 */
export function parseNewsFilter(
  value: string | string[] | undefined,
): NewsFilter {
  const raw = Array.isArray(value) ? value[0] : value
  if (!raw) return 'all'

  const normalized = raw.trim().toLowerCase()

  return (NEWS_CATEGORIES as readonly string[]).includes(normalized)
    ? (normalized as NewsCategory)
    : 'all'
}

/** Ссылка на ленту с нужным фильтром (для кнопок и «хлебных крошек»). */
export function newsHref(filter: NewsFilter): string {
  return filter === 'all' ? '/news' : `/news?category=${filter}`
}

/**
 * Одна выборка на всю страницу: самый свежий пост становится «Главным сегодня»,
 * остальные уходят в сетку. Так мы не делаем два запроса в базу.
 */
export async function fetchNewsFeed(
  supabase: SupabaseClient,
  filter: NewsFilter,
): Promise<NewsFeed> {
  let query = supabase
    .from('posts')
    .select(NEWS_SELECT)
    .eq('type', 'news')
    .eq('status', 'approved')
    .order('created_at', { ascending: false })
    .limit(NEWS_LIMIT)

  if (filter !== 'all') {
    query = query.eq('news_category', filter)
  }

  const { data, error } = await query

  if (error) {
    console.error('[news] posts select failed:', error.message)
    return { hero: null, posts: [], error: error.message }
  }

  const rows = (data ?? []) as unknown as NewsPost[]

  return {
    hero: rows[0] ?? null,
    posts: rows.slice(1),
    error: null,
  }
}

/* ------------------------------------------------------------------ */
/* Даты: таймзона зафиксирована, чтобы SSR не зависел от сервера       */
/* ------------------------------------------------------------------ */

const newsDateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  timeZone: 'Europe/Moscow',
})

const deadlineFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  timeZone: 'Europe/Moscow',
})

export function formatNewsDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return newsDateFormatter.format(date)
}

/** «До 15 декабря» — как на карточке конкурса. */
export function formatDeadline(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `До ${deadlineFormatter.format(date)}`
}

/** «15 декабря» — для блока «Дедлайн: …» на странице поста. */
export function formatDeadlineDay(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return deadlineFormatter.format(date)
}

export function isDeadlinePassed(iso: string): boolean {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return false
  return date.getTime() < Date.now()
}

/** Дедлайн показываем только у конкурсов и мероприятий. */
export function showsDeadline(post: NewsPost): boolean {
  return (
    (post.news_category === 'contest' || post.news_category === 'event') &&
    Boolean(post.deadline_at)
  )
}

/** Первая картинка поста или null. */
export function coverOf(post: NewsPost): string | null {
  const url = post.post_images?.[0]?.url
  return typeof url === 'string' && url.trim().length > 0 ? url : null
}

/* ------------------------------------------------------------------ */
/* Лента портала: посты пользователей + автоматические новости         */
/* ------------------------------------------------------------------ */

/**
 * Единый вид карточки для ленты /news.
 * В ленте встречаются два типа записей:
 *   • посты пользователей (таблица posts) — с лайками, комментариями, дедлайном;
 *   • автоматически импортированные новости (таблица external_news) —
 *     со ссылкой на первоисточник.
 */
export type PortalNewsItem = {
  /** Уникальный ключ для React */
  key: string
  title: string
  /** Куда ведёт карточка: /post/<id> или внешний первоисточник */
  href: string
  external: boolean
  category: NewsCategory | null
  cover: string | null
  created_at: string
  excerpt: string | null
  /** Подпись источника — только у внешних новостей */
  source: string | null
  /** «Новость» | «Анонс» | «Статья» — только у внешних */
  news_type: string | null
  deadline_at: string | null
  source_url: string | null
}

/** Полное содержание поста в короткий текст карточки */
function excerptOf(content: string | null, max: number): string | null {
  if (!content) return null
  const text = toPlainText(content)
  return text ? truncate(text, max) : null
}

export function postToPortalItem(post: NewsPost): PortalNewsItem {
  return {
    key: `post:${post.id}`,
    title: post.title,
    href: `/post/${post.id}`,
    external: false,
    category: isNewsCategory(post.news_category) ? post.news_category : null,
    cover: coverOf(post),
    created_at: post.created_at,
    excerpt: excerptOf(post.content, 160),
    source: null,
    news_type: null,
    deadline_at: post.deadline_at,
    source_url: post.source_url,
  }
}

const EXTERNAL_SELECT =
  'id, title, url, source, summary, cover_url, created_at, news_type, news_category'

/** То же без рубрики: работает, пока миграция 20261122 не применена */
const EXTERNAL_SELECT_LEGACY =
  'id, title, url, source, summary, cover_url, created_at, news_type'

type ExternalRow = {
  id: string
  title: string
  url: string
  source: string | null
  summary: string | null
  cover_url: string | null
  created_at: string
  news_type: string | null
  news_category?: string | null
}

/**
 * Правила рубрикации — те же, что в импортёре (scripts/fetch-rss-news.ts).
 * Нужны как запасной вариант: если колонка news_category ещё не создана,
 * рубрика выводится на лету, и лента /news всё равно работает.
 */
const PORTAL_CATEGORY_RULES: { re: RegExp; category: NewsCategory }[] = [
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

function deriveCategory(row: ExternalRow): NewsCategory {
  if (isNewsCategory(row.news_category)) return row.news_category

  const haystack = `${row.news_type ?? ''} ${row.title}`

  for (const rule of PORTAL_CATEGORY_RULES) {
    if (rule.re.test(haystack)) return rule.category
  }

  // По источнику: афиша — события, издательство АСТ — издательства,
  // остальное (литкара, Эксмо, ЛГ) — общие новости
  const source = row.source ?? ''
  if (/афиш/i.test(source)) return 'event'
  if (/издательств/i.test(source)) return 'publisher'

  return 'news'
}

/**
 * Автоматические новости для ленты портала.
 *
 * Фильтр применяется в SQL, когда рубрика лежит в базе, и в JS — когда она
 * выведена на лету (до миграции). Объём небольшой, лишний запрос не нужен.
 */
export async function fetchExternalNewsFeed(
  supabase: SupabaseClient,
  filter: NewsFilter,
  limit: number = NEWS_LIMIT * 3,
): Promise<{ items: PortalNewsItem[]; error: string | null }> {
  function buildQuery(select: string, useSqlFilter: boolean) {
    let request = supabase
      .from('external_news')
      .select(select)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (useSqlFilter && filter !== 'all') {
      request = request.eq('news_category', filter)
    }

    return request
  }

  let { data, error } = await buildQuery(EXTERNAL_SELECT, true)
  let categoryInDb = true

  const missingColumn =
    error !== null &&
    (error.code === '42703' || /column .* does not exist/i.test(error.message))

  if (missingColumn) {
    categoryInDb = false
    const legacy = await buildQuery(EXTERNAL_SELECT_LEGACY, false)
    data = legacy.data as typeof data
    error = legacy.error
  }

  if (error) {
    if (!missingColumn) {
      console.error('[news] external_news select failed:', error.message)
      return { items: [], error: error.message }
    }

    return { items: [], error: null }
  }

  const rows = (data ?? []) as unknown as ExternalRow[]

  const items = rows
    .map(row => {
      const category = deriveCategory(row)

      return {
        key: `ext:${row.id}`,
        title: row.title,
        href: row.url,
        external: true,
        category,
        cover: row.cover_url,
        created_at: row.created_at,
        excerpt: row.summary,
        source: row.source,
        news_type: row.news_type,
        deadline_at: null,
        source_url: row.url,
      } satisfies PortalNewsItem
    })
    .filter(item => {
      if (filter === 'all') return true
      // Рубрика из базы отфильтрована в SQL, выведенную фильтруем здесь
      return categoryInDb ? true : item.category === filter
    })
    .slice(0, NEWS_LIMIT)

  return { items, error: null }
}

/**
 * Склеивает обе ленты по дате: свежее — выше.
 * Первая запись становится «Главным сегодня», остальные — сеткой.
 */
export function buildPortalFeed(
  posts: NewsPost[],
  external: PortalNewsItem[],
): { hero: PortalNewsItem | null; items: PortalNewsItem[] } {
  const merged = [...posts.map(postToPortalItem), ...external].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  )

  return { hero: merged[0] ?? null, items: merged.slice(1) }
}
