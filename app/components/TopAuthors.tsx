'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { BookOpen } from './icons'

type Author = {
  id: string
  username: string
  posts_count: number
  avatar_url: string | null
}

export type PostType = 'news' | 'creative' | 'discussion'

const HEADINGS: Record<PostType, string> = {
  news: 'Авторы книжных обзоров',
  creative: 'Топ авторов творчества',
  discussion: 'Самые активные в обсуждениях',
}

export default function TopAuthors({ type }: { type?: PostType }) {
  const [authors, setAuthors] = useState<Author[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      let query = supabase
        .from('posts')
        .select('user_id, profiles!posts_user_id_fkey(id, username, avatar_url)')
        .eq('status', 'approved')

      if (type) {
        query = query.eq('type', type)
      }

      const { data: posts } = await query

      if (!posts) {
        setLoading(false)
        return
      }

      const map = new Map<string, Author>()
      for (const p of posts as any[]) {
        if (!p.profiles) continue
        const id = p.profiles.id
        const username = p.profiles.username
        const avatar_url = p.profiles.avatar_url
        if (!map.has(id)) {
          map.set(id, { id, username, posts_count: 0, avatar_url })
        }
        map.get(id)!.posts_count += 1
      }

      const sorted = Array.from(map.values())
        .sort((a, b) => b.posts_count - a.posts_count)
        .slice(0, 5)

      setAuthors(sorted)
      setLoading(false)
    }
    load()
  }, [type])

  if (loading || authors.length === 0) return null

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <BookOpen size={15} strokeWidth={1.7} className="text-cream-warm" />
        <h3 className="font-playfair text-base font-bold text-cream">
          {type ? HEADINGS[type] : 'Авторы, которых стоит прочитать'}
        </h3>
      </div>
      <ul className="space-y-3">
        {authors.map(a => (
          <li key={a.id}>
            <Link
              href={`/profile/${a.username}`}
              className="group flex items-center gap-3 transition-colors"
            >
              {a.avatar_url ? (
                <img
                  src={a.avatar_url}
                  alt=""
                  className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-cream/15 text-cream flex items-center justify-center text-xs font-bold flex-shrink-0">
                  {a.username[0].toUpperCase()}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-cream/95 group-hover:text-cream-warm transition-colors truncate">
                  {a.username}
                </div>
                <div className="text-[11px] text-cream/50">
                  {a.posts_count} публикац.
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
