import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import WelcomeClient from './WelcomeClient'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Добро пожаловать',
  robots: { index: false, follow: false },
}

export default async function WelcomeRoute() {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.auth.getUser()

  if (!data.user) redirect('/login?next=%2Fwelcome')

  return <WelcomeClient />
}
