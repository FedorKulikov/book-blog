'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import ExternalNewsCard from '@/app/components/ExternalNewsCard'
import {
  fetchExternalNewsPage,
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
      {/* 1 колонка на мобильных, 2 на планшете, 3 на широком экране */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 items-start">
        {items.map(item => (
          <ExternalNewsCard key={item.id} item={item} />
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
