'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { Flame, Heart, BookOpen, Feather, MessageCircle } from './icons'

type Post = {
  id: string
  title: string
  type: string
  likes_count: number
}

export type PostType = 'news' | 'creative' | 'discussion'

const HEADINGS: Record<PostType, string> = {
  news: 'Популярные книги',
  creative: 'Популярное творчество',
  discussion: 'Обсуждаемые темы',
}

export default function PopularPosts({ type }: { type?: PostType }) {
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      let query = supabase
        .from('posts')
        .select('id, title, type, likes(count)')
        .eq('status', 'approved')

      if (type) {
        query = query.eq('type', type)
      }

      const { data } = await query.limit(50)

      if (!data) {
        setLoading(false)
        return
      }

      const sorted = (data as any[])
        .map(p => ({
          id: p.id,
          title: p.title,
          type: p.type,
          likes_count: p.likes?.[0]?.count ?? 0,
        }))
        .sort((a, b) => b.likes_count - a.likes_count)
        .slice(0, 5)

      setPosts(sorted)
      setLoading(false)
    }
    load()
  }, [type])

  if (loading || posts.length === 0) return null

  const Icon = ({ type }: { type: string }) => {
    if (type === 'creative')
      return <Feather size={13} strokeWidth={1.8} className="text-cream-warm/80" />
    if (type === 'discussion')
      return <MessageCircle size={13} strokeWidth={1.8} className="text-cream/70" />
    return <BookOpen size={13} strokeWidth={1.8} className="text-cream-warm/80" />
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Flame size={15} strokeWidth={1.7} className="text-cream-warm" />
        <h3 className="font-playfair text-base font-bold text-cream">
          {type ? HEADINGS[type] : 'Популярные посты'}
        </h3>
      </div>
      <ul className="space-y-3">
        {posts.map((p, i) => (
          <li key={p.id}>
            <Link
              href={`/post/${p.id}`}
              className="flex items-start gap-3 hover:text-cream-warm transition-colors group"
            >
              <span className="text-xs font-bold text-cream/30 w-4 pt-0.5">
                {i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-cream/90 group-hover:text-cream-warm line-clamp-2 flex items-start gap-1.5">
                  <span className="mt-0.5 flex-shrink-0">
                    <Icon type={p.type} />
                  </span>
                  <span>{p.title}</span>
                </div>
                <div className="text-[11px] text-cream/45 mt-1 flex items-center gap-1">
                  <Heart size={10} strokeWidth={1.8} fill="currentColor" />
                  <span>{p.likes_count}</span>
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
