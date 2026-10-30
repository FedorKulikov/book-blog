// app/profile/[username]/page.tsx
// Server Component: профиль и посты рендерятся на сервере (SEO),
// интерактив (подписка, написать, блокировка) — в ProfileView.
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getProfile } from './getProfile'
import ProfileView from './ProfileView'
import { toPlainText, truncate } from '@/lib/text'

export const dynamic = 'force-dynamic'

const FALLBACK_OG_IMAGE = '/og-default.jpg'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>
}): Promise<Metadata> {
  const { username } = await params
  const data = await getProfile(username)

  if (!data) {
    return {
      title: 'Пользователь не найден',
      robots: { index: false, follow: false },
    }
  }

  const name = data.profile.username
  const title = name

  const description = truncate(
    toPlainText(data.profile.bio ?? '') ||
      `${name} в книжном сообществе «Хлеба и букв»: ${data.stats.posts} публикаций.`,
    200,
  )

  const images: { url: string; alt: string; width?: number; height?: number }[] =
    data.profile.avatar_url
      ? [{ url: data.profile.avatar_url, alt: name }]
      : [{ url: FALLBACK_OG_IMAGE, width: 1200, height: 630, alt: 'Хлеба и букв' }]

  return {
    title,
    description,
    alternates: { canonical: `/profile/${name}` },
    openGraph: {
      type: 'profile',
      locale: 'ru_RU',
      siteName: 'Хлеба и букв',
      url: `/profile/${name}`,
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

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ username: string }>
}) {
  const { username } = await params
  const data = await getProfile(username)

  if (!data) notFound()

  return (
    <ProfileView
      profile={data.profile}
      posts={data.posts}
      stats={data.stats}
    />
  )
}
