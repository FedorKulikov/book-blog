'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import PostCard from '@/app/components/PostCard'

export default function TagPage() {
  const params = useParams()
  const slug = params.slug as string

  const [tag, setTag] = useState<any>(null)
  const [posts, setPosts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    async function load() {
      const { data: t, error } = await supabase
        .from('tags')
        .select('*')
        .eq('slug', slug)
        .single()

      if (error || !t) {
        setNotFound(true)
        setLoading(false)
        return
      }
      setTag(t)

      // Посты с этим тегом
      const { data: pt } = await supabase
        .from('post_tags')
        .select('post_id')
        .eq('tag_id', t.id)

      const postIds = (pt || []).map(x => x.post_id)

      if (postIds.length === 0) {
        setPosts([])
        setLoading(false)
        return
      }

      const { data: { user } } = await supabase.auth.getUser()
      const userId = user?.id || '00000000-0000-0000-0000-000000000000'

      const { data: postsData } = await supabase
        .from('posts')
        .select('*, profiles!posts_user_id_fkey(username), post_images(url), comments(count), post_tags(tags(name, slug)), books(id, title, author, year)')
        .in('id', postIds)
        .or(`status.eq.approved,user_id.eq.${userId}`)
        .order('created_at', { ascending: false })

      setPosts(postsData || [])
      setLoading(false)
    }
    load()
  }, [slug])

  if (loading) {
    return <main className="p-4 md:p-8 max-w-7xl mx-auto">Загрузка…</main>
  }

  if (notFound) {
    return (
      <main className="p-4 md:p-8 max-w-7xl mx-auto">
        <p className="text-wine">Такого тега не существует.</p>
        <Link
          href="/"
          className="text-wine hover:underline text-sm mt-3 inline-block"
        >
          ← На главную
        </Link>
      </main>
    )
  }

  return (
    <main className="p-4 md:p-8 max-w-7xl mx-auto">
      <Link
        href="/"
        className="text-sm text-brown/70 hover:text-wine mb-4 inline-block"
      >
        ← На главную
      </Link>

      <div className="mb-8">
        <h1 className="text-3xl md:text-4xl font-bold text-emerald-dark">
          #{tag.name}
        </h1>
        <p className="text-brown/70 mt-2">
          Постов с этим тегом: {posts.length}
        </p>
      </div>

      {posts.length === 0 && (
        <p className="text-brown/70">Пока нет постов с этим тегом.</p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {posts.map(post => (
          <PostCard key={post.id} post={post} />
        ))}
      </div>
    </main>
  )
}