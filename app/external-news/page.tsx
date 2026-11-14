// app/external-news/page.tsx
// Все новости внешних источников: первая порция — на сервере (SEO),
// остальное догружается кнопкой в клиентском списке.
import type { Metadata } from 'next'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import Hero from '../components/Hero'
import { fetchExternalNewsPage } from './externalNewsQuery'
import ExternalNewsList from './ExternalNewsList'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Новости книжного мира',
  description:
    'Подборка новостей о книгах и книжном рынке: что пишут «Читай-город» и другие медиа.',
  alternates: { canonical: '/external-news' },
}

export default async function ExternalNewsPage() {
  const supabase = await createSupabaseServerClient()
  const { items, hasMore, error } = await fetchExternalNewsPage(supabase, null)

  return (
    <main className="p-4 md:p-8 max-w-5xl mx-auto">
      <Hero
        title="Новости книжного мира"
        subtitle="Что пишут о книгах: подборка редакции со ссылками на первоисточники"
        image="/hero-news.jpg"
      />

      {error ? (
        <p className="text-center text-wine py-8">
          Не удалось загрузить новости. Попробуйте позже.
        </p>
      ) : items.length === 0 ? (
        <div className="text-center py-12">
          <p className="font-playfair text-lg font-bold text-emerald-dark mb-1">
            Пока новостей нет
          </p>
          <p className="text-sm text-brown/60">
            Редакция скоро добавит первую подборку.
          </p>
        </div>
      ) : (
        <ExternalNewsList initialItems={items} initialHasMore={hasMore} />
      )}
    </main>
  )
}
