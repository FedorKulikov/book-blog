// app/post/[id]/getPost.ts
// Единственный источник данных о посте: его вызывают и page.tsx, и layout.tsx.
// cache() из React гарантирует, что за один запрос к сайту функция сходила
// в Supabase РОВНО ОДИН РАЗ, сколько бы компонентов её ни вызвали.
//
// ВАЖНО ПРО КЕШ: cache() — это memoization в пределах ОДНОГО запроса,
// а не общий кеш между пользователями. Поэтому хранить здесь данные,
// зависящие от сессии (пост на модерации, приватное), безопасно:
// чужой пользователь физически не может получить результат этого вызова.
// А вот unstable_cache()/`fetch` с ревалидацией сюда ставить НЕЛЬЗЯ —
// это уже межзапросный кеш, и он бы сливал чужие приватные посты.
import { cache } from 'react'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/* ------------------------------------------------------------------ */
/* Публичные типы (их использует PostView и layout)                    */
/* ------------------------------------------------------------------ */

export type PostImage = {
  url: string
  sort_order: number | null
}

export type PostBook = {
  id: string
  title: string | null
  author: string | null
  year: number | string | null
  cover_url: string | null
}

export type PostAuthor = {
  username: string | null
  avatar_url: string | null
}

export type PostDetail = {
  id: string
  user_id: string
  title: string
  content: string | null
  type: string
  status: string
  created_at: string
  views_count: number | null
  post_images: PostImage[]
  books: PostBook | null
  profiles: PostAuthor | null
}

/* ------------------------------------------------------------------ */
/* Сырые строки PostgREST (там всё nullable и связи могут быть массивом) */
/* ------------------------------------------------------------------ */

type RawPostImage = {
  url: string | null
  sort_order: number | null
}

type RawPostRow = Omit<PostDetail, 'post_images' | 'books' | 'profiles'> & {
  post_images: RawPostImage[] | null
  books: PostBook | PostBook[] | null
  profiles: PostAuthor | PostAuthor[] | null
}

/* ------------------------------------------------------------------ */
/* Запрос                                                              */
/* ------------------------------------------------------------------ */

// ВАЖНО: строка должна быть ОДНИМ литералом. Если склеивать её из частей через `+`,
// supabase-js теряет вывод типов и возвращает GenericStringError вместо строки поста.
const POST_SELECT =
  'id, user_id, title, content, type, status, created_at, views_count, profiles!posts_user_id_fkey(username, avatar_url), post_images(url, sort_order), books(id, title, author, year, cover_url)'

// Отсекаем мусорные URL (/post/abc) до запроса: Postgres упал бы на касте к uuid.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Пост по id или null, если его нет или RLS не разрешает его этому пользователю. */
export const getPost = cache(async (id: string): Promise<PostDetail | null> => {
  if (!UUID_RE.test(id)) return null

  // Клиент читает куки текущего запроса: для автора это его JWT,
  // для анонима — пусто. RLS решает, что вернуть.
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('posts')
    .select(POST_SELECT)
    .eq('id', id)
    .order('sort_order', { referencedTable: 'post_images', ascending: true })
    .maybeSingle()

  if (error) {
    console.error('[getPost] posts select failed:', error.message)
    return null
  }

  if (!data) return null

  // Типы, выведенные supabase-js из строки select, строже наших: PostgREST
  // отдаёт числовые поля строками, а to-one связи иногда массивом.
  // Поэтому приводим к нашей ручной модели через unknown (без any).
  const row = data as unknown as RawPostRow

  return {
    id: row.id,
    user_id: row.user_id,
    title: row.title,
    content: row.content,
    type: row.type,
    status: row.status,
    created_at: row.created_at,
    views_count: row.views_count,
    // Пустые url (если такие остались в базе) выкидываем — иначе получим битую картинку.
    post_images: (row.post_images ?? []).filter(
      (img): img is PostImage =>
        typeof img.url === 'string' && img.url.trim().length > 0,
    ),
    // Связь books в posts — to-one; на всякий случай нормализуем массив.
    books: Array.isArray(row.books) ? (row.books[0] ?? null) : row.books,
    profiles: Array.isArray(row.profiles) ? (row.profiles[0] ?? null) : row.profiles,
  }
})
