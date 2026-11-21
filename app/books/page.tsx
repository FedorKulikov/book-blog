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
  title: 'Каталог книг: отзывы, обзоры и обсуждения',
  description:
    'Ищите книги по названию и автору, знакомьтесь с отзывами читателей и находите публикации об интересующих вас произведениях в «Хлеба и букв».',
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

  // Кнопку «Добавить книгу» показываем только авторизованным
  const {
    data: { user },
  } = await supabase.auth.getUser()

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
      canAddBook={Boolean(user)}
    />
  )
}
