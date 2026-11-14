'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { BookOpen, Calendar, ExternalLink } from './icons'
import {
  EXTERNAL_NEWS_LEGACY_SELECT,
  EXTERNAL_NEWS_SELECT,
  formatNewsDate,
  normalizeExternalNewsRow,
  type ExternalNewsItem,
} from '@/app/external-news/externalNewsQuery'

/** Сколько новостей показываем в сайдбаре */
const LIMIT = 5

/**
 * Блок «Новости книжного мира» для тёмного сайдбара главной.
 * Компактный список с маленькими обложками. Если новостей нет —
 * блок не рендерится вовсе (никакой пустой рамки).
 */
export default function ExternalNewsBlock() {
  const [items, setItems] = useState<ExternalNewsItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true

    void (async () => {
      // Сначала пробуем полный набор колонок, при их отсутствии — базовый
      const load = async (select: string) =>
        supabase
          .from('external_news')
          .select(select)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(LIMIT)

      let result = await load(EXTERNAL_NEWS_SELECT)
      if (result.error && /column .* does not exist/i.test(result.error.message)) {
        result = await load(EXTERNAL_NEWS_LEGACY_SELECT)
      }

      if (!alive) return
      if (result.error) {
        console.error('[external-news] sidebar fetch failed:', result.error.message)
        setLoading(false)
        return
      }

      setItems(
        ((result.data ?? []) as unknown as Parameters<typeof normalizeExternalNewsRow>[0][]).map(
          normalizeExternalNewsRow,
        ),
      )
      setLoading(false)
    })()

    return () => {
      alive = false
    }
  }, [])

  if (loading || items.length === 0) return null

  return (
    <div className="pt-6 border-t border-cream/15">
      <div className="flex items-center gap-2 mb-4">
        <ExternalLink size={15} strokeWidth={1.7} className="text-cream-warm" />
        <h3 className="font-playfair text-base font-bold text-cream">
          Новости книжного мира
        </h3>
      </div>

      <ul className="space-y-3">
        {items.map(item => (
          <li key={item.id}>
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start gap-2.5 rounded-xl bg-cream/5 p-2.5 transition-colors hover:bg-cream/10"
            >
              {/* Маленькая обложка или заглушка */}
              <span className="w-8 h-11 shrink-0 overflow-hidden rounded bg-cream/10 flex items-center justify-center">
                {item.cover_url ? (
                  <img
                    src={item.cover_url}
                    alt=""
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <BookOpen
                    size={14}
                    strokeWidth={1.5}
                    className="text-cream/40"
                  />
                )}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block text-sm leading-snug text-cream/90 hover:text-cream-warm line-clamp-2">
                  {item.title}
                </span>

                {item.author && (
                  <span className="mt-0.5 block text-[10px] text-cream/45 line-clamp-1">
                    {item.author}
                  </span>
                )}

                <span className="mt-1 flex items-center gap-1.5 text-[10px] text-cream/40">
                  <span>{item.source}</span>
                  <span className="text-cream/20">·</span>
                  <Calendar size={10} strokeWidth={1.8} />
                  <span>{formatNewsDate(item.created_at)}</span>
                </span>
              </span>
            </a>
          </li>
        ))}
      </ul>

      <Link
        href="/external-news"
        className="mt-4 inline-flex items-center gap-1 text-xs text-cream-warm hover:text-cream transition-colors"
      >
        Все новости
        <span aria-hidden="true">→</span>
      </Link>
    </div>
  )
}
