'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { humanizeError } from '@/lib/errors'
import PostCard from '@/app/components/PostCard'
import FollowButton from '@/app/components/FollowButton'
import { Mail, UserX, UserCheck } from '@/app/components/icons'

export default function PublicProfilePage() {
  const params = useParams()
  const username = params.username as string
  const router = useRouter()

  const [profile, setProfile] = useState<any>(null)
  const [posts, setPosts] = useState<any[]>([])
  const [stats, setStats] = useState({ posts: 0, likes: 0, comments: 0 })
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [startingChat, setStartingChat] = useState(false)
  const [isBlocking, setIsBlocking] = useState(false)
  const [blockBusy, setBlockBusy] = useState(false)

  async function startConversation() {
    if (!profile || startingChat) return
    setStartingChat(true)
    const { data, error } = await supabase.rpc('get_or_create_conversation', {
      other_user_id: profile.id,
    })
    setStartingChat(false)

    if (error || !data) {
      alert('Не удалось начать диалог: ' + humanizeError(error?.message))
      return
    }
    router.push(`/messages/${data}`)
  }

  async function toggleBlock() {
    if (!profile || !currentUserId || blockBusy) return

    setBlockBusy(true)

    if (isBlocking) {
      const { error } = await supabase
        .from('user_blocks')
        .delete()
        .eq('blocker_id', currentUserId)
        .eq('blocked_id', profile.id)
      setBlockBusy(false)

      if (error) {
        alert('Не удалось разблокировать: ' + humanizeError(error.message))
        return
      }
      setIsBlocking(false)
      alert('Пользователь разблокирован')
      return
    }

    const { error } = await supabase
      .from('user_blocks')
      .insert({ blocker_id: currentUserId, blocked_id: profile.id })
    setBlockBusy(false)

    if (error) {
      alert('Не удалось заблокировать: ' + humanizeError(error.message))
      return
    }
    setIsBlocking(true)
    alert('Пользователь заблокирован. Он больше не сможет писать вам.')
  }

  useEffect(() => {
    async function load() {
      const { data: p, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('username', username)
        .single()

      if (error || !p) {
        setNotFound(true)
        setLoading(false)
        return
      }
      setProfile(p)

      const { data: { user } } = await supabase.auth.getUser()
      const userId = user?.id || '00000000-0000-0000-0000-000000000000'
      setCurrentUserId(user?.id ?? null)

      if (user && user.id !== p.id) {
        const { data: blocking } = await supabase.rpc('is_blocking', {
          other_user_id: p.id,
        })
        setIsBlocking(!!blocking)
      }

      const { data: postsData } = await supabase
        .from('posts')
        .select('*, profiles!posts_user_id_fkey(username, avatar_url), post_images(url), comments(count), post_tags(tags(name, slug)), books(id, title, author, year)')
        .eq('user_id', p.id)
        .or(`status.eq.approved,user_id.eq.${userId}`)
        .order('created_at', { ascending: false })

      setPosts(postsData || [])

      const postIds = (postsData || []).map(x => x.id)
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
        posts: postsData?.length || 0,
        likes: likesCount,
        comments: commentsCount,
      })

      setLoading(false)
    }
    load()
  }, [username])

  if (loading) {
    return <main className="p-4 md:p-8 max-w-7xl mx-auto">Загрузка…</main>
  }

  if (notFound) {
    return (
      <main className="p-4 md:p-8 max-w-7xl mx-auto">
        <p className="text-wine">Пользователь не найден.</p>
        <Link
          href="/"
          className="text-wine hover:underline text-sm mt-3 inline-block"
        >
          ← На главную
        </Link>
      </main>
    )
  }

  const initial = (profile.username || '?')[0].toUpperCase()
  const joined = profile.created_at
    ? new Date(profile.created_at).toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : ''

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

        <div className="absolute bottom-4 left-4 right-4 md:bottom-6 md:left-6 md:right-6 flex items-end gap-4 md:gap-5 flex-wrap">
          {profile.avatar_url ? (
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
              {profile.username}
            </h1>
            {profile.bio && (
              <p className="text-cream/80 text-xs md:text-sm mt-1 line-clamp-1">
                {profile.bio}
              </p>
            )}
            {joined && (
              <p className="text-cream/60 text-xs mt-1">С нами с {joined}</p>
            )}
          </div>
          <div className="pb-2 flex items-center gap-2 flex-wrap">
            <FollowButton userId={profile.id} />
            {currentUserId && currentUserId !== profile.id && (
              <button
                onClick={startConversation}
                disabled={startingChat}
                className="bg-cream-warm border border-emerald-dark/15 text-brown-dark px-4 py-2 rounded-full text-sm hover:bg-cream transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Mail size={15} strokeWidth={1.8} />
                <span>{startingChat ? 'Открываем…' : 'Написать'}</span>
              </button>
            )}
            {currentUserId && currentUserId !== profile.id && (
              <button
                onClick={toggleBlock}
                disabled={blockBusy}
                className="bg-cream-warm border border-emerald-dark/15 text-brown-dark px-4 py-2 rounded-full text-sm hover:bg-cream transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isBlocking ? (
                  <UserCheck size={15} strokeWidth={1.8} />
                ) : (
                  <UserX size={15} strokeWidth={1.8} />
                )}
                <span>
                  {blockBusy
                    ? '…'
                    : isBlocking
                    ? 'Разблокировать'
                    : 'Заблокировать'}
                </span>
              </button>
            )}
          </div>
        </div>
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

      {/* Посты */}
      <h2 className="font-playfair text-2xl font-bold text-emerald-dark mb-4">
        Публикации автора
      </h2>

      {posts.length === 0 && (
        <p className="text-brown/70">У этого автора пока нет публикаций.</p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {posts.map(post => (
          <PostCard key={post.id} post={post} />
        ))}
      </div>
    </main>
  )
}