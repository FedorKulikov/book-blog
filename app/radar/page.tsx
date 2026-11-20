// app/radar/page.tsx
// В«РљРЅРёР¶РЅС‹Р№ СЂР°РґР°СЂВ» вЂ” РґР°С€Р±РѕСЂРґ РєРЅРёР¶РЅРѕРіРѕ РјРёСЂР°: С‚СЂРµРЅРґС‹ РЅРµРґРµР»Рё, РіР»Р°РІРЅРѕРµ СЃРµР№С‡Р°СЃ,
// РјРёСЂРѕРІР°СЏ РїРѕР»РєР° Рё Р°С„РёС€Р°. РџРѕР»РЅРѕСЃС‚СЊСЋ СЃРµСЂРІРµСЂРЅР°СЏ СЃС‚СЂР°РЅРёС†Р°: РґР°РЅРЅС‹Рµ РїСЂРёС…РѕРґСЏС‚
// РіРѕС‚РѕРІС‹РјРё РІ HTML, РїРѕРёСЃРєРѕРІРёРєРё РІРёРґСЏС‚ РєРѕРЅС‚РµРЅС‚.
import type { Metadata } from 'next'
import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { ExternalLink } from '@/app/components/icons'
import ExternalNewsCover from '@/app/components/ExternalNewsCover'
import { formatNewsDate } from '@/app/news/newsQuery'
import {
  fetchEventCalendar,
  fetchTopNow,
  fetchTrends,
  fetchWorldShelf,
  type RadarNewsItem,
} from './radarQuery'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'РљРЅРёР¶РЅС‹Р№ СЂР°РґР°СЂ вЂ” С‡С‚Рѕ РїСЂРѕРёСЃС…РѕРґРёС‚ РІ РєРЅРёР¶РЅРѕРј РјРёСЂРµ',
  description:
    'РўСЂРµРЅРґС‹ РЅРµРґРµР»Рё, РіР»Р°РІРЅС‹Рµ РєРЅРёР¶РЅС‹Рµ РЅРѕРІРѕСЃС‚Рё Р РѕСЃСЃРёРё Рё РјРёСЂР°, Р°С„РёС€Р° Р»РёС‚РµСЂР°С‚СѓСЂРЅС‹С… СЃРѕР±С‹С‚РёР№.',
}

/** Р—Р°РіРѕР»РѕРІРѕРє РґР»СЏ РїРѕРєР°Р·Р°: СЂСѓСЃСЃРєРёР№, РµСЃР»Рё СЂРµРґР°РєС‚РѕСЂ РµРіРѕ РІРїРёСЃР°Р» */
function displayTitle(item: RadarNewsItem): string {
  return item.titleRu?.trim() ? item.titleRu : item.title
}

