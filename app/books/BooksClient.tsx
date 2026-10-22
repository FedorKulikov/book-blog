'use client'

import { useState } from 'react'
import Link from 'next/link'
import Hero from '../components/Hero'
import EmptyState from '../components/EmptyState'
import SortTabs, { SortKey } from '../components/SortTabs'
import { BookOpen, Search, MessageCircle, Eye } from '../components/icons'

export default function BooksClient({
  initialBooks,
  initialPostsCountByBook,
  initialQuery = '',
}: {
  initialBooks: any[]
  initialPostsCountByBook: Record<string, number>
  initialQuery?: string
}) {
  const [books] = useState<any[]>(initialBooks)
  const [postsCountByBook] = useState<Record<string, number>>(
    initialPostsCountByBook
  )
  const [sort, setSort] = useState<SortKey>('new')
  const [query, setQuery] = useState(initialQuery)

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

      {filteredBooks.length === 0 && (
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
