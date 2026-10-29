// app/posts/PostList.tsx
'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase/client'
import PostCard, { type PostCardData } from '@/app/components/PostCard'
import { fetchPostsPage } from './postsQuery'

/**
 * Лента с догрузкой. Первая порция приходит с сервера (SSR + SEO),
 * следующие — по кнопке, курсором по created_at последнего поста.
 */
export default function PostList({
  initialPosts,
  initialHasMore,
}: {
  initialPosts: PostCardData[]
  initialHasMore: boolean
}) {
  const [posts, setPosts] = useState<PostCardData[]>(initialPosts)
  const [hasMore, setHasMore] = useState(initialHasMore)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleLoadMore() {
    if (loading || !hasMore) return

    const last = posts[posts.length - 1]
    if (!last) return

    setLoading(true)
    setError(null)

    const result = await fetchPostsPage(supabase, last.created_at)

    if (result.error) {
      setError('Не удалось загрузить ещё посты. Попробуйте ещё раз.')
      setLoading(false)
      return
    }

    // Дедупликация по id: страховка на случай равных created_at у соседних постов.
    setPosts(prev => {
      const seen = new Set(prev.map(p => p.id))
      return [...prev, ...result.posts.filter(p => !seen.has(p.id))]
    })
    setHasMore(result.hasMore)
    setLoading(false)
  }

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 items-start">
        {posts.map(post => (
          <PostCard key={post.id} post={post} />
        ))}
      </div>

      <div className="flex flex-col items-center gap-3 mt-8">
        {error && <p className="text-sm text-wine">{error}</p>}

        {hasMore ? (
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={loading}
            className="px-6 py-2.5 rounded-full border border-emerald-dark/20 text-sm text-emerald-dark hover:bg-cream-warm/60 hover:border-emerald-dark/35 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Загружаем…' : 'Показать ещё'}
          </button>
        ) : (
          <p className="text-xs text-brown/45">Больше постов нет</p>
        )}

        <p className="text-xs text-brown/35">Показано: {posts.length}</p>
      </div>
    </>
  )
}
