'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { humanizeError } from '@/lib/errors'
import Hero from '../components/Hero'
import EmptyState from '../components/EmptyState'
import { PostGridSkeleton } from '../components/Skeleton'
import SortTabs, { SortKey } from '../components/SortTabs'
import { BookOpen, Search, MessageCircle, Eye } from '../components/icons'

function BooksContent() {
  const searchParams = useSearchParams()
  const initialQuery = searchParams.get('q') || ''

  const [books, setBooks] = useState<any[]>([])
  const [postsCountByBook, setPostsCountByBook] = useState<
    Record<string, number>
  >({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sort, setSort] = useState<SortKey>('new')
  const [query, setQuery] = useState(initialQuery)

  useEffect(() => {
    async function load() {
      const { data, error: booksError } = await supabase
        .from('books')
        .select('*')
        .order('created_at', { ascending: false })

      if (booksError) {
        setError(humanizeError(booksError.message))
        setLoading(false)
        return
      }
      setBooks(data || [])

      // Сколько постов написано о каждой книге (только одобренные)
      const { data: rows } = await supabase
        .from('posts')
        .select('book_id')
        .eq('status', 'approved')
        .not('book_id', 'is', null)

      const counts: Record<string, number> = {}
      for (const row of (rows as { book_id: string | null }[] | null) ?? []) {
        if (!row.book_id) continue
        counts[row.book_id] = (counts[row.book_id] ?? 0) + 1
      }
      setPostsCountByBook(counts)
      setLoading(false)
    }
    load()
  }, [])

  const q = query.trim().toLowerCase()

  const filteredBooks = books
    .filter(b => {
      if (!q) return true
      return (
        (b.title || '').toLowerCase().includes(q) ||
        (b.author || '').toLowerCase().includes(q)
      )
    })
    .sort((a, b) => {
      if (sort === 'popular') {
        return (b.views_count ?? 0) - (a.views_count ?? 0)
      }
      if (sort === 'discussed') {
        return (postsCountByBook[b.id] ?? 0) - (postsCountByBook[a.id] ?? 0)
      }
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })

  return (
    <main className="p-4 md:p-8 max-w-7xl mx-auto">
      <Hero
        title="Книги"
        subtitle="Все книги, о которых пишут в «Хлеба и букв»"
        image="/hero-books.jpg"
      />

      <div className="space-y-6 mb-8">
        {/* Строка поиска */}
        <div className="relative">
          <Search
            size={16}
            strokeWidth={1.8}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-brown/40 pointer-events-none"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Найти книгу или автора…"
            className="w-full border border-emerald-dark/15 rounded-lg pl-9 pr-3 py-2 bg-cream-warm/40 focus:outline-none focus:border-emerald-mid"
          />
        </div>

        {/* Сортировка */}
        <SortTabs value={sort} onChange={setSort} />
      </div>

      {loading && <PostGridSkeleton count={4} />}
      {error && <p className="text-wine">Ошибка: {error}</p>}

      {!loading && !error && filteredBooks.length === 0 && (
        <EmptyState
          icon={<BookOpen size={48} strokeWidth={1.2} />}
          title={query ? 'Ничего не найдено' : 'Пока нет книг'}
          description={
            query
              ? 'Попробуйте другой запрос.'
              : 'Книги появятся, когда авторы начнут писать о них.'
          }
          action={
            !query ? { label: 'Написать пост', href: '/news/new' } : undefined
          }
        />
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
        {filteredBooks.map(book => (
          <Link key={book.id} href={`/book/${book.id}`} className="group">
            {/* Обложка */}
            <div className="aspect-[2/3] rounded-xl overflow-hidden bg-emerald-mid/10 mb-3 group-hover:opacity-90 transition-opacity relative">
              {book.cover_url ? (
                <img
                  src={book.cover_url}
                  alt={book.title}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <BookOpen
                    size={40}
                    strokeWidth={1.2}
                    className="text-emerald-mid/30"
                  />
                </div>
              )}
            </div>

            {/* Инфо */}
            <div className="text-sm font-medium text-emerald-dark group-hover:text-wine line-clamp-2 leading-snug">
              {book.title}
            </div>
            {book.author && (
              <div className="text-xs text-brown/60 mt-1 line-clamp-1">
                {book.author}
              </div>
            )}
            <div className="text-[11px] text-brown/45 mt-1 flex items-center gap-2">
              <span className="flex items-center gap-0.5">
                <MessageCircle size={10} strokeWidth={2} />
                {postsCountByBook[book.id] ?? 0}
              </span>
              <span className="flex items-center gap-0.5">
                <Eye size={10} strokeWidth={2} />
                {book.views_count ?? 0}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </main>
  )
}

export default function BooksPage() {
  return (
    <Suspense
      fallback={<main className="p-8 max-w-7xl mx-auto">Загрузка…</main>}
    >
      <BooksContent />
    </Suspense>
  )
}
