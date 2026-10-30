// lib/support.ts
// Общие типы и справочники для тикет-системы.

/* ------------------------------------------------------------------ */
/* Категории                                                           */
/* ------------------------------------------------------------------ */

export const TICKET_CATEGORIES = [
  { value: 'bug', label: 'Ошибка на сайте' },
  { value: 'suggestion', label: 'Предложение' },
  { value: 'account', label: 'Аккаунт и доступ' },
  { value: 'other', label: 'Другое' },
] as const

export type TicketCategory = (typeof TICKET_CATEGORIES)[number]['value']

export function categoryLabel(value: string): string {
  return TICKET_CATEGORIES.find(c => c.value === value)?.label ?? 'Другое'
}

/* ------------------------------------------------------------------ */
/* Статусы                                                             */
/* ------------------------------------------------------------------ */

export type TicketStatus = 'open' | 'in_progress' | 'closed'

export const TICKET_STATUSES = [
  { value: 'open', label: 'Открыто', className: 'bg-emerald-mid/10 text-emerald-mid' },
  { value: 'in_progress', label: 'В работе', className: 'bg-yellow-100 text-yellow-800' },
  { value: 'closed', label: 'Закрыто', className: 'bg-brown/10 text-brown/60' },
] as const satisfies readonly { value: TicketStatus; label: string; className: string }[]

export function statusMeta(value: string): { label: string; className: string } {
  return (
    TICKET_STATUSES.find(s => s.value === value) ?? {
      label: 'Неизвестно',
      className: 'bg-brown/10 text-brown/60',
    }
  )
}

export function isTicketStatus(value: string): value is TicketStatus {
  return TICKET_STATUSES.some(s => s.value === value)
}

/* ------------------------------------------------------------------ */
/* Модели строк из PostgREST                                           */
/* ------------------------------------------------------------------ */

export type TicketRow = {
  id: string
  user_id: string
  subject: string
  category: string
  status: string
  created_at: string
}

export type TicketAuthor = {
  username: string | null
  avatar_url: string | null
}

export type TicketWithAuthor = TicketRow & {
  profiles?: TicketAuthor | TicketAuthor[] | null
}

export type TicketMessageRow = {
  id: string
  ticket_id: string
  sender_id: string
  message: string
  is_staff_reply: boolean
  created_at: string
}

/** Связь profiles в tickets — to-one, но типы PostgREST иногда дают массив. */
export function pickAuthor(value: TicketWithAuthor['profiles']): TicketAuthor | null {
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

/** Дата/время в фиксированной зоне: сервер и браузер не должны расходиться. */
export function formatTicketDate(iso: string, withTime = false): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''

  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : { year: 'numeric' }),
    timeZone: 'Europe/Moscow',
  }).format(date)
}
