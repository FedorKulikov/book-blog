import type { Metadata } from 'next'
import { createClient } from '@supabase/supabase-js'
import { SITE_URL } from '@/lib/site'
import JsonLd from './components/JsonLd'
import HomeClient from './HomeClient'

export const metadata: Metadata = {
  title: 'Книжное сообщество для читателей',
  description:
    'Находите книги, читайте статьи о книгах и отзывы, обсуждайте прочитанное и публикуйте рассказы, стихи и заметки в сообществе «Хлеба и букв».',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    locale: 'ru_RU',
    siteName: 'Хлеба и букв',
    title: 'Книжное сообщество для читателей — Хлеба и букв',
    description:
      'Статьи и отзывы о книгах, обсуждения прочитанного и авторское творчество в сообществе «Хлеба и букв».',
    url: '/',
    images: [
      {
        url: '/og-default.jpg',
        width: 1200,
        height: 630,
        alt: 'Хлеба и букв — книжное сообщество',
      },
    ],
  },
}

// Отключаем кэширование, чтобы лента всегда показывала свежие посты
export const dynamic = 'force-dynamic'

export default async function HomePage() {
  // Создаем чистый клиент Supabase для сервера (анонимный доступ)
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  // Запрашиваем последние одобренные посты всех типов.
  // Если RLS не разрешает анонимное чтение, тут будет ошибка.
  const { data, error } = await supabase
    .from('posts')
    .select('*, profiles!posts_user_id_fkey(username, avatar_url), post_images(url), comments(count), post_tags(tags(name, slug)), books(id, title, author, year)')
    .eq('status', 'approved')
    .order('created_at', { ascending: false })
    .limit(6)

  if (error) {
    // Выводим ошибку в терминал, чтобы увидеть причину
    console.error("ОШИБКА SUPABASE:", error)

    return (
      <div className="p-8 text-center text-wine">
        Не удалось загрузить ленту постов. Попробуйте позже.
      </div>
    )
  }

  // WebSite structured data helps search engines identify the canonical site name.
  return (
    <>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          '@id': `${SITE_URL}/#website`,
          url: SITE_URL,
          name: 'Хлеба и букв',
          description:
            'Книжное сообщество для читателей и авторов: отзывы, обсуждения книг и авторское творчество.',
          inLanguage: 'ru-RU',
          publisher: {
            '@type': 'Organization',
            name: 'Хлеба и букв',
            url: SITE_URL,
          },
        }}
      />
      <HomeClient initialPosts={data || []} />
    </>
  )
}
