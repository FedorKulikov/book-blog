// app/posts/postsQuery.ts
// Один запрос на оба случая: первый экран рендерит сервер, «Показать ещё» — клиент.
// Поэтому строка select, размер порции и правила курсора живут в одном месте,
// иначе серверная и клиентская выборки неизбежно разъедутся.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PostCardData } from '@/app/components/PostCard'

export const PAGE_SIZE = 20

export const POSTS_SELECT =
  '*, profiles!posts_user_id_fkey(username, avatar_url), post_images(url), comments(count), likes(count), post_tags(tags(name, slug)), books(id, title, author, year)'

export type PostsPageResult = {
  posts: PostCardData[]
  hasMore: boolean
  error: string | null
}

/**
 * Курсорная пагинация: берём посты строго старше `before` (created_at ISO-строкой).
 *
 * Почему не offset: если между запросами кто-то опубликует пост, offset сдвинет
 * выдачу и один и тот же пост покажется дважды (а другой — пропадёт).
 * Курсор по created_at от этого не страдает.
 *
 * PAGE_SIZE + 1 — дешёвый способ узнать, есть ли ещё данные,
 * без отдельного count-запроса по всей таблице.
 */
export async function fetchPostsPage(
  supabase: SupabaseClient,
  before: string | null,
): Promise<PostsPageResult> {
  let query = supabase
    .from('posts')
    .select(POSTS_SELECT)
    .eq('status', 'approved')
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE + 1)

  if (before) {
    query = query.lt('created_at', before)
  }

  const { data, error } = await query

  if (error) {
    return { posts: [], hasMore: false, error: error.message }
  }

  const rows = (data ?? []) as unknown as PostCardData[]
  const hasMore = rows.length > PAGE_SIZE

  return {
    posts: hasMore ? rows.slice(0, PAGE_SIZE) : rows,
    hasMore,
    error: null,
  }
}
