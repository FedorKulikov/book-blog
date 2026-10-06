'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { BookOpen, Users, Eye, MessageCircle } from './icons'

type Props = {
  type: 'news' | 'creative' | 'discussion'
}

type Stats = {
  posts: number
  authors: number
  views: number
  comments: number
}

export default function SectionStats({ type }: Props) {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data: posts } = await supabase
        .from('posts')
        .select('id, user_id, views_count, comments(count)')
        .eq('type', type)
        .eq('status', 'approved')

      if (!posts) {
        setLoading(false)
        return
      }

      const uniqueAuthors = new Set<string>()
      let viewsSum = 0
      let commentsSum = 0

      for (const p of posts as any[]) {
        if (p.user_id) uniqueAuthors.add(p.user_id)
        viewsSum += p.views_count || 0
        commentsSum += p.comments?.[0]?.count ?? 0
      }

      setStats({
        posts: posts.length,
        authors: uniqueAuthors.size,
        views: viewsSum,
        comments: commentsSum,
      })
      setLoading(false)
    }
    load()
  }, [type])

  if (loading || !stats) return null
  if (stats.posts === 0) return null

  const items = [
    { Icon: BookOpen, value: stats.posts, label: 'Публикаций' },
    { Icon: Users, value: stats.authors, label: 'Авторов' },
    { Icon: Eye, value: stats.views, label: 'Просмотров' },
    { Icon: MessageCircle, value: stats.comments, label: 'Комментариев' },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4 gap-3">
      {items.map(({ Icon, value, label }, i) => (
        <div
          key={i}
          className="bg-cream-warm/30 border border-emerald-dark/10 rounded-xl px-4 py-3 flex items-center gap-3"
        >
          <Icon size={18} strokeWidth={1.6} className="text-emerald-mid flex-shrink-0" />
          <div className="min-w-0">
            <div className="font-playfair text-lg font-bold text-emerald-dark leading-tight">
              {value}
            </div>
            <div className="text-[11px] text-brown/60 uppercase tracking-wide">
              {label}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
