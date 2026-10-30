// app/profile/[username]/ProfileView.tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { humanizeError } from '@/lib/errors'
import PostCard from '@/app/components/PostCard'
import FollowButton from '@/app/components/FollowButton'
import ShareProfileButton from '@/app/components/ShareProfileButton'
import { Mail, UserX, UserCheck } from '@/app/components/icons'
import type { ProfilePageData } from './getProfile'

/**
 * Клиентская часть профиля. Данные (профиль, посты, статистика) уже пришли
 * с сервера — здесь только действия, требующие сессии и подтверждения:
 * написать, заблокировать/разблокировать, подписаться, поделиться.
 */
export default function ProfileView({
  profile,
  posts,
  stats,
}: ProfilePageData) {
  const router = useRouter()

  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [startingChat, setStartingChat] = useState(false)
  const [isBlocking, setIsBlocking] = useState(false)
  const [blockBusy, setBlockBusy] = useState(false)

  useEffect(() => {
    let alive = true

    async function loadViewer() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!alive) return
      setCurrentUserId(user?.id ?? null)

      if (user && user.id !== profile.id) {
        const { data: blocking } = await supabase.rpc('is_blocking', {
          other_user_id: profile.id,
        })
        if (alive) setIsBlocking(Boolean(blocking))
      }
    }

    loadViewer()

    return () => {
      alive = false
    }
  }, [profile.id])

  async function startConversation() {
    if (startingChat) return
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
    if (!currentUserId || blockBusy) return

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

  const initial = (profile.username || '?')[0].toUpperCase()

  // Фиксированная зона: сервер (UTC) и браузер не должны отдать разные даты
  const joined = profile.created_at
    ? new Intl.DateTimeFormat('ru-RU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'Europe/Moscow',
      }).format(new Date(profile.created_at))
    : ''

  const isOtherUser = currentUserId !== null && currentUserId !== profile.id

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
            {isOtherUser && (
              <button
                onClick={startConversation}
                disabled={startingChat}
                className="bg-cream-warm border border-emerald-dark/15 text-brown-dark px-4 py-2 rounded-full text-sm hover:bg-cream transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Mail size={15} strokeWidth={1.8} />
                <span>{startingChat ? 'Открываем…' : 'Написать'}</span>
              </button>
            )}
            {isOtherUser && (
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
            <ShareProfileButton username={profile.username} />
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-start">
        {posts.map(post => (
          <PostCard key={post.id} post={post} />
        ))}
      </div>
    </main>
  )
}
