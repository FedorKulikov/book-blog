// app/news/newsQuery.ts
// Данные и словари «Книжного портала». Один модуль на страницу и на фильтры,
// чтобы серверный рендер и ссылки фильтра не разъехались.
import type { SupabaseClient } from '@supabase/supabase-js'

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
