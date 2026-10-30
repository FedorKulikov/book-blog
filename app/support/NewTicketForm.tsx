// app/support/NewTicketForm.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import { TICKET_CATEGORIES, type TicketCategory } from '@/lib/support'

/**
 * Создание обращения одним RPC-вызовом public.create_ticket():
 * тикет и первое сообщение вставляются атомарно (в одной транзакции),
 * поэтому не бывает «тикета без сообщения».
 */
export default function NewTicketForm() {
  const router = useRouter()

  const [subject, setSubject] = useState('')
  const [category, setCategory] = useState<TicketCategory>(TICKET_CATEGORIES[0].value)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (sending) return

    const cleanSubject = subject.trim()
    const cleanMessage = message.trim()

    if (cleanSubject.length < 5) {
      setError('Тема — минимум 5 символов.')
      return
    }
    if (cleanMessage.length < 10) {
      setError('Опишите ситуацию подробнее — минимум 10 символов.')
      return
    }

    setSending(true)
    setError(null)

    const { data, error: rpcError } = await supabase.rpc('create_ticket', {
      p_subject: cleanSubject,
      p_category: category,
      p_message: cleanMessage,
    })

    if (rpcError) {
      console.error('[support] create_ticket failed:', rpcError.message)
      setError('Не удалось создать обращение: ' + rpcError.message)
      setSending(false)
      return
    }

    const ticketId = data as unknown as string | null
    setSubject('')
    setMessage('')

    if (ticketId) {
      router.push(`/support/${ticketId}`)
    }
    router.refresh()
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-cream-warm/25 border border-emerald-dark/10 rounded-2xl p-5 space-y-4"
    >
      <h2 className="font-playfair text-lg font-bold text-emerald-dark">
        Новое обращение
      </h2>

      <div>
        <label htmlFor="ticket-subject" className="block text-xs text-brown/60 mb-1">
          Тема
        </label>
        <input
          id="ticket-subject"
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={200}
          placeholder="Коротко: о чём вопрос"
          className="w-full border border-emerald-dark/15 rounded-lg px-3 py-2 text-sm bg-cream-warm/40 focus:outline-none focus:border-emerald-mid"
        />
      </div>

      <div>
        <label htmlFor="ticket-category" className="block text-xs text-brown/60 mb-1">
          Категория
        </label>
        <select
          id="ticket-category"
          value={category}
          onChange={(e) => setCategory(e.target.value as TicketCategory)}
          className="w-full border border-emerald-dark/15 rounded-lg px-3 py-2 text-sm bg-cream-warm/40 focus:outline-none focus:border-emerald-mid"
        >
          {TICKET_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="ticket-message" className="block text-xs text-brown/60 mb-1">
          Сообщение
        </label>
        <textarea
          id="ticket-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={5}
          maxLength={5000}
          placeholder="Что случилось? Что вы ожидали?"
          className="w-full border border-emerald-dark/15 rounded-lg px-3 py-2 text-sm bg-cream-warm/40 focus:outline-none focus:border-emerald-mid resize-y"
        />
      </div>

      {error && <p className="text-xs text-wine">{error}</p>}

      <button
        type="submit"
        disabled={sending}
        className="w-full bg-wine hover:bg-wine-dark text-white rounded-full py-2 text-sm transition-colors disabled:opacity-50"
      >
        {sending ? 'Отправляем…' : 'Отправить обращение'}
      </button>
    </form>
  )
}
