'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import PostCard, { type PostCardData } from '../components/PostCard'
import ShareProfileButton from '../components/ShareProfileButton'
import {
  Pencil,
  Shield,
  UserCircle,
  ChevronRight,
  Bookmark,
} from '../components/icons'

type Profile = {
  id: string
  username: string | null
  avatar_url: string | null
  bio: string | null
  role: string | null
  created_at: string
}

type Tab = 'posts' | 'saved'

// Закладка → вложенный пост (to-one, поэтому объект, а не массив)
type BookmarkRow = { created_at: string; posts: PostCardData | null }

export default function ProfilePage() {
  const router = useRouter()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [posts, setPosts] = useState<PostCardData[]>([])
  const [stats, setStats] = useState({ posts: 0, likes: 0, comments: 0 })
  const [loading, setLoading] = useState(true)

  const [userId, setUserId] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('posts')
  const [savedPosts, setSavedPosts] = useState<PostCardData[]>([])
  const [savedLoading, setSavedLoading] = useState(false)
  const [savedError, setSavedError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
        return
      }
      setUserId(user.id)

      const { data: p } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()
      setProfile(p as unknown as Profile | null)

      const { data: postsData } = await supabase
        .from('posts')
        .select('*, profiles!posts_user_id_fkey(username, avatar_url), post_images(url), comments(count), post_tags(tags(name, slug)), books(id, title, author, year)')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      const myPosts = (postsData ?? []) as unknown as PostCardData[]
      setPosts(myPosts)

      const postIds = myPosts.map(x => x.id)
      let likesCount = 0
      let commentsCount = 0

      if (postIds.length > 0) {
        const { count: lc } = await supabase
          .from('likes')
          .select('*', { count: 'exact', head: true })
          .in('post_id', postIds)
        likesCount = lc || 0

        const { count: cc } = await supabase
          .from('comments')
          .select('*', { count: 'exact', head: true })
          .in('post_id', postIds)
        commentsCount = cc || 0
      }

      setStats({
        posts: myPosts.length,
        likes: likesCount,
        comments: commentsCount,
      })

      setLoading(false)
    }
    load()
  }, [router])

  // «Сохранённое» грузим при открытии вкладки (и при каждом возврате на неё,
  // чтобы свежие закладки появлялись без перезагрузки страницы).
  useEffect(() => {
    if (tab !== 'saved' || !userId) return

    let alive = true

    async function loadSaved() {
      setSavedLoading(true)
      setSavedError(null)

      try {
        const { data, error } = await supabase
          .from('bookmarks')
          .select('created_at, posts(*, profiles!posts_user_id_fkey(username, avatar_url), post_images(url), comments(count), post_tags(tags(name, slug)), books(id, title, author, year))')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })

        if (!alive) return

        if (error) {
          console.error('[profile] bookmarks select failed:', error.message)
          setSavedError('Не удалось загрузить сохранённое.')
          setSavedPosts([])
          return
        }

        const rows = (data ?? []) as unknown as BookmarkRow[]
        // Пост мог стать недоступен по RLS (например, ушёл на модерацию) — отбрасываем null.
        setSavedPosts(
          rows.map(r => r.posts).filter((p): p is PostCardData => p !== null),
        )
      } catch (error) {
        console.error('[profile] bookmarks failed:', error)
        if (alive) setSavedError('Не удалось загрузить сохранённое.')
      } finally {
        if (alive) setSavedLoading(false)
      }
    }

    loadSaved()

    return () => {
      alive = false
    }
  }, [tab, userId])

  if (loading) {
    return <main className="p-4 md:p-8 max-w-7xl mx-auto">Загрузка…</main>
  }

  const initial = (profile?.username || '?')[0].toUpperCase()
  const joined = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : ''

  const tabClass = (active: boolean) =>
    `flex items-center gap-2 px-4 py-2 rounded-full text-sm transition-colors ${
      active
        ? 'bg-wine text-white'
        : 'bg-cream-warm/40 text-brown-dark border border-emerald-dark/10 hover:bg-cream-warm/70'
    }`

  return (
    <main className="p-4 md:p-8 max-w-7xl mx-auto">
      {/* Баннер */}
      <div className="relative rounded-2xl overflow-hidden mb-6 h-56 md:h-72">
        <img
          src="/hero-profile.jpg"
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-emerald-dark/95 via-emerald-dark/60 to-transparent" />

        <div className="absolute bottom-4 left-4 right-4 md:bottom-6 md:left-6 md:right-6 flex items-end gap-4 md:gap-5">
          {profile?.avatar_url ? (
            <img
              src={profile.avatar_url}
              alt=""
              className="w-20 h-20 md:w-28 md:h-28 rounded-full object-cover flex-shrink-0 border-4 border-cream shadow-lg"
            />
          ) : (
            <div className="w-20 h-20 md:w-28 md:h-28 rounded-full bg-wine text-white flex items-center justify-center text-3xl md:text-5xl font-bold flex-shrink-0 border-4 border-cream shadow-lg">
              {initial}
            </div>
          )}
          <div className="flex-1 min-w-0 pb-1">
            <h1 className="font-playfair text-xl md:text-3xl font-bold text-cream truncate">
              {profile?.username}
            </h1>
            {profile?.bio && (
              <p className="text-cream/80 text-xs md:text-sm mt-1 line-clamp-1">
                {profile.bio}
              </p>
            )}
            {joined && (
              <p className="text-cream/60 text-xs mt-1">
                С нами с {joined}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Кнопки */}
      <div className="flex flex-col md:flex-row gap-3 mb-8">
        <Link
          href={`/profile/${profile?.username}`}
          className="flex items-center justify-center gap-2 bg-cream-warm/40 border border-emerald-dark/10 text-emerald-dark px-4 py-2 rounded-full text-sm hover:bg-cream-warm/70 transition-colors"
        >
          <UserCircle size={16} strokeWidth={1.7} />
          <span>Публичный профиль</span>
          <ChevronRight size={14} strokeWidth={2} />
        </Link>
        {profile?.username && (
          <ShareProfileButton username={profile.username} />
        )}
        <Link
          href="/profile/edit"
          className="flex items-center justify-center gap-2 bg-emerald-mid text-cream px-4 py-2 rounded-full text-sm hover:bg-emerald-dark transition-colors"
        >
          <Pencil size={15} strokeWidth={1.8} />
          <span>Редактировать профиль</span>
        </Link>
        {(profile?.role === 'admin' || profile?.role === 'moderator') && (
          <Link
            href="/admin"
            className="flex items-center justify-center gap-2 bg-brown text-cream px-4 py-2 rounded-full text-sm hover:bg-brown-dark transition-colors"
          >
            <Shield size={15} strokeWidth={1.8} />
            <span>Админ-панель</span>
          </Link>
        )}
      </div>

      {/* Статистика */}
      <div className="grid grid-cols-3 gap-3 md:gap-5 mb-10">
        <div className="bg-cream-warm/30 border border-emerald-dark/10 rounded-2xl p-4 md:p-5 text-center">
          <div className="font-playfair text-2xl md:text-3xl font-bold text-emerald-dark">
            {stats.posts}
          </div>
          <div className="text-xs md:text-sm text-brown/70 mt-1">
            Публикаций
          </div>
        </div>
        <div className="bg-cream-warm/30 border border-emerald-dark/10 rounded-2xl p-4 md:p-5 text-center">
          <div className="font-playfair text-2xl md:text-3xl font-bold text-wine">
            {stats.likes}
          </div>
          <div className="text-xs md:text-sm text-brown/70 mt-1">Лайков</div>
        </div>
        <div className="bg-cream-warm/30 border border-emerald-dark/10 rounded-2xl p-4 md:p-5 text-center">
          <div className="font-playfair text-2xl md:text-3xl font-bold text-emerald-mid">
            {stats.comments}
          </div>
          <div className="text-xs md:text-sm text-brown/70 mt-1">
            Комментариев
          </div>
        </div>
      </div>

      {/* Вкладки: свои посты / сохранённое */}
      <div className="flex items-center gap-2 mb-4">
        <button
          type="button"
          onClick={() => setTab('posts')}
          className={tabClass(tab === 'posts')}
          aria-pressed={tab === 'posts'}
        >
          Мои публикации
        </button>
        <button
          type="button"
          onClick={() => setTab('saved')}
          className={tabClass(tab === 'saved')}
          aria-pressed={tab === 'saved'}
        >
          <Bookmark
            size={14}
            strokeWidth={1.8}
            fill={tab === 'saved' ? 'currentColor' : 'none'}
          />
          Сохранённое
        </button>
      </div>

      {tab === 'posts' && (
        <>
          {posts.length === 0 && (
            <p className="text-brown/70">
              У вас пока нет публикаций.{' '}
              <Link href="/news/new" className="text-wine hover:underline">
                Создать первый пост
              </Link>
              ?
            </p>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-start">
            {posts.map(post => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
        </>
      )}

      {tab === 'saved' && (
        <>
          {savedLoading && (
            <p className="text-sm text-brown/60">Загружаем сохранённое…</p>
          )}

          {!savedLoading && savedError && (
            <p className="text-sm text-wine">{savedError}</p>
          )}

          {!savedLoading && !savedError && savedPosts.length === 0 && (
            <p className="text-brown/70">
              Вы пока ничего не сохранили. Нажмите{' '}
              <Bookmark
                size={13}
                strokeWidth={1.8}
                className="inline align-[-2px] text-wine"
              />{' '}
              на карточке поста, чтобы вернуться к нему позже.
            </p>
          )}

          {!savedLoading && !savedError && savedPosts.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-start">
              {savedPosts.map(post => (
                <PostCard key={post.id} post={post} />
              ))}
            </div>
          )}
        </>
      )}
    </main>
  )
}
