// app/books/page.tsx
// Server Component: первая порция книг приходит с сервера (SEO),
// статистика обсуждений считается в БД через RPC get_books_page().
import type { Metadata } from 'next'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { fetchBooksPage } from './booksQuery'
import BooksClient from './BooksClient'

// Каталог всегда свежий
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Книги',
  description:
    'Каталог книг книжного сообщества «Хлеба и букв»: обзоры, обсуждения и авторы.',
  alternates: { canonical: '/books' },
}

export default async function BooksPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  // В Next.js 15/16 searchParams — это Promise
  const { q } = await searchParams

  const supabase = await createSupabaseServerClient()
  const { books, hasMore, error } = await fetchBooksPage(supabase, null)

  if (error) {
    return (
      <main className="p-8 text-center text-wine max-w-3xl mx-auto">
        Не удалось загрузить каталог книг. Попробуйте позже.
      </main>
    )
  }

  return (
    <BooksClient
      initialBooks={books}
      initialHasMore={hasMore}
      initialQuery={q ?? ''}
    />
  )
}
