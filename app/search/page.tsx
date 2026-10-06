'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import PostCard from '../components/PostCard'
import { Search, ChevronLeft } from '../components/icons'

function SearchContent() {
  const searchParams = useSearchParams()
  const q = searchParams.get('q') || ''
  const [query, setQuery] = useState(q)
  const [posts, setPosts] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  useEffect(() => {
    setQuery(q)
    if (!q.trim()) {
      setPosts([])
      setSearched(false)
      return
    }
    doSearch(q)
  }, [q])

  async function doSearch(text: string) {
    setLoading(true)
    setSearched(true)

    const { data: { user } } = await supabase.auth.getUser()
    const userId = user?.id || '00000000-0000-0000-0000-000000000000'

    const { data } = await supabase
      .from('posts')
      .select('*, profiles!posts_user_id_fkey(username, avatar_url), post_images(url), comments(count), post_tags(tags(name, slug)), books(id, title, author, year)')
      .or(`status.eq.approved,user_id.eq.${userId}`)
      .or(`title.ilike.%${text}%,content.ilike.%${text}%`)
      .order('created_at', { ascending: false })
      .limit(50)

    setPosts(data || [])
    setLoading(false)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!query.trim()) return
    window.history.replaceState(null, '', `/search?q=${encodeURIComponent(query.trim())}`)
    doSearch(query.trim())
  }

  return (
    <main className="p-4 md:p-8 max-w-7xl mx-auto">
      <Link
        href="/"
        className="flex items-center gap-1 text-sm text-brown/70 hover:text-wine mb-6 transition-colors"
      >
        <ChevronLeft size={15} strokeWidth={2} />
        <span>На главную</span>
      </Link>

      <h1 className="font-playfair text-2xl md:text-3xl font-bold text-emerald-dark mb-6">
        Поиск
      </h1>

      <form onSubmit={handleSubmit} className="mb-8">
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Что искать? Название, автор, текст…"
            className="w-full border border-emerald-dark/15 rounded-full px-5 py-3 pl-12 text-base bg-cream-warm/40 focus:outline-none focus:border-emerald-mid"
          />
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-brown/40">
            <Search size={18} strokeWidth={1.8} />
          </span>
        </div>
      </form>

      {loading && <p className="text-brown">Ищем…</p>}

      {!loading && searched && posts.length === 0 && (
        <p className="text-brown/70">Ничего не найдено по запросу «{q}».</p>
      )}

      {!loading && !searched && (
        <p className="text-brown/60">Введите запрос и нажмите Enter.</p>
      )}

      {!loading && posts.length > 0 && (
        <>
          <p className="text-sm text-brown/60 mb-4">
            Найдено постов: {posts.length}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {posts.map(post => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
        </>
      )}
    </main>
  )
}

export default function SearchPage() {
  return (
    <Suspense fallback={<main className="p-8 max-w-7xl mx-auto">Загрузка…</main>}>
      <SearchContent />
    </Suspense>
  )
}