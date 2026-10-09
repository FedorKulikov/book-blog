'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import PostCard from '../components/PostCard'
import EmptyState from '../components/EmptyState'
import { Search, ChevronLeft, ChevronRight, User } from '../components/icons'

function SearchContent() {
  const searchParams = useSearchParams()
  const q = searchParams.get('q') || ''
  const [tab, setTab] = useState<'posts' | 'people'>('posts')
  const [query, setQuery] = useState(q)
  const [posts, setPosts] = useState<any[]>([])
  const [people, setPeople] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  useEffect(() => {
    let alive = true

    async function run() {
      // Первый await — чтобы setState не выполнялся синхронно в эффекте
      // (правило react-hooks/set-state-in-effect)
      await Promise.resolve()
      if (!alive) return

      setQuery(q)
      if (!q.trim()) {
        setPosts([])
        setPeople([])
        setSearched(false)
        return
      }
      // Смена таба НЕ сбрасывает запрос — переищем тот же текст в другом разделе
      if (tab === 'people') {
        await doSearchPeople(q)
      } else {
        await doSearch(q)
      }
    }

    run()
    return () => {
      alive = false
    }
  }, [q, tab])

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

  async function doSearchPeople(text: string) {
    setLoading(true)
    setSearched(true)

    // Запятые и % _ ломают синтаксис .or()/.ilike — вычищаем
    const safe = text.replace(/[,%_]/g, ' ').trim()

    const { data } = await supabase
      .from('profiles')
      .select('id, username, avatar_url, bio, created_at')
      .or(`username.ilike.%${safe}%,bio.ilike.%${safe}%`)
      .limit(30)

    setPeople(data || [])
    setLoading(false)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const text = query.trim()
    if (!text) return
    window.history.replaceState(null, '', `/search?q=${encodeURIComponent(text)}`)
    if (tab === 'people') {
      doSearchPeople(text)
    } else {
      doSearch(text)
    }
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
        {tab === 'posts' ? 'Поиск по постам' : 'Поиск людей'}
      </h1>

      {/* Табы: посты / люди */}
      <div className="flex gap-2 mb-6">
        <button
          type="button"
          onClick={() => setTab('posts')}
          className={`px-4 py-1.5 rounded-full text-sm transition-colors ${
            tab === 'posts'
              ? 'bg-wine text-white'
              : 'bg-cream-warm/40 text-brown-dark border border-emerald-dark/10 hover:bg-cream-warm/70'
          }`}
        >
          📚 Посты
        </button>
        <button
          type="button"
          onClick={() => setTab('people')}
          className={`px-4 py-1.5 rounded-full text-sm transition-colors ${
            tab === 'people'
              ? 'bg-wine text-white'
              : 'bg-cream-warm/40 text-brown-dark border border-emerald-dark/10 hover:bg-cream-warm/70'
          }`}
        >
          👤 Люди
        </button>
      </div>

      <form onSubmit={handleSubmit} className="mb-8">
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tab === 'posts' ? 'Что искать? Название, автор, текст…' : 'Имя пользователя или слово из био…'}
            className="w-full border border-emerald-dark/15 rounded-full px-5 py-3 pl-12 text-base bg-cream-warm/40 focus:outline-none focus:border-emerald-mid"
          />
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-brown/40">
            <Search size={18} strokeWidth={1.8} />
          </span>
        </div>
      </form>

      {loading && <p className="text-brown">Ищем…</p>}

      {!loading && searched && tab === 'posts' && posts.length === 0 && (
        <p className="text-brown/70">Ничего не найдено по запросу «{q}».</p>
      )}

      {!loading && searched && tab === 'people' && people.length === 0 && (
        <EmptyState
          icon={<User size={48} strokeWidth={1.2} />}
          title="Никого не нашли"
          description={`По запросу «${q}» пользователи не найдены. Попробуйте другой ник.`}
        />
      )}

      {!loading && !searched && (
        <p className="text-brown/60">Введите запрос и нажмите Enter.</p>
      )}

      {!loading && tab === 'posts' && posts.length > 0 && (
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

      {!loading && tab === 'people' && people.length > 0 && (
        <>
          <p className="text-sm text-brown/60 mb-4">
            Найдено людей: {people.length}
          </p>
          <div className="space-y-2">
            {people.map(p => (
              <Link
                key={p.id}
                href={`/profile/${p.username}`}
                className="flex items-center gap-4 p-4 rounded-xl hover:bg-cream-warm/50 border border-emerald-dark/8 transition-colors"
              >
                {/* Аватар */}
                <div className="w-14 h-14 rounded-full bg-emerald-mid text-cream flex items-center justify-center font-bold text-lg overflow-hidden flex-shrink-0">
                  {p.avatar_url ? (
                    <img src={p.avatar_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    (p.username?.[0] || '?').toUpperCase()
                  )}
                </div>

                {/* Инфо */}
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-emerald-dark text-base truncate">
                    {p.username}
                  </div>
                  {p.bio && (
                    <p className="text-sm text-brown/60 line-clamp-1 mt-0.5">
                      {p.bio}
                    </p>
                  )}
                  {p.created_at && (
                    <p className="text-xs text-brown/40 mt-1">
                      С нами с{' '}
                      {new Date(p.created_at).toLocaleDateString('ru-RU', {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                      })}
                    </p>
                  )}
                </div>

                {/* Стрелка */}
                <ChevronRight size={18} strokeWidth={1.8} className="text-brown/30 flex-shrink-0" />
              </Link>
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