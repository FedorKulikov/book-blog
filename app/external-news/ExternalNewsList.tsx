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
      <div className="grid grid-cols-1 items-stretch gap-6 md:grid-cols-2 lg:grid-cols-3">
        {items.map(item => (
          <ExternalNewsCard key={item.id} item={item} />
        ))}
      </div>

      <div className="mt-10 flex flex-col items-center gap-3">
        {error && (
          <p className="text-sm text-[#681F2D] dark:text-[#c9707f]">{error}</p>
        )}

        {hasMore ? (
          <button
            type="button"
            onClick={() => void handleLoadMore()}
            disabled={loadingMore}
            className="rounded-full bg-[#014b32] px-6 py-2.5 text-sm font-medium text-[#E2E2E0] transition-colors hover:bg-[#0E2931] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loadingMore ? 'Загружаем…' : 'Показать ещё'}
          </button>
        ) : (
          <p className="text-xs text-[#4A2E27]/55 dark:text-[#E2E2E0]/45">
            Показаны все новости
          </p>
        )}

        <p className="text-[11px] text-[#4A2E27]/35 dark:text-[#E2E2E0]/30">
          Загружено: {items.length}
        </p>
      </div>
    </div>
  )
}
