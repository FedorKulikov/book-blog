// app/book/[id]/getBook.ts
// Единственный источник данных страницы книги для metadata и HTML.
import { cache } from 'react'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { PostCardData } from '@/app/components/PostCard'
import { POSTS_SELECT } from '@/app/posts/postsQuery'
import {
  getSimilarBooks,
  hasBookDescription,
  type SimilarBook,
} from './bookSeo'
import {
  getOpenLibraryBookDetails,
  type OpenLibraryBookDetails,
} from '@/lib/open-library-book'

export type BookRow = {
  id: string
  title: string
  author: string | null
  year: number | string | null
  description: string | null
  cover_url: string | null
  views_count: number | null
}

export type BookPost = PostCardData & {
  user_id: string
  likes?: { count: number }[] | null
}

export type BookPageData = {
  book: BookRow
  posts: BookPost[]
  similarBooks: SimilarBook[]
  openLibrary: OpenLibraryBookDetails
  descriptionSource: 'catalog' | 'open-library' | null
}

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
  const { data: { user } } = await supabase.auth.getUser()

  let postsQuery = supabase
    .from('posts')
    .select(POSTS_SELECT)
    .eq('book_id', id)
    .order('created_at', { ascending: false })

  postsQuery = user
    ? postsQuery.or('status.eq.approved,user_id.eq.' + user.id)
    : postsQuery.eq('status', 'approved')

  const [postsResult, candidatesResult, openLibrary] = await Promise.all([
    postsQuery,
    supabase
      .from('books')
      .select('id, title, author, year, cover_url')
      .not('author', 'is', null)
      .limit(500),
    getOpenLibraryBookDetails(book.title, book.author, {
      includeDescription: !hasBookDescription(book.description),
    }),
  ])

  if (postsResult.error) {
    console.error('[getBook] posts select failed:', postsResult.error.message)
  }
  if (candidatesResult.error) {
    console.error('[getBook] similar books select failed:', candidatesResult.error.message)
  }

  const similarBooks = getSimilarBooks(
    { id: book.id, author: book.author },
    (candidatesResult.data ?? []) as SimilarBook[],
  )

  const useOpenLibraryDescription =
    !hasBookDescription(book.description) &&
    hasBookDescription(openLibrary.description)
  const resolvedBook: BookRow = {
    ...book,
    description: useOpenLibraryDescription
      ? openLibrary.description
      : book.description,
    year: book.year ?? openLibrary.year,
  }

  const descriptionSource = hasBookDescription(book.description)
    ? 'catalog'
    : useOpenLibraryDescription
      ? 'open-library'
      : book.description
        ? 'catalog'
        : null

  return {
    book: resolvedBook,
    posts: (postsResult.data ?? []) as unknown as BookPost[],
    similarBooks,
    openLibrary,
    descriptionSource,
  }
})
