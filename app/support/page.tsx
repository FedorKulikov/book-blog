// app/support/page.tsx
import type { Metadata } from 'next'
import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  categoryLabel,
  formatTicketDate,
  statusMeta,
  type TicketRow,
} from '@/lib/support'
import NewTicketForm from './NewTicketForm'
import Hero from '../components/Hero'
import { ChevronRight, LifeBuoy } from '../components/icons'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Поддержка',
  description: 'Обращения в поддержку книжного сообщества «Хлеба и букв».',
  robots: { index: false, follow: false },
}

export default async function SupportPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Гость: форма недоступна, но страница не 404 — объясняем, что делать
  if (!user) {
    return (
      <main className="p-4 md:p-8 max-w-3xl mx-auto">
        <Hero
          title="Поддержка"
          subtitle="Пишите нам напрямую — отвечаем в этом же диалоге."
          image="/hero-home.jpg"
        />

        <div className="bg-cream-warm/25 border border-emerald-dark/10 rounded-2xl p-8 text-center">
          <LifeBuoy size={40} strokeWidth={1.4} className="text-emerald-mid/50 mx-auto mb-3" />
          <p className="text-sm text-brown/70 mb-4">
            Чтобы написать в поддержку, войдите в аккаунт — обращения привязаны к пользователю.
          </p>
          <Link
            href="/login"
            className="inline-block bg-wine hover:bg-wine-dark text-white rounded-full px-6 py-2 text-sm transition-colors"
          >
            Войти
          </Link>
        </div>
      </main>
    )
  }

  const { data, error } = await supabase
    .from('tickets')
    .select('id, user_id, subject, category, status, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[support] tickets fetch failed:', error.message)
  }

  const tickets = (data ?? []) as unknown as TicketRow[]

  return (
    <main className="p-4 md:p-8 max-w-7xl mx-auto">
      <Hero
        title="Поддержка"
        subtitle="Пишите нам напрямую — отвечаем в этом же диалоге."
        image="/hero-home.jpg"
      />

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,380px)_1fr] gap-6 items-start">
        <NewTicketForm />

        <section>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="font-playfair text-xl font-bold text-emerald-dark">
              Мои обращения
            </h2>
            <span className="text-xs text-brown/45">Всего: {tickets.length}</span>
          </div>

          {tickets.length === 0 ? (
            <div className="bg-cream-warm/15 border border-emerald-dark/10 rounded-2xl p-8 text-center">
              <p className="text-sm text-brown/60">
                Обращений пока нет. Если что-то сломалось или есть идея — заполните форму слева.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {tickets.map((ticket) => {
                const status = statusMeta(ticket.status)
                return (
                  <Link
                    key={ticket.id}
                    href={`/support/${ticket.id}`}
                    className="flex items-start gap-3 bg-cream-warm/25 border border-emerald-dark/10 rounded-xl px-4 py-3 hover:border-emerald-dark/25 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${status.className}`}>
                          {status.label}
                        </span>
                        <span className="text-[11px] text-brown/45">
                          {categoryLabel(ticket.category)}
                        </span>
                      </div>
                      <p className="text-sm font-medium text-emerald-dark truncate">
                        {ticket.subject}
                      </p>
                      <p className="text-[11px] text-brown/45 mt-1">
                        {formatTicketDate(ticket.created_at)}
                      </p>
                    </div>
                    <ChevronRight
                      size={16}
                      strokeWidth={1.8}
                      className="text-brown/30 shrink-0 mt-1"
                    />
                  </Link>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
