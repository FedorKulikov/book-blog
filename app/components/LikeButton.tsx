'use client'

import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { Heart } from './icons'

/**
 * Ошибки приходят из триггера БД (public.likes_before_insert):
 * бан, чужой user_id, лайк неопубликованного поста.
 */
function explainLikeError(message: string): string {
  const lower = message.toLowerCase()

  if (lower.includes('заблокирован') || lower.includes('забанен')) {
    return 'Ваш аккаунт заблокирован — лайки недоступны.'
  }

  if (lower.includes('опубликован')) {
    return 'Лайкать можно только опубликованные посты.'
  }

  if (lower.includes('слишком часто')) {
    return message
  }

  if (lower.includes('duplicate') || lower.includes('already exists')) {
    return 'Вы уже поставили лайк этому посту.'
  }

  return 'Не удалось поставить лайк. Попробуйте позже.'
}

export default function LikeButton({ postId }: { postId: string }) {
  const [count, setCount] = useState(0)
  const [liked, setLiked] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user))
    loadLikes()
  }, [postId])

  async function loadLikes() {
    const { data: { user: currentUser } } = await supabase.auth.getUser()

    const { count: total } = await supabase
      .from('likes')
      .select('*', { count: 'exact', head: true })
      .eq('post_id', postId)
    setCount(total || 0)

    if (currentUser) {
      const { data } = await supabase
        .from('likes')
        .select('*')
        .eq('post_id', postId)
        .eq('user_id', currentUser.id)
        .maybeSingle()
      setLiked(!!data)
    }
  }

  async function toggleLike() {
    if (busy) return

    if (!user) {
      alert('Войдите, чтобы поставить лайк')
      return
    }

    setBusy(true)

    try {
      // Снятие лайка
      if (liked) {
        const { error } = await supabase
          .from('likes')
          .delete()
          .eq('post_id', postId)
          .eq('user_id', user.id)

        if (error) {
          console.error('[like] delete failed:', error.message)
          alert(explainLikeError(error.message))
          return
        }

        setLiked(false)
        setCount(c => Math.max(0, c - 1))
        return
      }

      // Постановка лайка. Клиентская проверка бана удалена:
      // бан, чужой user_id и статус поста проверяет триггер likes_before_insert.
      // RPC ниже — только «дружелюбный» предиктор, жёсткий лимит в БД.
      const { data: limitCheck } = await supabase.rpc('check_and_log_action', {
        action_input: 'like',
        max_per_hour: 200,
        max_per_minute: 20,
      })

      if (limitCheck && !limitCheck.ok) {
        alert('Слишком много лайков. Подождите немного.')
        return
      }

      const { error } = await supabase
        .from('likes')
        .insert({ post_id: postId, user_id: user.id })

      if (error) {
        console.error('[like] insert failed:', error.message)
        // Состояние не трогаем: в базе лайка нет, значит и на экране не должно быть
        alert(explainLikeError(error.message))
        return
      }

      setLiked(true)
      setCount(c => c + 1)
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      onClick={toggleLike}
      disabled={busy}
      aria-pressed={liked}
      aria-label={liked ? 'Убрать лайк' : 'Поставить лайк'}
      className={`flex items-center gap-1 transition-colors disabled:opacity-50 ${
        liked ? 'text-wine' : 'text-brown/55 hover:text-wine'
      }`}
    >
      <Heart
        size={13}
        strokeWidth={1.8}
        fill={liked ? 'currentColor' : 'none'}
      />
      <span>{count}</span>
    </button>
  )
}
