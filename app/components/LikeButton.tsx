'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

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
      className={`flex items-center gap-1.5 text-sm transition-colors ${
        liked ? 'text-wine' : 'text-brown/60 hover:text-wine'
      }`}
    >
      <span className="text-base">{liked ? '❤️' : '🤍'}</span>
      <span>{count}</span>
    </button>
  )
}