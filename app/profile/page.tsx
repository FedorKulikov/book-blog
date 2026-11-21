import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import ProfileClient from './ProfileClient'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Мой профиль',
  robots: { index: false, follow: false },
}

export default async function ProfileRoute() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login?next=%2Fprofile')

  return <ProfileClient initialUserId={user.id} />
}
