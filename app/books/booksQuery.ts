// app/books/booksQuery.ts
// Один запрос для сервера и клиента: RPC public.get_books_page().
// Считаем статистику в БД (count одобренных постов на книгу), а не тянем
// все связи book_id в фронтенд.
import type { SupabaseClient } from '@supabase/supabase-js'

export const BOOKS_PAGE_SIZE = 20

export type BookRow = {
  id: string
  title: string | null
  author: string | null
  cover_url: string | null
  year: number | string | null
  views_count: number | null
  created_at: string
  discussion_count: number
}

export type BooksCursor = {
  createdAt: string
  id: string
}

export type BooksPageResult = {
  books: BookRow[]
  hasMore: boolean
  error: string | null
}

type RawBookRow = Omit<BookRow, 'discussion_count'> & {
  discussion_count: number | string | null
}

/**
 * Курсор по (created_at, id) — как в get_books_page().
 * Запрашиваем PAGE_SIZE + 1 строку: наличие лишней строки = «есть ещё»,
 * без отдельного COUNT-запроса.
 */
export async function fetchBooksPage(
  supabase: SupabaseClient,
  cursor: BooksCursor | null,
): Promise<BooksPageResult> {
  const { data, error } = await supabase.rpc('get_books_page', {
    p_cursor_created_at: cursor?.createdAt ?? null,
    p_cursor_id: cursor?.id ?? null,
    p_page_size: BOOKS_PAGE_SIZE + 1,
  })

  if (error) {
    console.error('[books] get_books_page failed:', error.message)
    return { books: [], hasMore: false, error: error.message }
  }

  const rows = ((data ?? []) as unknown as RawBookRow[]).map(row => ({
    ...row,
    // PostgREST может отдать bigint строкой — приводим к числу
    discussion_count: Number(row.discussion_count ?? 0),
  }))

  const hasMore = rows.length > BOOKS_PAGE_SIZE

  return {
    books: hasMore ? rows.slice(0, BOOKS_PAGE_SIZE) : rows,
    hasMore,
    error: null,
  }
}
