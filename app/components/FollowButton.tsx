'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { UserPlus, UserCheck } from './icons'

type Props = {
  userId: string
}

export default function FollowButton({ userId }: Props) {
  const [following, setFollowing] = useState(false)
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function check() {
      const { data: { user } } = await supabase.auth.getUser()
      setUser(user)
      if (user && user.id !== userId) {
        const { data } = await supabase
          .from('follows')
          .select('*')
          .eq('follower_id', user.id)
          .eq('following_id', userId)
          .maybeSingle()
        setFollowing(!!data)
      }
      setLoading(false)
    }
    check()
  }, [userId])

  async function toggleFollow() {
    if (!user) {
      alert('Войдите, чтобы подписаться')
      return
    }

    if (following) {
      await supabase
        .from('follows')
        .delete()
        .eq('follower_id', user.id)
        .eq('following_id', userId)
      setFollowing(false)
    } else {
      await supabase
        .from('follows')
        .insert({ follower_id: user.id, following_id: userId })
      setFollowing(true)
    }
  }

  if (loading || !user || user.id === userId) return null

  return (
    <button
      onClick={toggleFollow}
      className={`flex items-center justify-center gap-2 px-4 py-2 rounded-full text-sm transition-colors ${
        following
          ? 'bg-cream-warm/50 border border-emerald-dark/15 text-brown-dark hover:bg-cream-warm'
          : 'bg-emerald-mid text-cream hover:bg-emerald-dark'
      }`}
    >
      {following ? (
        <>
          <UserCheck size={15} strokeWidth={1.8} />
          <span>Вы подписаны</span>
        </>
      ) : (
        <>
          <UserPlus size={15} strokeWidth={1.8} />
          <span>Подписаться</span>
        </>
      )}
    </button>
  )
}