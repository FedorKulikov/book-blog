// app/book/[id]/page.tsx
// Server Component: metadata and structured data share the same indexability rule.
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getBook } from './getBook'
import BookView from './BookView'
import { truncate, toPlainText } from '@/lib/text'
import { SITE_URL } from '@/lib/site'
import JsonLd from '@/app/components/JsonLd'
import { isBookIndexable } from './bookSeo'

export const dynamic = 'force-dynamic'

const FALLBACK_OG_IMAGE = '/og-default.jpg'

function getPageDescription(description: string | null): string | undefined {
  const plain = toPlainText(description ?? '')
  return plain ? truncate(plain, 200) : undefined
}

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

  const { book, posts, similarBooks } = data
  const approvedPosts = posts.filter(post => post.status === 'approved')
  const isIndexable = isBookIndexable(
    book.description,
    similarBooks.length,
    approvedPosts.length,
  )

  const title = book.title.trim() || 'Книга'
  const description = getPageDescription(book.description)
  const images: { url: string; alt: string; width?: number; height?: number }[] = [
    { url: FALLBACK_OG_IMAGE, width: 1200, height: 630, alt: 'Хлеба и букв' },
  ]

  return {
    title,
    description,
    alternates: { canonical: '/book/' + book.id },
    robots: { index: isIndexable, follow: true },
    openGraph: {
      type: 'book',
      locale: 'ru_RU',
      siteName: 'Хлеба и букв',
      url: '/book/' + book.id,
      title,
      description,
      images,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: images.map(image => image.url),
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

  const bookUrl = SITE_URL + '/book/' + data.book.id
  const approvedPosts = data.posts.filter(post => post.status === 'approved')
  const isIndexable = isBookIndexable(
    data.book.description,
    data.similarBooks.length,
    approvedPosts.length,
  )
  const description = toPlainText(data.book.description ?? '') || undefined

  return (
    <>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'Book',
          '@id': bookUrl + '#book',
          url: bookUrl,
          name: data.book.title,
          author: data.book.author
            ? { '@type': 'Person', name: data.book.author }
            : undefined,
          datePublished: data.book.year ? String(data.book.year) : undefined,
          description,
          genre: data.openLibrary.subjects.length
            ? data.openLibrary.subjects.slice(0, 5)
            : undefined,
          image: SITE_URL + FALLBACK_OG_IMAGE,
          inLanguage: 'ru-RU',
        }}
      />
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: [
            {
              '@type': 'ListItem',
              position: 1,
              name: 'Главная',
              item: SITE_URL,
            },
            {
              '@type': 'ListItem',
              position: 2,
              name: 'Каталог книг',
              item: SITE_URL + '/books',
            },
            {
              '@type': 'ListItem',
              position: 3,
              name: data.book.title,
              item: bookUrl,
            },
          ],
        }}
      />
      <BookView
        book={data.book}
        posts={data.posts}
        similarBooks={data.similarBooks}
        openLibrarySubjects={data.openLibrary.subjects}
        descriptionSource={data.descriptionSource}
      />
    </>
  )
}
