'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { Calendar, ExternalLink } from './icons'
import {
  formatNewsDate,
  type ExternalNewsItem,
} from '@/app/external-news/externalNewsQuery'

/** Сколько новостей показываем в сайдбаре */
const LIMIT = 5

/**
 * Блок «Новости книжного мира» для тёмного сайдбара главной.
 * Если новостей нет — блок не рендерится вовсе (никакой пустой рамки).
 */
export default function ExternalNewsBlock() {
  const [items, setItems] = useState<ExternalNewsItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true

    void (async () => {
      const { data, error } = await supabase
        .from('external_news')
        .select('id, title, url, source, summary, created_at')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(LIMIT)

      if (!alive) return
      if (error) {
        console.error('[external-news] sidebar fetch failed:', error.message)
        setLoading(false)
        return
      }

      setItems((data ?? []) as unknown as ExternalNewsItem[])
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
              className="block rounded-xl bg-cream/5 p-3 transition-colors hover:bg-cream/10"
            >
              <span className="text-sm leading-snug text-cream/90 hover:text-cream-warm line-clamp-2">
                {item.title}
              </span>

              {item.summary && (
                <span className="mt-1 block text-[11px] text-cream/50 leading-snug line-clamp-2">
                  {item.summary}
                </span>
              )}

              <span className="mt-1.5 flex items-center gap-1.5 text-[10px] text-cream/40">
                <span>{item.source}</span>
                <span className="text-cream/20">·</span>
                <Calendar size={10} strokeWidth={1.8} />
                <span>{formatNewsDate(item.created_at)}</span>
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
