// app/admin/AdminTickets.tsx
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase/client'
import {
  categoryLabel,
  formatTicketDate,
  pickAuthor,
  statusMeta,
  type TicketStatus,
  type TicketWithAuthor,
} from '@/lib/support'
import { ChevronRight, LifeBuoy } from '../components/icons'

type Filter = 'all' | TicketStatus

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'open', label: 'Открытые' },
  { value: 'in_progress', label: 'В работе' },
  { value: 'closed', label: 'Закрытые' },
  { value: 'all', label: 'Все' },
]

/** Вкладка «Обращения» в админке: список всех тикетов. */
export default function AdminTickets() {
  const [tickets, setTickets] = useState<TicketWithAuthor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('open')

  useEffect(() => {
    let alive = true

    async function load() {
      const { data, error: fetchError } = await supabase
        .from('tickets')
        .select(
          'id, user_id, subject, category, status, created_at, profiles!tickets_user_id_fkey(username, avatar_url)',
        )
        .order('created_at', { ascending: false })

      if (!alive) return

      if (fetchError) {
        console.error('[admin] tickets fetch failed:', fetchError.message)
        setError('Не удалось загрузить обращения: ' + fetchError.message)
        setLoading(false)
        return
      }

      setTickets((data ?? []) as unknown as TicketWithAuthor[])
      setLoading(false)
    }

    load()

    return () => {
      alive = false
    }
  }, [])

  const counts: Record<Filter, number> = {
    all: tickets.length,
    open: tickets.filter(t => t.status === 'open').length,
    in_progress: tickets.filter(t => t.status === 'in_progress').length,
    closed: tickets.filter(t => t.status === 'closed').length,
  }

  const visible = filter === 'all' ? tickets : tickets.filter(t => t.status === filter)

  if (loading) {
    return <p className="text-sm text-brown/60">Загружаем обращения…</p>
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            className={`px-3 py-1.5 rounded-full text-xs transition-colors ${
              filter === f.value
                ? 'bg-wine text-white'
                : 'bg-cream-warm/40 text-brown-dark border border-emerald-dark/10 hover:bg-cream-warm/70'
            }`}
          >
            {f.label} ({counts[f.value]})
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-wine">{error}</p>}

      {visible.length === 0 ? (
        <div className="bg-cream-warm/15 border border-emerald-dark/10 rounded-2xl p-8 text-center">
          <LifeBuoy size={36} strokeWidth={1.4} className="text-emerald-mid/40 mx-auto mb-2" />
          <p className="text-sm text-brown/60">
            {filter === 'all' ? 'Обращений пока нет.' : 'В этом статусе обращений нет.'}
          </p>
        </div>
      ) : (
        <div className="border border-emerald-dark/10 rounded-2xl overflow-hidden">
          <div className="hidden md:grid grid-cols-[1.4fr_2fr_1fr_1fr_100px_24px] gap-3 px-4 py-2 bg-cream-warm/40 text-[11px] uppercase tracking-wider text-brown/50">
            <span>Пользователь</span>
            <span>Тема</span>
            <span>Категория</span>
            <span>Статус</span>
            <span>Дата</span>
            <span />
          </div>

          {visible.map((ticket) => {
            const author = pickAuthor(ticket.profiles)
            const status = statusMeta(ticket.status)

            return (
              <Link
                key={ticket.id}
                href={`/admin/support/${ticket.id}`}
                className="grid grid-cols-1 md:grid-cols-[1.4fr_2fr_1fr_1fr_100px_24px] gap-1 md:gap-3 items-center px-4 py-3 border-t border-emerald-dark/8 text-sm hover:bg-cream-warm/40 transition-colors"
              >
                <span className="font-medium text-brown-dark truncate">
                  {author?.username || 'Аноним'}
                </span>
                <span className="text-emerald-dark truncate">{ticket.subject}</span>
                <span className="text-xs text-brown/60">{categoryLabel(ticket.category)}</span>
                <span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${status.className}`}>
                    {status.label}
                  </span>
                </span>
                <span className="text-[11px] text-brown/45">
                  {formatTicketDate(ticket.created_at)}
                </span>
                <ChevronRight size={16} strokeWidth={1.8} className="text-brown/30" />
              </Link>
            )
          })}
        </div>
      )}

      <p className="text-[11px] text-brown/40">Всего обращений: {tickets.length}</p>
    </div>
  )
}
