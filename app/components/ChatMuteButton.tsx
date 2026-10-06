'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Bell, BellOff } from './icons'

export default function ChatMuteButton({
  conversationId,
  className = '',
}: {
  conversationId: string
  className?: string
}) {
  const [muted, setMuted] = useState(false)
  const [column, setColumn] = useState<'muted_by_user1' | 'muted_by_user2' | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data, error } = await supabase
        .from('conversations')
        .select('id, user1_id, user2_id, muted_by_user1, muted_by_user2')
        .eq('id', conversationId)
        .maybeSingle()

      if (error || !data) {
        // Колонок mute может ещё не быть в БД — тогда кнопку просто не показываем
        console.warn('[ChatMuteButton] не удалось загрузить состояние mute:', error?.message)
        return
      }

      const isUser1 = data.user1_id === user.id
      setColumn(isUser1 ? 'muted_by_user1' : 'muted_by_user2')
      setMuted(isUser1 ? !!data.muted_by_user1 : !!data.muted_by_user2)
    }
    load()
  }, [conversationId])

  async function toggleMute() {
    if (!column || busy) return

    setBusy(true)
    const next = !muted

    const { error } = await supabase
      .from('conversations')
      .update({ [column]: next })
      .eq('id', conversationId)
    setBusy(false)

    if (error) {
      console.warn('[ChatMuteButton] не удалось переключить mute:', error.message)
      return
    }
    setMuted(next)
  }

  if (!column) return null

  return (
    <button
      type="button"
      onClick={toggleMute}
      disabled={busy}
      className={`text-cream/70 hover:text-cream transition-colors p-1 disabled:opacity-50 ${className}`}
      aria-label={muted ? 'Включить уведомления' : 'Отключить уведомления'}
      title={muted ? 'Включить уведомления' : 'Отключить уведомления'}
    >
      {muted ? (
        <BellOff size={20} strokeWidth={1.8} />
      ) : (
        <Bell size={20} strokeWidth={1.8} />
      )}
    </button>
  )
}
