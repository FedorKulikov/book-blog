// app/support/TicketThread.tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase/client'
import {
  formatTicketDate,
  statusMeta,
  TICKET_STATUSES,
  type TicketMessageRow,
  type TicketStatus,
} from '@/lib/support'

type Props = {
  ticketId: string
  initialMessages: TicketMessageRow[]
  status: string
  currentUserId: string
  /** 'user' — обычный автор тикета, 'staff' — админ/модератор */
  viewerRole: 'user' | 'staff'
}

/**
 * Переписка по тикету. Один компонент на обе стороны:
 * у staff ответы помечаются is_staff_reply = true и доступна смена статуса.
 * Новые сообщения прилетают мгновенно через Supabase Realtime.
 */
export default function TicketThread({
  ticketId,
  initialMessages,
  status,
  currentUserId,
  viewerRole,
}: Props) {
  const router = useRouter()

  const [messages, setMessages] = useState<TicketMessageRow[]>(initialMessages)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savingStatus, setSavingStatus] = useState(false)

  const bottomRef = useRef<HTMLDivElement | null>(null)

  const isStaff = viewerRole === 'staff'
  const isClosed = status === 'closed'
  // Автор не может писать в закрытый тикет, staff — может (например, попросить уточнение)
  const canReply = isStaff || !isClosed

  // Realtime: подписка на INSERT только по этому тикету
  useEffect(() => {
    const channel = supabase
      .channel(`ticket-thread-${ticketId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'ticket_messages',
          filter: `ticket_id=eq.${ticketId}`,
        },
        (payload) => {
          const row = payload.new as TicketMessageRow
          setMessages(prev => (prev.some(m => m.id === row.id) ? prev : [...prev, row]))
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [ticketId])

  // Прокрутка вниз при новом сообщении
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length])

  async function handleSend(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (sending) return

    const clean = text.trim()
    if (clean.length < 2) {
      setError('Сообщение слишком короткое.')
      return
    }

    setSending(true)
    setError(null)

    const { data, error: insertError } = await supabase
      .from('ticket_messages')
      .insert({
        ticket_id: ticketId,
        sender_id: currentUserId,
        message: clean,
        is_staff_reply: isStaff,
      })
      .select('id, ticket_id, sender_id, message, is_staff_reply, created_at')
      .single()

    if (insertError) {
      console.error('[support] insert message failed:', insertError.message)
      setError('Не удалось отправить: ' + insertError.message)
      setSending(false)
      return
    }

    const row = data as unknown as TicketMessageRow
    // Realtime пришлёт это же сообщение — дубликат отсекаем по id
    setMessages(prev => (prev.some(m => m.id === row.id) ? prev : [...prev, row]))
    setText('')
    setSending(false)
  }

  async function handleStatusChange(next: TicketStatus) {
    if (savingStatus) return
    setSavingStatus(true)
    setError(null)

    const { error: updateError } = await supabase
      .from('tickets')
      .update({ status: next })
      .eq('id', ticketId)

    setSavingStatus(false)

    if (updateError) {
      console.error('[support] update status failed:', updateError.message)
      setError('Не удалось изменить статус: ' + updateError.message)
      return
    }

    router.refresh()
  }

  return (
    <div className="space-y-4">
      {isStaff && (
        <div className="flex flex-wrap items-center gap-3 bg-cream-warm/25 border border-emerald-dark/10 rounded-xl px-4 py-3">
          <span className="text-xs text-brown/60">Статус обращения</span>
          <select
            value={status}
            disabled={savingStatus}
            onChange={(e) => {
              if (isTicketStatusValue(e.target.value)) handleStatusChange(e.target.value)
            }}
            className="border border-emerald-dark/15 rounded-lg px-3 py-1.5 text-sm bg-cream-warm/40 focus:outline-none focus:border-emerald-mid disabled:opacity-50"
          >
            {TICKET_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          {savingStatus && <span className="text-xs text-brown/50">Сохраняем…</span>}
          <span
            className={`ml-auto text-[11px] px-2.5 py-1 rounded-full ${statusMeta(status).className}`}
          >
            {statusMeta(status).label}
          </span>
        </div>
      )}

      <div className="bg-cream-warm/15 border border-emerald-dark/10 rounded-2xl p-4 min-h-[240px] space-y-3">
        {messages.length === 0 && (
          <p className="text-sm text-brown/50 text-center py-8">Пока нет сообщений.</p>
        )}

        {messages.map((m) => {
          const fromStaff = m.is_staff_reply
          const authorLabel = fromStaff ? 'Поддержка' : isStaff ? 'Пользователь' : 'Вы'

          return (
            <div key={m.id} className={`flex ${fromStaff ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  fromStaff
                    ? 'bg-wine text-white'
                    : 'bg-cream-warm/70 text-brown-dark border border-emerald-dark/10'
                }`}
              >
                <div className="text-[10px] uppercase tracking-wider opacity-70 mb-1">
                  {authorLabel}
                </div>
                <p className="whitespace-pre-wrap break-words">{m.message}</p>
                <div className="text-[10px] opacity-60 mt-1 text-right">
                  {formatTicketDate(m.created_at, true)}
                </div>
              </div>
            </div>
          )
        })}

        <div ref={bottomRef} />
      </div>

      {error && <p className="text-xs text-wine">{error}</p>}

      {canReply ? (
        <form onSubmit={handleSend} className="space-y-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            maxLength={5000}
            placeholder={isStaff ? 'Ответ от поддержки…' : 'Ваш ответ…'}
            className="w-full border border-emerald-dark/15 rounded-lg px-3 py-2 text-sm bg-cream-warm/40 focus:outline-none focus:border-emerald-mid resize-y"
          />
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={sending}
              className="bg-wine hover:bg-wine-dark text-white rounded-full px-5 py-2 text-sm transition-colors disabled:opacity-50"
            >
              {sending ? 'Отправляем…' : 'Отправить'}
            </button>
            <span className="text-[11px] text-brown/40">
              {text.length > 0 ? `${text.length} / 5000` : 'Ctrl+Enter не нужен — просто кнопка'}
            </span>
          </div>
        </form>
      ) : (
        <div className="bg-brown/5 border border-emerald-dark/10 rounded-xl px-4 py-3 text-sm text-brown/70">
          Обращение закрыто. Если проблема осталась —{' '}
          <Link href="/support" className="text-wine hover:underline">
            создайте новое
          </Link>
          .
        </div>
      )}
    </div>
  )
}

/** type-guard для значения select (без any) */
function isTicketStatusValue(value: string): value is TicketStatus {
  return TICKET_STATUSES.some(s => s.value === value)
}
