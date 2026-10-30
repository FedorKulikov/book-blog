// app/book/[id]/BookView.tsx
'use client'

import Link from 'next/link'
import PostCard from '@/app/components/PostCard'
import EmptyState from '@/app/components/EmptyState'
import ViewCounterBook from '@/app/components/ViewCounterBook'
import {
  BookOpen,
  PenLine,
  ChevronLeft,
  Eye,
  Heart,
  Users,
} from '@/app/components/icons'
import type { BookPost, BookRow } from './getBook'

/**
 * Клиентская часть страницы книги. Данные приходят готовыми с сервера,
 * здесь остаётся только интерактив: счётчик просмотров и карточки постов
 * (лайк/закладка/жалоба живут внутри PostCard).
 */
export default function BookView({
  book,
  posts,
}: {
  book: BookRow
  posts: BookPost[]
}) {
  const authorsCount = new Set(posts.map(p => p.user_id).filter(Boolean)).size
  const likesCount = posts.reduce(
    (sum, p) => sum + (p.likes?.[0]?.count ?? 0),
    0,
  )
  const viewsCount = posts.reduce((sum, p) => sum + (p.views_count ?? 0), 0)

  const stats = [
    { Icon: BookOpen, value: posts.length, label: 'Постов' },
    { Icon: Users, value: authorsCount, label: 'Авторов' },
    { Icon: Heart, value: likesCount, label: 'Лайков' },
    { Icon: Eye, value: viewsCount, label: 'Просмотров' },
  ]

  return (
    <main className="p-4 md:p-8 max-w-5xl mx-auto">
      <Link
        href="/books"
        className="flex items-center gap-1 text-sm text-brown/70 hover:text-wine mb-4 transition-colors"
      >
        <ChevronLeft size={15} strokeWidth={2} />
        <span>Все книги</span>
      </Link>

      {/* Hero-секция книги */}
      <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-6 mb-10 bg-emerald-deep rounded-2xl p-6 md:p-8 text-cream">
        {/* Обложка */}
        {book.cover_url ? (
          <img
            src={book.cover_url}
            alt={book.title}
            className="w-full aspect-[2/3] object-cover rounded-lg"
          />
        ) : (
          <div className="aspect-[2/3] bg-cream/10 rounded-lg flex items-center justify-center">
            <BookOpen size={48} strokeWidth={1.2} className="text-cream/40" />
          </div>
        )}

        {/* Инфо */}
        <div>
          <h1 className="font-playfair text-3xl md:text-4xl font-bold text-cream mb-2">
            {book.title}
          </h1>
          {book.author && (
            <p className="text-cream/80 text-lg mb-2">{book.author}</p>
          )}
          {book.year && (
            <p className="text-cream/60 text-sm mb-4">📅 {book.year}</p>
          )}
          {book.description && (
            <p className="text-cream/70 leading-relaxed mb-6">
              {book.description}
            </p>
          )}

          {/* Статистика */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            {stats.map(({ Icon, value, label }, i) => (
              <div
                key={i}
                className="bg-cream/5 border border-cream/10 rounded-xl px-3 py-2.5 flex items-center gap-2"
              >
                <Icon
                  size={16}
                  strokeWidth={1.7}
                  className="text-cream-warm flex-shrink-0"
                />
                <div className="min-w-0">
                  <div className="font-playfair text-lg font-bold text-cream leading-tight">
                    {value}
                  </div>
                  <div className="text-[11px] text-cream/50 uppercase tracking-wide">
                    {label}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Кнопка */}
          <Link
            href={`/news/new?book=${book.id}`}
            className="inline-flex items-center gap-2 bg-wine hover:bg-wine-dark text-white px-5 py-2.5 rounded-full text-sm transition-colors"
          >
            <PenLine size={15} strokeWidth={1.8} />
            <span>Написать об этой книге</span>
          </Link>
        </div>
      </div>

      <ViewCounterBook bookId={book.id} />

      <h2 className="font-playfair text-2xl font-bold text-emerald-dark mb-4">
        {posts.length === 0
          ? 'Постов пока нет'
          : `Посты об этой книге (${posts.length})`}
      </h2>

      {posts.length === 0 ? (
        <EmptyState
          icon={<BookOpen size={48} strokeWidth={1.2} />}
          title="Об этой книге ещё никто не писал"
          description="Станьте первым, кто поделится впечатлениями."
          action={{
            label: 'Написать об этой книге',
            href: `/news/new?book=${book.id}`,
          }}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-start">
          {posts.map(p => (
            <PostCard key={p.id} post={p} />
          ))}
        </div>
      )}
    </main>
  )
}
