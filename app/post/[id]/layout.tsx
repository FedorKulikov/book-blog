// app/post/[id]/layout.tsx
// Мета-теги страницы поста. Данные берём из getPost() — того же модуля,
// что и page.tsx: благодаря cache() запрос к Supabase выполняется один раз.
import type { Metadata } from 'next'
import { getPost } from './getPost'
import { toPlainText, truncate } from '@/lib/text'

const FALLBACK_OG_IMAGE = '/og-default.jpg' // public/og-default.jpg, 1200×630
const DESCRIPTION_LIMIT = 200
const DEFAULT_DESCRIPTION =
  'Новости, обсуждения и авторские тексты книжного сообщества «Хлеба и букв».'

/* ------------------------------------------------------------------ */
/* Метаданные                                                          */
/* ------------------------------------------------------------------ */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const post = await getPost(id)

  if (!post) {
    return {
      title: 'Пост не найден',
      robots: { index: false, follow: false },
    }
  }

  const book = post.books
  const image = post.post_images[0]?.url ?? book?.cover_url ?? null

  const title = post.title.trim() || 'Пост'

  const bookPrefix =
    book?.title
      ? `Книга «${book.title}»${book.author ? ` — ${book.author}` : ''}${
          book.year ? `, ${book.year}` : ''
        }. `
      : ''

  // Сначала префикс с книгой, потом очистка markdown и обрезка по границе слова.
  const description = truncate(
    bookPrefix + (toPlainText(post.content ?? '') || DEFAULT_DESCRIPTION),
    DESCRIPTION_LIMIT,
  )

  const images: { url: string; alt: string; width?: number; height?: number }[] = image
    ? [{ url: image, alt: title }]
    : [{ url: FALLBACK_OG_IMAGE, width: 1200, height: 630, alt: 'Хлеба и букв' }]

  const isPublic = post.status === 'approved'

  return {
    title,
    description,
    alternates: { canonical: `/post/${post.id}` },
    robots: isPublic ? undefined : { index: false, follow: false },
    openGraph: {
      type: 'article',
      locale: 'ru_RU',
      siteName: 'Хлеба и букв',
      url: `/post/${post.id}`,
      title,
      description,
      // Next ждёт ISO-строку (а не Date); created_at из Postgres уже ISO.
      publishedTime: post.created_at || undefined,
      images,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: images.map((img) => img.url),
    },
  }
}

export default function PostLayout({ children }: { children: React.ReactNode }) {
  return children
}
