// app/book/[id]/BookView.tsx
'use client'

import Link from 'next/link'
import PostCard from '@/app/components/PostCard'
import EmptyState from '@/app/components/EmptyState'
import ViewCounterBook from '@/app/components/ViewCounterBook'
import StorageImage from '@/app/components/StorageImage'
import {
  BookOpen,
  PenLine,
  ChevronLeft,
  Eye,
  Heart,
  Users,
} from '@/app/components/icons'
import type { BookPost, BookRow } from './getBook'
import type { SimilarBook } from './bookSeo'

export default function BookView({
  book,
  posts,
  similarBooks,
  openLibrarySubjects,
  descriptionSource,
}: {
  book: BookRow
  posts: BookPost[]
  similarBooks: SimilarBook[]
  openLibrarySubjects: string[]
  descriptionSource: 'catalog' | 'open-library' | null
}) {
  const authorsCount = new Set(posts.map(post => post.user_id).filter(Boolean)).size
  const likesCount = posts.reduce(
    (sum, post) => sum + (post.likes?.[0]?.count ?? 0),
    0,
  )
  const viewsCount = posts.reduce((sum, post) => sum + (post.views_count ?? 0), 0)

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

      <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-6 mb-10 bg-emerald-deep rounded-2xl p-6 md:p-8 text-cream">
        {book.cover_url ? (
          <StorageImage
            src={book.cover_url}
            alt={book.title}
            className="w-full aspect-[2/3] object-cover rounded-lg"
          />
        ) : (
          <div className="aspect-[2/3] bg-cream/10 rounded-lg flex items-center justify-center">
            <BookOpen size={48} strokeWidth={1.2} className="text-cream/40" />
          </div>
        )}

        <div>
          <h1 className="font-playfair text-3xl md:text-4xl font-bold text-cream mb-2">
            {book.title}
          </h1>
          {book.author && (
            <p className="text-cream/80 text-lg mb-2">{book.author}</p>
          )}
          {book.year && (
            <p className="text-cream/60 text-sm mb-2">📅 {book.year}</p>
          )}
          {openLibrarySubjects.length > 0 && (
            <p className="text-cream/70 text-sm mb-3">
              <span className="font-semibold">Жанры и темы:</span>{' '}
              {openLibrarySubjects.slice(0, 5).join(' · ')}
              <span className="block text-cream/40 text-xs mt-1">Данные Open Library</span>
            </p>
          )}

          <div className="mb-6">
            <h2 className="font-playfair text-xl font-bold text-cream mb-2">
              О книге
            </h2>
            <p className="text-cream/80 leading-relaxed whitespace-pre-line">
              {book.description?.trim() ||
                'Описание книги не найдено ни в каталоге, ни в Open Library.'}
            </p>
            {descriptionSource === 'open-library' && (
              <p className="text-cream/40 text-xs mt-2">Источник описания: Open Library</p>
            )}
            {descriptionSource === 'catalog' && (
              <p className="text-cream/40 text-xs mt-2">Аннотация из каталога книги</p>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            {stats.map(({ Icon, value, label }) => (
              <div
                key={label}
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

          <Link
            href={'/news/new?book=' + book.id}
            className="inline-flex items-center gap-2 bg-wine hover:bg-wine-dark text-white px-5 py-2.5 rounded-full text-sm transition-colors"
          >
            <PenLine size={15} strokeWidth={1.8} />
            <span>Обсудить книгу</span>
          </Link>
        </div>
      </div>

      <ViewCounterBook bookId={book.id} />

      {similarBooks.length >= 3 && (
        <section aria-labelledby="similar-books-heading" className="mb-10">
          <h2
            id="similar-books-heading"
            className="font-playfair text-2xl font-bold text-emerald-dark mb-4"
          >
            Похожие книги
          </h2>
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {similarBooks.map(similarBook => (
              <li key={similarBook.id}>
                <Link
                  href={'/book/' + similarBook.id}
                  className="block h-full rounded-xl border border-emerald-dark/10 bg-white/60 dark:bg-black/10 p-4 hover:border-wine/50 transition-colors"
                >
                  <span className="block font-semibold text-emerald-dark dark:text-cream">
                    {similarBook.title}
                  </span>
                  {similarBook.author && (
                    <span className="block text-sm text-brown/70 dark:text-cream/60 mt-1">
                      {similarBook.author}
                    </span>
                  )}
                  {similarBook.year && (
                    <span className="block text-xs text-brown/50 dark:text-cream/40 mt-1">
                      {similarBook.year}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="book-posts-heading">
        <h2
          id="book-posts-heading"
          className="font-playfair text-2xl font-bold text-emerald-dark mb-4"
        >
          {posts.length > 0
            ? 'Отзывы и публикации (' + posts.length + ')'
            : 'Отзывы и публикации'}
        </h2>

        {posts.length === 0 ? (
          <EmptyState
            icon={<BookOpen size={48} strokeWidth={1.2} />}
            title="Пока нет отзывов и публикаций"
            description="Обсудите книгу первым: поделитесь впечатлениями или задайте вопрос."
            action={{
              label: 'Обсудить книгу',
              href: '/news/new?book=' + book.id,
            }}
          />
        ) : (
          <div className="flex flex-col gap-6 max-w-3xl mx-auto w-full">
            {posts.map(post => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