function NewsRow({ item }: { item: RadarNewsItem }) {
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex gap-4 rounded-2xl border border-[#493344] bg-[#0E2931] p-4 transition-colors hover:border-[#014b32]"
    >
      <span className="relative block h-16 w-24 shrink-0 overflow-hidden rounded-xl bg-[#12484C]">
        <ExternalNewsCover url={item.cover} alt="" iconSize={20} />
      </span>

      <span className="min-w-0">
        <span className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-[#E2E2E0]/50">
          {item.isForeign && (
            <span className="rounded-full bg-[#493344] px-2 py-0.5 font-medium text-[#E2E2E0]">
              EN
            </span>
          )}
          <span>{item.source ?? 'РњРµРґРёР°'}</span>
          <span className="text-[#E2E2E0]/25">В·</span>
          <span>{formatNewsDate(item.createdAt)}</span>
        </span>

        <span className="block font-playfair text-base font-bold leading-snug text-[#E2E2E0] transition-colors group-hover:text-[#2B7574] line-clamp-2">
          {displayTitle(item)}
        </span>
      </span>
    </a>
  )
}

function BlockHead({
  title,
  hint,
}: {
  title: string
  hint?: string
}) {
  return (
    <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="font-playfair text-xl font-bold text-[#0E2931] dark:text-[#E2E2E0] md:text-2xl">
        {title}
      </h2>
      {hint && <span className="text-xs text-[#4A2E27]/60 dark:text-[#E2E2E0]/50">{hint}</span>}
    </div>
  )
}

export default async function RadarPage() {
  const supabase = await createSupabaseServerClient()

  const [trends, topNow, world, events] = await Promise.all([
    fetchTrends(supabase),
    fetchTopNow(supabase),
    fetchWorldShelf(supabase),
    fetchEventCalendar(supabase),
  ])

  const themes = trends.filter(item => item.kind === 'theme')
  const books = trends.filter(item => item.kind === 'book')
  const names = trends.filter(item => item.kind === 'name')

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 md:px-8 md:py-12">
      <header className="mb-10">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#014b32] dark:text-[#E2E2E0]/60">
          РљРЅРёР¶РЅС‹Р№ СЂР°РґР°СЂ
        </p>
        <h1 className="font-playfair text-3xl font-bold leading-tight text-[#0E2931] dark:text-[#E2E2E0] md:text-5xl">
          Р§С‚Рѕ РїСЂРѕРёСЃС…РѕРґРёС‚ РІ РєРЅРёР¶РЅРѕРј РјРёСЂРµ
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[#4A2E27]/80 dark:text-[#E2E2E0]/70">
          РђРІС‚РѕРјР°С‚РёС‡РµСЃРєР°СЏ СЃРІРѕРґРєР°: Рѕ С‡С‘Рј РїРёС€СѓС‚ СЂРѕСЃСЃРёР№СЃРєРёРµ Рё Р·Р°СЂСѓР±РµР¶РЅС‹Рµ РёР·РґР°РЅРёСЏ,
          С‡С‚Рѕ СЃР»СѓС‡РёР»РѕСЃСЊ Р·Р° РїРѕСЃР»РµРґРЅРёРµ СЃСѓС‚РєРё Рё РєСѓРґР° РїРѕР№С‚Рё.
        </p>
      </header>

      {trends.length > 0 && (
        <section aria-labelledby="radar-trends" className="mb-12">
          <h2 id="radar-trends" className="sr-only">
            Рћ С‡С‘Рј РїРёС€СѓС‚
          </h2>
          <BlockHead
            title="Рћ С‡С‘Рј РїРёС€СѓС‚"
            hint="С‚РµРјС‹, РєРЅРёРіРё Рё РёРјРµРЅР° РїРѕ СѓРїРѕРјРёРЅР°РЅРёСЏРј Р·Р° РјРµСЃСЏС†"
          />

          <div className="flex flex-wrap gap-2">
            {themes.map(item => (
              <Link
                key={`theme-${item.topic}`}
                href={`/news?topic=${encodeURIComponent(item.terms.join('|'))}&label=${encodeURIComponent(item.topic)}`}
                className="inline-flex items-baseline gap-2 rounded-full bg-[#014b32] px-4 py-2 text-sm font-medium text-[#E2E2E0] transition-colors hover:bg-[#0E2931]"
              >
                {item.topic}
                {item.mentions > 1 && (
                  <span className="text-xs text-[#E2E2E0]/60">Г—{item.mentions}</span>
                )}
              </Link>
            ))}

            {books.map(item => (
              <Link
                key={`book-${item.topic}`}
                href={`/news?topic=${encodeURIComponent(item.terms.join('|'))}&label=${encodeURIComponent(item.topic)}`}
                className="inline-flex items-baseline gap-2 rounded-full bg-[#681F2D] px-4 py-2 text-sm font-medium text-[#E2E2E0] transition-colors hover:bg-[#4A1520]"
                title="РќР°Р·РІР°РЅРёРµ РєРЅРёРіРё"
              >
                {item.topic}
                {item.mentions > 1 && (
                  <span className="text-xs text-[#E2E2E0]/60">Г—{item.mentions}</span>
                )}
              </Link>
            ))}

            {names.map(item => (
              <Link
                key={`name-${item.topic}`}
                href={`/news?topic=${encodeURIComponent(item.terms.join('|'))}&label=${encodeURIComponent(item.topic)}`}
                className="inline-flex items-baseline gap-2 rounded-full border border-[#493344] bg-[#0E2931] px-4 py-2 text-sm text-[#E2E2E0] transition-colors hover:border-[#681F2D]"
              >
                {item.topic}
                {item.mentions > 1 && (
                  <span className="text-xs text-[#E2E2E0]/50">Г—{item.mentions}</span>
                )}
              </Link>
            ))}
          </div>
        </section>
      )}

      {topNow.length > 0 && (
        <section aria-labelledby="radar-top" className="mb-12">
          <h2 id="radar-top" className="sr-only">
            Р“Р»Р°РІРЅРѕРµ СЃРµР№С‡Р°СЃ
          </h2>
          <BlockHead title="Р“Р»Р°РІРЅРѕРµ СЃРµР№С‡Р°СЃ" hint="СЃРІРµР¶РµРµ Р·Р° РґРІРѕРµ СЃСѓС‚РѕРє" />

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {topNow.map(item => (
              <NewsRow key={item.id} item={item} />
            ))}
          </div>
        </section>
      )}

      {world.length > 0 && (
        <section aria-labelledby="radar-world" className="mb-12">
          <h2 id="radar-world" className="sr-only">
            РњРёСЂРѕРІР°СЏ РїРѕР»РєР°
          </h2>
          <BlockHead
            title="РњРёСЂРѕРІР°СЏ РїРѕР»РєР°"
            hint="Р·Р°СЂСѓР±РµР¶РЅС‹Рµ РёР·РґР°РЅРёСЏ, РїРµСЂРµРІРѕРґ вЂ” СЂРµРґР°РєС‚РѕСЂСЃРєРёР№"
          />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {world.map(item => (
              <a
                key={item.id}
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex flex-col overflow-hidden rounded-2xl border border-[#493344] bg-[#0E2931] transition-colors hover:border-[#014b32]"
              >
                <span className="relative block aspect-[2/1] w-full overflow-hidden bg-[#12484C]">
                  <ExternalNewsCover url={item.cover} alt="" />
                  <span className="absolute left-3 top-3 rounded-full bg-[#493344] px-2.5 py-0.5 text-[11px] font-medium text-[#E2E2E0]">
                    EN
                  </span>
                </span>

                <span className="flex flex-1 flex-col p-4">
                  <span className="mb-2 font-playfair text-base font-bold leading-snug text-[#E2E2E0] transition-colors group-hover:text-[#2B7574] line-clamp-3">
                    {displayTitle(item)}
                  </span>

                  {item.titleRu && (
                    <span className="mb-2 text-xs italic leading-snug text-[#E2E2E0]/50 line-clamp-2">
                      {item.title}
                    </span>
                  )}

                  <span className="mt-auto flex items-center justify-between gap-2 text-[11px] text-[#E2E2E0]/50">
                    <span className="truncate">{item.source ?? 'РњРµРґРёР°'}</span>
                    <span className="flex items-center gap-1">
                      {formatNewsDate(item.createdAt)}
                      <ExternalLink size={11} strokeWidth={1.8} />
                    </span>
                  </span>
                </span>
              </a>
            ))}
          </div>
        </section>
      )}

      {events.length > 0 && (
        <section aria-labelledby="radar-events">
          <h2 id="radar-events" className="sr-only">
            РђС„РёС€Р°
          </h2>
          <BlockHead title="РђС„РёС€Р°" hint="Р°РЅРѕРЅСЃС‹ Р»РёС‚РµСЂР°С‚СѓСЂРЅС‹С… СЃРѕР±С‹С‚РёР№" />

          <div className="space-y-8">
            {events.map(bucket => (
              <div key={bucket.title}>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.15em] text-[#4A2E27]/60 dark:text-[#E2E2E0]/50">
                  {bucket.title}
                </h3>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {bucket.items.map(item => (
                    <NewsRow key={item.id} item={item} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {trends.length === 0 && topNow.length === 0 && world.length === 0 && (
        <div className="rounded-3xl border border-[#493344] bg-[#0E2931] px-6 py-14 text-center">
          <h2 className="font-playfair text-2xl font-bold text-[#E2E2E0]">
            Р Р°РґР°СЂ РїРѕРєР° РїСѓСЃС‚
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-[#E2E2E0]/60">
            Р”Р°РЅРЅС‹Рµ РїРѕСЏРІСЏС‚СЃСЏ РїРѕСЃР»Рµ Р±Р»РёР¶Р°Р№С€РµРіРѕ Р·Р°РїСѓСЃРєР° РёРјРїРѕСЂС‚Р° РЅРѕРІРѕСЃС‚РµР№.
          </p>
        </div>
      )}

      <div className="mt-12 border-t border-[#493344]/25 pt-6 dark:border-[#E2E2E0]/15">
        <Link
          href="/news"
          className="text-sm text-[#014b32] transition-colors hover:text-[#0E2931] dark:text-[#E2E2E0]/70 dark:hover:text-[#E2E2E0]"
        >
          РЎРјРѕС‚СЂРµС‚СЊ Р»РµРЅС‚Сѓ РЅРѕРІРѕСЃС‚РµР№ в†’
        </Link>
      </div>
    </main>
  )
}
