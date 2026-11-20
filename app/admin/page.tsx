// app/admin/page.tsx
// Серверная обёртка админки.
//
// Почему сервер: Layero отдаёт предрендеренные копии маршрутов из S3
// (X-Layero-Prerender), минуя proxy.ts. Проверка сессии и роли должна
// происходить до рендера — иначе гость получает 200 вместо редиректа.
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import AdminPage from './AdminClient'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Админ-панель',
  robots: { index: false, follow: false },
}

export default async function AdminRoute() {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.auth.getUser()

  if (!data.user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', data.user.id)
    .maybeSingle()

  const role = (profile as { role: string | null } | null)?.role

  if (role !== 'admin' && role !== 'moderator') redirect('/')

  return <AdminPage />
}