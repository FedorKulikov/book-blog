// app/book/[id]/getBook.ts
// Единственный источник данных для страницы книги: его вызывают и page.tsx,
// и generateMetadata. cache() гарантирует один запрос в Supabase на запрос к сайту.
import { cache } from 'react'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { PostCardData } from '@/app/components/PostCard'
import { POSTS_SELECT } from '@/app/posts/postsQuery'

export type BookRow = {
  id: string
  title: string
  author: string | null
  year: number | string | null
  description: string | null
  cover_url: string | null
  views_count: number | null
}

/** Пост о книге: к PostCardData добавлены поля для статистики карточки книги. */
export type BookPost = PostCardData & {
  user_id: string
  likes?: { count: number }[] | null
}

export type BookPageData = {
  book: BookRow
  posts: BookPost[]
}

// Мусорные URL (/book/abc) отсекаем до запроса: Postgres упал бы на касте к uuid
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const getBook = cache(async (id: string): Promise<BookPageData | null> => {
  if (!UUID_RE.test(id)) return null

  const supabase = await createSupabaseServerClient()

  const { data: bookData, error: bookError } = await supabase
    .from('books')
    .select('id, title, author, year, description, cover_url, views_count')
    .eq('id', id)
    .maybeSingle()

  if (bookError) {
    console.error('[getBook] books select failed:', bookError.message)
    return null
  }
  if (!bookData) return null

  const book = bookData as unknown as BookRow

  // Клиент читает куки: автор увидит свои посты на модерации
  const { data: { user } } = await supabase.auth.getUser()

  let postsQuery = supabase
    .from('posts')
    .select(POSTS_SELECT)
    .eq('book_id', id)
    .order('created_at', { ascending: false })

  postsQuery = user
    ? postsQuery.or(`status.eq.approved,user_id.eq.${user.id}`)
    : postsQuery.eq('status', 'approved')

  const { data: postsData, error: postsError } = await postsQuery

  if (postsError) {
    console.error('[getBook] posts select failed:', postsError.message)
  }

  return {
    book,
    posts: (postsData ?? []) as unknown as BookPost[],
  }
})
