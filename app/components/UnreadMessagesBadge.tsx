'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function UnreadMessagesBadge({
  className = '',
}: {
  className?: string
}) {
  const [count, setCount] = useState(0)

  useEffect(() => {
    let alive = true

    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!alive) return

      if (!user) {
        setCount(0)
        return
      }

      // Общий mute уведомлений из настроек профиля
      const { data: profile } = await supabase
        .from('profiles')
        .select('notifications_muted')
        .eq('id', user.id)
        .maybeSingle()
      if (!alive) return

      if (profile?.notifications_muted === true) {
        setCount(0)
        return
      }

      const { data, error } = await supabase.rpc('count_unread_messages')
      if (!alive) return

      if (error) {
        // Функция может быть ещё не создана в БД — молча показываем 0
        setCount(0)
        return
      }
      setCount(typeof data === 'number' ? data : 0)
    }

    load()
    const timer = setInterval(load, 30000)

    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      load()
    })

    return () => {
      alive = false
      clearInterval(timer)
      sub.subscription.unsubscribe()
    }
  }, [])

  if (count <= 0) return null

  return (
    <span
      className={`bg-wine text-white text-[10px] min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center font-medium ${className}`}
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}
