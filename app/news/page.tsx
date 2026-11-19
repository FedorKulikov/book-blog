// app/news/page.tsx
// Главная страница «Книжного портала». Целиком серверная: фильтр читается из
// searchParams, данные приходят уже отрендеренными — поисковики видят контент.
import type { Metadata } from 'next'
import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PenLine } from '@/app/components/icons'
import NewsCard from './NewsCard'
import NewsFilterBar from './NewsFilterBar'
import {
  NEWS_FILTERS,
  buildPortalFeed,
  fetchExternalNewsFeed,
  fetchNewsFeed,
  parseNewsFilter,
} from './newsQuery'

// Новости должны быть свежими: кеш страницы отключаем, SSR — на каждый запрос.
export const dynamic = 'force-dynamic'

type NewsPageProps = {
  // В Next.js 16 searchParams — Promise, его обязательно await.
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export async function generateMetadata({
  searchParams,
}: NewsPageProps): Promise<Metadata> {
  const params = await searchParams
  const filter = parseNewsFilter(params.category)
  const label =
    NEWS_FILTERS.find(item => item.value === filter)?.label ?? 'Все новости'

  return {
    title: `${label} — новости книжного мира`,
    description:
      'Книжные новости, конкурсы, анонсы и события: что выходит, где участвовать и что обсуждают читатели.',
    openGraph: {
      title: `${label} — новости книжного мира`,
      description:
        'Книжные новости, конкурсы, анонсы и события на «Хлеба и букв».',
      type: 'website',
    },
  }
}

export default async function NewsPage({ searchParams }: NewsPageProps) {
  const params = await searchParams
  const filter = parseNewsFilter(params.category)

  const supabase = await createSupabaseServerClient()

  // Две ленты параллельно: посты пользователей и автоматические новости из медиа.
  // Внешние приходят из external_news с проставленной рубрикой (см. импорт RSS).
  const [userFeed, externalFeed] = await Promise.all([
    fetchNewsFeed(supabase, filter),
    fetchExternalNewsFeed(supabase, filter),
  ])

  const { hero, items } = buildPortalFeed(userFeed.posts, externalFeed.items)
  const error = userFeed.error ?? externalFeed.error

  const activeLabel =
    NEWS_FILTERS.find(item => item.value === filter)?.label ?? 'Все новости'

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 md:px-8 md:py-12">
      <header className="mb-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            {/* Тёмная тема: HEX-цвета не переопределяются токенами, поэтому
                светлые варианты задаются явными dark:-классами */}
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#014b32] dark:text-[#E2E2E0]/60">
              Книжный портал
            </p>
            <h1 className="font-playfair text-3xl font-bold leading-tight text-[#0E2931] dark:text-[#E2E2E0] md:text-5xl">
              Новости
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[#4A2E27]/80 dark:text-[#E2E2E0]/70">
              Конкурсы, анонсы, новинки и события книжного мира. Пишите свои
              новости — читатели увидят их в ленте.
            </p>
          </div>

          <Link
            href="/news/new"
            className="inline-flex items-center gap-2 rounded-full bg-[#014b32] px-5 py-2.5 text-sm font-medium text-[#E2E2E0] transition-colors hover:bg-[#0E2931]"
          >
            <PenLine size={16} strokeWidth={1.8} />
            Опубликовать новость
          </Link>
        </div>
      </header>

      <NewsFilterBar active={filter} />

      {error && (
        <p className="mt-8 rounded-2xl border border-[#681F2D]/30 bg-[#681F2D]/5 p-4 text-sm text-[#681F2D] dark:text-[#c9707f]">
          Не удалось загрузить новости. Попробуйте обновить страницу позже.
        </p>
      )}

      {!error && !hero && (
        <div className="mt-10 rounded-3xl border border-[#493344] bg-[#0E2931] px-6 py-14 text-center">
          <h2 className="font-playfair text-2xl font-bold text-[#E2E2E0]">
            {filter === 'all'
              ? 'Пока новостей нет'
              : `В разделе «${activeLabel}» пока пусто`}
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-[#E2E2E0]/60">
            {filter === 'all'
              ? 'Станьте первым, кто расскажет о книжной новинке, конкурсе или событии.'
              : 'Попробуйте другую категорию или посмотрите все новости.'}
          </p>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/news/new"
              className="rounded-full bg-[#681F2D] px-5 py-2.5 text-sm font-medium text-[#E2E2E0] transition-colors hover:bg-[#4A1520]"
            >
              Написать новость
            </Link>
            {filter !== 'all' && (
              <Link
                href="/news"
                className="rounded-full border border-[#493344] px-5 py-2.5 text-sm text-[#E2E2E0]/80 transition-colors hover:border-[#014b32] hover:text-[#E2E2E0]"
              >
                Все новости
              </Link>
            )}
          </div>
        </div>
      )}

      {hero && (
        <section className="mt-8" aria-labelledby="news-lead-heading">
          <h2
            id="news-lead-heading"
            className="mb-4 font-playfair text-lg font-bold text-[#0E2931] dark:text-[#E2E2E0]"
          >
            Главное сегодня
          </h2>
          <NewsCard item={hero} variant="hero" />
        </section>
      )}

      {items.length > 0 && (
        <section className="mt-12" aria-labelledby="news-latest-heading">
          <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
            <h2
              id="news-latest-heading"
              className="font-playfair text-2xl font-bold text-[#0E2931] dark:text-[#E2E2E0] md:text-3xl"
            >
              Последние новости
            </h2>
            {filter !== 'all' && (
              <Link
                href="/news"
                className="text-sm text-[#014b32] transition-colors hover:text-[#0E2931] dark:text-[#E2E2E0]/70 dark:hover:text-[#E2E2E0]"
              >
                Смотреть все →
              </Link>
            )}
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {items.map(item => (
              <NewsCard key={item.key} item={item} />
            ))}
          </div>
        </section>
      )}

      {/* Ссылка на ленту внешних источников: страница не должна быть сиротой.
          Стиль — как у «Смотреть все»: мелкий текст, акцент в светлой теме. */}
      <div className="mt-12 border-t border-[#493344]/25 pt-6 dark:border-[#E2E2E0]/15">
        <Link
          href="/external-news"
          className="text-sm text-[#014b32] transition-colors hover:text-[#0E2931] dark:text-[#E2E2E0]/70 dark:hover:text-[#E2E2E0]"
        >
          Смотреть книжные новости из медиа →
        </Link>
      </div>
    </main>
  )
}
