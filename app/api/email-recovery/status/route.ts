import { NextResponse } from 'next/server'
import { isPreviewRequest } from '@/lib/env-guard'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'
import {
  getEmailRecoverySecret,
  hashEmailForRecovery,
  isEmailRecoveryConfigured,
} from '@/lib/email-recovery'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

export async function GET(request: Request) {
  if (isPreviewRequest(request)) {
    return json({ configured: false, verified: false }, 404)
  }

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return json({ error: 'Требуется вход в аккаунт' }, 401)

  if (!isEmailRecoveryConfigured()) {
    return json({ configured: false, verified: false })
  }

  const admin = getAdminClient()
  const secret = getEmailRecoverySecret()

  if (!admin || !secret || !user.email) {
    return json({ configured: false, verified: false })
  }

  const { data, error } = await admin.rpc('email_recovery_is_verified', {
    p_user_id: user.id,
    p_email_hash: hashEmailForRecovery(user.email, secret),
  })

  if (error) {
    console.error('[email-recovery] status lookup failed')
    return json({ error: 'Не удалось проверить состояние email' }, 503)
  }

  return json({ configured: true, verified: data === true })
}
