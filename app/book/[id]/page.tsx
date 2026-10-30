// app/book/[id]/page.tsx
// Server Component: данные книги попадают в HTML сразу (SEO), интерактив — в BookView.
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getBook } from './getBook'
import BookView from './BookView'
import { truncate, toPlainText } from '@/lib/text'

export const dynamic = 'force-dynamic'

const FALLBACK_OG_IMAGE = '/og-default.jpg'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const data = await getBook(id)

  if (!data) {
    return { title: 'Книга не найдена', robots: { index: false, follow: false } }
  }

  const { book, posts } = data

  const title = book.title.trim() || 'Книга'
  const meta = [book.author, book.year].filter(Boolean).join(', ')

  const description = truncate(
    toPlainText(book.description ?? '') ||
      `${meta ? `${meta}. ` : ''}Посты об этой книге в сообществе «Хлеба и букв»${
        posts.length > 0 ? `: ${posts.length}` : ''
      }.`,
    200,
  )

  const images: { url: string; alt: string; width?: number; height?: number }[] =
    book.cover_url
      ? [{ url: book.cover_url, alt: `Обложка книги «${title}»` }]
      : [{ url: FALLBACK_OG_IMAGE, width: 1200, height: 630, alt: 'Хлеба и букв' }]

  return {
    title,
    description,
    alternates: { canonical: `/book/${book.id}` },
    openGraph: {
      type: 'book',
      locale: 'ru_RU',
      siteName: 'Хлеба и букв',
      url: `/book/${book.id}`,
      title,
      description,
      images,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: images.map(img => img.url),
    },
  }
}

export default async function BookPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const data = await getBook(id)

  if (!data) notFound()

  return <BookView book={data.book} posts={data.posts} />
}
