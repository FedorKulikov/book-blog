// app/messages/page.tsx
// Серверная обёртка списка сообщений: гость уходит на /login до рендера.
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import MessagesPage from './MessagesClient'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Сообщения',
  robots: { index: false, follow: false },
}

export default async function MessagesRoute() {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.auth.getUser()

  if (!data.user) redirect('/login?next=%2Fmessages')

  return <MessagesPage />
}