'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Heart } from './icons'

export default function LikeButton({ postId }: { postId: string }) {
  const [count, setCount] = useState(0)
  const [liked, setLiked] = useState(false)
  const [user, setUser] = useState<any>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user))
    loadLikes()
  }, [postId])

  async function loadLikes() {
    const { data: { user } } = await supabase.auth.getUser()

    const { count: total } = await supabase
      .from('likes')
      .select('*', { count: 'exact', head: true })
      .eq('post_id', postId)
    setCount(total || 0)

    if (user) {
      const { data } = await supabase
        .from('likes')
        .select('*')
        .eq('post_id', postId)
        .eq('user_id', user.id)
        .maybeSingle()
      setLiked(!!data)
    }
  }

  async function toggleLike() {
    if (!user) {
      alert('Войдите, чтобы поставить лайк')
      return
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('is_banned')
      .eq('id', user.id)
      .single()

    if (profile?.is_banned) {
      alert('Ваш аккаунт заблокирован')
      return
    }

    // Rate limit — только для постановки, не для снятия
    if (!liked) {
      const { data: limitCheck } = await supabase.rpc('check_and_log_action', {
        action_input: 'like',
        max_per_hour: 200,
        max_per_minute: 20,
      })

      if (limitCheck && !limitCheck.ok) {
        alert('Слишком много лайков. Подождите немного.')
        return
      }
    }

    if (liked) {
      await supabase
        .from('likes')
        .delete()
        .eq('post_id', postId)
        .eq('user_id', user.id)
      setLiked(false)
      setCount(c => c - 1)
    } else {
      await supabase
        .from('likes')
        .insert({ post_id: postId, user_id: user.id })
      setLiked(true)
      setCount(c => c + 1)
    }
  }

  return (
    <button
      onClick={toggleLike}
      className={`flex items-center gap-1 transition-colors ${
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