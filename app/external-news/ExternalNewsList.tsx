'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Calendar, ExternalLink } from '@/app/components/icons'
import {
  fetchExternalNewsPage,
  formatNewsDate,
  type ExternalNewsItem,
} from './externalNewsQuery'

export default function ExternalNewsList({
  initialItems,
  initialHasMore,
}: {
  initialItems: ExternalNewsItem[]
  initialHasMore: boolean
}) {
  const [items, setItems] = useState<ExternalNewsItem[]>(initialItems)
  const [hasMore, setHasMore] = useState(initialHasMore)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleLoadMore() {
    const last = items[items.length - 1]
    if (!last || loadingMore || !hasMore) return

    setLoadingMore(true)
    setError(null)

    const res = await fetchExternalNewsPage(supabase, {
      createdAt: last.created_at,
      id: last.id,
    })

    if (res.error) {
      setError('Не удалось загрузить новости: ' + res.error)
      setLoadingMore(false)
      return
    }

    setItems(prev => {
      const seen = new Set(prev.map(i => i.id))
      return [...prev, ...res.items.filter(i => !seen.has(i.id))]
    })
    setHasMore(res.hasMore)
    setLoadingMore(false)
  }

  return (
    <div>
      <div className="flex flex-col gap-4 max-w-3xl mx-auto w-full">
        {items.map(item => (
          <article
            key={item.id}
            className="bg-cream-warm/25 border border-emerald-dark/8 rounded-2xl p-4 md:p-5 hover:border-emerald-dark/20 transition-colors"
          >
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex items-start gap-1.5 font-playfair text-lg md:text-xl font-bold text-emerald-dark hover:text-wine transition-colors"
            >
              <span className="line-clamp-2">{item.title}</span>
              <ExternalLink
                size={14}
                strokeWidth={1.8}
                className="mt-1 shrink-0 opacity-50"
              />
            </a>

            {item.summary && (
              <p className="mt-1.5 text-sm text-brown-dark/65 leading-relaxed line-clamp-3">
                {item.summary}
              </p>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-brown/50">
              <span className="font-medium text-brown/70">{item.source}</span>
              <span className="text-brown/20">·</span>
              <span className="flex items-center gap-1">
                <Calendar size={11} strokeWidth={1.8} />
                {formatNewsDate(item.created_at)}
              </span>
            </div>
          </article>
        ))}
      </div>

      <div className="mt-8 flex flex-col items-center gap-2">
        {error && <p className="text-sm text-wine">{error}</p>}

        {hasMore ? (
          <button
            type="button"
            onClick={() => void handleLoadMore()}
            disabled={loadingMore}
            className="rounded-full bg-emerald-dark px-6 py-2.5 text-sm font-medium text-cream transition-colors hover:bg-emerald-mid disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loadingMore ? 'Загружаем…' : 'Показать ещё'}
          </button>
        ) : (
          <p className="text-xs text-brown/45">Показаны все новости</p>
        )}

        <p className="text-[11px] text-brown/30">Загружено: {items.length}</p>
      </div>
    </div>
  )
}
