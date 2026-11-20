// app/profile/edit/page.tsx
// Серверная обёртка редактирования профиля: гость уходит на /login до рендера.
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import EditProfilePage from './EditProfileClient'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Редактировать профиль',
  robots: { index: false, follow: false },
}

export default async function EditProfileRoute() {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.auth.getUser()

  if (!data.user) redirect('/login')

  return <EditProfilePage />
}