// app/support/[id]/page.tsx
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  categoryLabel,
  formatTicketDate,
  statusMeta,
  type TicketMessageRow,
  type TicketRow,
} from '@/lib/support'
import TicketThread from '../TicketThread'
import { ChevronLeft } from '../../components/icons'

export const dynamic = 'force-dynamic'

export default async function TicketPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // RLS отдаст тикет только автору или staff — 404 для остальных
  const { data: ticketData } = await supabase
    .from('tickets')
    .select('id, user_id, subject, category, status, created_at')
    .eq('id', id)
    .maybeSingle()

  if (!ticketData) notFound()

  const ticket = ticketData as unknown as TicketRow

  const { data: me } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()
  const role = (me as { role: string | null } | null)?.role
  const viewerRole: 'user' | 'staff' =
    role === 'admin' || role === 'moderator' ? 'staff' : 'user'

  const { data: messagesData, error: messagesError } = await supabase
    .from('ticket_messages')
    .select('id, ticket_id, sender_id, message, is_staff_reply, created_at')
    .eq('ticket_id', ticket.id)
    .order('created_at', { ascending: true })

  if (messagesError) {
    console.error('[support] messages fetch failed:', messagesError.message)
  }

  const messages = (messagesData ?? []) as unknown as TicketMessageRow[]
  const status = statusMeta(ticket.status)

  return (
    <main className="p-4 md:p-8 max-w-3xl mx-auto">
      <Link
        href="/support"
        className="flex items-center gap-1 text-sm text-brown/70 hover:text-wine mb-4 transition-colors"
      >
        <ChevronLeft size={15} strokeWidth={2} />
        <span>Все обращения</span>
      </Link>

      <div className="mb-5">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <span className={`text-[10px] px-2 py-0.5 rounded-full ${status.className}`}>
            {status.label}
          </span>
          <span className="text-[11px] text-brown/45">
            {categoryLabel(ticket.category)}
          </span>
          <span className="text-[11px] text-brown/45">·</span>
          <span className="text-[11px] text-brown/45">
            {formatTicketDate(ticket.created_at)}
          </span>
        </div>
        <h1 className="font-playfair text-2xl md:text-3xl font-bold text-emerald-dark leading-tight">
          {ticket.subject}
        </h1>
      </div>

      <TicketThread
        ticketId={ticket.id}
        initialMessages={messages}
        status={ticket.status}
        currentUserId={user.id}
        viewerRole={viewerRole}
      />
    </main>
  )
}
