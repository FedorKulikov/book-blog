// app/external-news/page.tsx
// Все новости внешних источников: первая порция — на сервере (SEO),
// остальное догружается кнопкой в клиентском списке.
// Оформление — как у книжного портала /news.
import type { Metadata } from 'next'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { fetchExternalNewsPage } from './externalNewsQuery'
import ExternalNewsList from './ExternalNewsList'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Книжные новости',
  description:
    'Подборка новостей о книгах и книжном рынке со ссылками на первоисточники.',
  alternates: { canonical: '/external-news' },
}

export default async function ExternalNewsPage() {
  const supabase = await createSupabaseServerClient()
  const { items, hasMore, error } = await fetchExternalNewsPage(supabase, null)

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 md:px-8 md:py-12">
      <header className="mb-8">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#014b32] dark:text-[#E2E2E0]/60">
          Книжный портал
        </p>
        <h1 className="font-playfair text-3xl font-bold leading-tight text-[#0E2931] dark:text-[#E2E2E0] md:text-5xl">
          Книжные новости
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[#4A2E27]/80 dark:text-[#E2E2E0]/70">
          Что пишут о книгах: подборка новостей со ссылками на первоисточники.
        </p>
      </header>

      {error ? (
        <p className="rounded-2xl border border-[#681F2D]/30 bg-[#681F2D]/5 p-4 text-sm text-[#681F2D] dark:text-[#c9707f]">
          Не удалось загрузить новости. Попробуйте обновить страницу позже.
        </p>
      ) : items.length === 0 ? (
        <div className="rounded-3xl border border-[#493344] bg-[#0E2931] px-6 py-14 text-center">
          <h2 className="font-playfair text-2xl font-bold text-[#E2E2E0]">
            Пока новостей нет
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-[#E2E2E0]/60">
            Подборка обновляется автоматически — заходите позже.
          </p>
        </div>
      ) : (
        <ExternalNewsList initialItems={items} initialHasMore={hasMore} />
      )}
    </main>
  )
}
