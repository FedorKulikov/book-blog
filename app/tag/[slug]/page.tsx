'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { decodeTagSlug } from '@/lib/tags'
import PostCard from '@/app/components/PostCard'

type TagRecord = { id: string; name: string; slug: string }

export default function TagPage() {
  const params = useParams<{ slug: string }>()
  const slug = params.slug
  const [tag, setTag] = useState<TagRecord | null>(null)
  const [posts, setPosts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      setNotFound(false)
      setLoadError(null)
      setTag(null)
      setPosts([])
      const decodedSlug = decodeTagSlug(slug)
      if (!decodedSlug) {
        setLoadError('Адрес тега содержит некорректное кодирование.')
        setLoading(false)
        return
      }
      try {
        const { data: foundTag, error: tagError } = await supabase
          .from('tags').select('id, name, slug').eq('slug', decodedSlug).maybeSingle()
        if (!active) return
        if (tagError) {
          console.error('[tag] lookup failed:', tagError.message)
          setLoadError('Не удалось выполнить запрос тега. Попробуйте позже.')
          setLoading(false)
          return
        }
        if (!foundTag) {
          setNotFound(true)
          setLoading(false)
          return
        }
        const currentTag = foundTag as TagRecord
        setTag(currentTag)
        const { data: postTagRows, error: postTagsError } = await supabase
          .from('post_tags').select('post_id').eq('tag_id', currentTag.id)
        if (!active) return
        if (postTagsError) {
          console.error('[tag] post_tags lookup failed:', postTagsError.message)
          setLoadError('Тег найден, но не удалось загрузить связанные публикации.')
          setLoading(false)
          return
        }
        const postIds = (postTagRows ?? []).map(row => row.post_id)
        if (postIds.length === 0) {
          setPosts([])
          setLoading(false)
          return
        }
        const { data: { user } } = await supabase.auth.getUser()
        if (!active) return
        const userId = user?.id || '00000000-0000-0000-0000-000000000000'
        const { data: postsData, error: postsError } = await supabase
          .from('posts')
          .select('*, profiles!posts_user_id_fkey(username), post_images(url), comments(count), post_tags(tags(name, slug)), books(id, title, author, year)')
          .in('id', postIds)
          .or(`status.eq.approved,user_id.eq.${userId}`)
          .order('created_at', { ascending: false })
        if (!active) return
        if (postsError) {
          console.error('[tag] posts lookup failed:', postsError.message)
          setLoadError('Тег найден, но не удалось загрузить публикации.')
          setLoading(false)
          return
        }
        setPosts(postsData || [])
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown error'
        console.error('[tag] loading failed:', message)
        if (active) setLoadError('Не удалось загрузить тег. Попробуйте обновить страницу.')
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => { active = false }
  }, [slug])

  if (loading) return <main className="p-4 md:p-8 max-w-7xl mx-auto">Загрузка…</main>
  if (loadError) {
    return (
      <main className="p-4 md:p-8 max-w-7xl mx-auto">
        <p className="text-wine">{loadError}</p>
        <Link href="/" className="text-wine hover:underline text-sm mt-3 inline-block">← На главную</Link>
      </main>
    )
  }
  if (notFound || !tag) {
    return (
      <main className="p-4 md:p-8 max-w-7xl mx-auto">
        <p className="text-wine">Такого тега не существует.</p>
        <Link href="/" className="text-wine hover:underline text-sm mt-3 inline-block">← На главную</Link>
      </main>
    )
  }
  return (
    <main className="p-4 md:p-8 max-w-7xl mx-auto">
      <Link href="/" className="text-sm text-brown/70 hover:text-wine mb-4 inline-block">← На главную</Link>
      <div className="mb-8">
        <h1 className="text-3xl md:text-4xl font-bold text-emerald-dark">#{tag.name}</h1>
        <p className="text-brown/70 mt-2">Постов с этим тегом: {posts.length}</p>
      </div>
      {posts.length === 0 && <p className="text-brown/70">Пока нет постов с этим тегом.</p>}
      <div className="flex flex-col gap-6 max-w-3xl mx-auto w-full">
        {posts.map(post => <PostCard key={post.id} post={post} />)}
      </div>
    </main>
  )
}
