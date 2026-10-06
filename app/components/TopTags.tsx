'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { Hash, Tag } from './icons'

type TagCount = {
  name: string
  slug: string
  count: number
}

export type PostType = 'news' | 'creative' | 'discussion'

export default function TopTags({ type }: { type?: PostType }) {
  const [tags, setTags] = useState<TagCount[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      // !inner — чтобы фильтры по posts.status / posts.type реально отсекали строки
      let query = supabase
        .from('post_tags')
        .select('tags(name, slug), posts!inner(type, status)')
        .eq('posts.status', 'approved')

      if (type) {
        query = query.eq('posts.type', type)
      }

      const { data } = await query

      if (!data) {
        setLoading(false)
        return
      }

      const map = new Map<string, TagCount>()
      for (const row of data as any[]) {
        const t = row.tags
        if (!t) continue
        if (!map.has(t.slug)) {
          map.set(t.slug, { name: t.name, slug: t.slug, count: 0 })
        }
        map.get(t.slug)!.count += 1
      }

      const sorted = Array.from(map.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, 8)

      setTags(sorted)
      setLoading(false)
    }
    load()
  }, [type])

  if (loading || tags.length === 0) return null

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Tag size={15} strokeWidth={1.7} className="text-cream-warm" />
        <h3 className="font-playfair text-base font-bold text-cream">
          Популярные теги
        </h3>
      </div>
      <div className="flex flex-wrap gap-2">
        {tags.map(t => (
          <Link
            key={t.slug}
            href={`/tag/${t.slug}`}
            className="flex items-center gap-1 text-[11px] text-cream/60 hover:text-cream-warm transition-colors"
          >
            <Hash size={10} strokeWidth={2.2} />
            <span>{t.name}</span>
            <span className="text-cream/30 ml-0.5">{t.count}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
