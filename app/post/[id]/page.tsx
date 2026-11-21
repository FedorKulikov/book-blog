// app/post/[id]/page.tsx
// Server Component: public approved post content and metadata are rendered on the server.
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { SITE_URL } from '@/lib/site'
import { toPlainText, truncate } from '@/lib/text'
import JsonLd from '@/app/components/JsonLd'
import { getPost } from './getPost'
import PostView from './PostView'

type PageProps = {
  params: Promise<{ id: string }>
}

const sectionLabels: Record<string, string> = {
  news: 'Книжные новости',
  creative: 'Авторское творчество',
  discussion: 'Обсуждения книг',
}

function getDescription(content: string | null, title: string, type: string) {
  const plain = toPlainText(content ?? '')
  if (plain) return truncate(plain, 170)
  return `${sectionLabels[type] ?? 'Публикация'} «${title}» в книжном сообществе «Хлеба и букв».`
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params
  const post = await getPost(id)

  if (!post) {
    return {
      title: 'Публикация не найдена',
      robots: { index: false, follow: false },
    }
  }

  // Authors may preview their own moderated posts, but those pages must not be indexed.
  if (post.status !== 'approved') {
    return {
      title: post.title || 'Публикация на модерации',
      robots: { index: false, follow: false },
    }
  }

  const description = getDescription(post.content, post.title, post.type)
  const plainContent = toPlainText(post.content ?? '')
  const metaTitle = plainContent
    ? `${post.title} — ${truncate(plainContent, 38)}`
    : post.title
  const canonical = `/post/${post.id}`
  const images = post.post_images.slice(0, 4).map(image => ({
    url: image.url,
    alt: post.title,
  }))

  return {
    title: metaTitle,
    description,
    alternates: { canonical },
    robots: { index: true, follow: true },
    openGraph: {
      type: 'article',
      locale: 'ru_RU',
      siteName: 'Хлеба и букв',
      url: canonical,
      title: metaTitle,
      description,
      publishedTime: post.created_at,
      authors: post.profiles?.username
        ? [`${SITE_URL}/profile/${encodeURIComponent(post.profiles.username)}`]
        : undefined,
      images: images.length ? images : [{ url: '/og-default.jpg', width: 1200, height: 630 }],
    },
    twitter: {
      card: 'summary_large_image',
      title: metaTitle,
      description,
      images: images.length ? images.map(image => image.url) : ['/og-default.jpg'],
    },
  }
}

export default async function PostPage({ params }: PageProps) {
  const { id } = await params
  const post = await getPost(id)

  if (!post) notFound()

  const isPublic = post.status === 'approved'
  const description = getDescription(post.content, post.title, post.type)
  const canonicalUrl = `${SITE_URL}/post/${post.id}`

  return (
    <>
      {isPublic && (
        <JsonLd
          data={{
            '@context': 'https://schema.org',
            '@type': 'BlogPosting',
            '@id': `${canonicalUrl}#article`,
            mainEntityOfPage: {
              '@type': 'WebPage',
              '@id': canonicalUrl,
            },
            headline: post.title,
            description,
            datePublished: post.created_at,
            inLanguage: 'ru-RU',
            articleSection: sectionLabels[post.type] ?? 'Публикации читателей',
            author: {
              '@type': 'Person',
              name: post.profiles?.username ?? 'Участник сообщества',
            },
            publisher: {
              '@type': 'Organization',
              name: 'Хлеба и букв',
              url: SITE_URL,
            },
            image: post.post_images.length
              ? post.post_images.slice(0, 4).map(image => image.url)
              : undefined,
            about: post.books?.title
              ? {
                  '@type': 'Book',
                  name: post.books.title,
                  author: post.books.author
                    ? { '@type': 'Person', name: post.books.author }
                    : undefined,
                }
              : undefined,
            isAccessibleForFree: true,
          }}
        />
      )}
      <PostView post={post} />
    </>
  )
}
