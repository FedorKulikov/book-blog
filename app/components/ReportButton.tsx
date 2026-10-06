'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Flag, CheckCircle2 } from './icons'

type Props = {
  postId?: string
  commentId?: string
}

export default function ReportButton({ postId, commentId }: Props) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSend() {
    if (!reason.trim()) return
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setError('Войдите, чтобы пожаловаться')
      return
    }

    // Rate limit
    const { data: limitCheck } = await supabase.rpc('check_and_log_action', {
      action_input: 'report',
      max_per_hour: 10,
      max_per_minute: 3,
    })

    if (limitCheck && !limitCheck.ok) {
      setError('Слишком много жалоб. Подождите немного.')
      return
    }

    const { error } = await supabase.from('reports').insert({
      reporter_id: user.id,
      post_id: postId || null,
      comment_id: commentId || null,
      reason: reason.trim(),
    })

    if (error) {
      setError(error.message)
    } else {
      setSent(true)
      setTimeout(() => {
        setOpen(false)
        setSent(false)
        setReason('')
      }, 2000)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 text-xs text-brown/40 hover:text-wine transition-colors"
        title="Пожаловаться"
      >
        <Flag size={11} strokeWidth={1.8} />
        <span>Пожаловаться</span>
      </button>
    )
  }

  return (
    <div className="mt-2 p-3 bg-cream border border-wine/15 rounded-lg text-sm w-full">
      {sent ? (
        <p className="text-emerald-mid text-xs flex items-center gap-1.5">
          <CheckCircle2 size={13} strokeWidth={2} />
          Спасибо! Жалоба отправлена модератору.
        </p>
      ) : (
        <>
          <p className="mb-2 text-brown-dark text-xs">
            Опишите проблему (спам, оскорбления, не по теме):
          </p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            className="w-full border border-emerald-dark/15 rounded px-2 py-1 text-xs bg-white focus:outline-none focus:border-emerald-mid"
            placeholder="Что не так?"
          />
          {error && <p className="text-wine text-xs mt-1">{error}</p>}
          <div className="flex gap-2 mt-2">
            <button
              onClick={handleSend}
              className="bg-wine text-white text-xs px-3 py-1 rounded hover:bg-wine-dark transition-colors"
            >
              Отправить
            </button>
            <button
              onClick={() => setOpen(false)}
              className="text-xs text-brown/60 hover:text-wine transition-colors"
            >
              Отмена
            </button>
          </div>
        </>
      )}
    </div>
  )
}