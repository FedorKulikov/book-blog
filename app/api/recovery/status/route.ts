// app/api/recovery/status/route.ts
//
// Сколько активных резервных кодов у текущего пользователя.
// Нужно интерфейсу настроек: показать «коды не созданы» и предложить их создать.
import { NextResponse } from 'next/server'
import { isPreviewRequest } from '@/lib/env-guard'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { isRecoveryConfigured } from '@/lib/recovery'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE })
}

export async function GET(request: Request) {
  if (isPreviewRequest(request)) {
    return json({ error: 'not_available_on_preview' }, 404)
  }

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return json({ error: 'Требуется вход в аккаунт' }, 401)
  }

  if (!isRecoveryConfigured()) {
    return json({ active: 0, configured: false })
  }

  const admin = getAdminClient()

  if (!admin) {
    return json({ active: 0, configured: false })
  }

  const { data, error } = await admin.rpc('count_active_recovery_codes', {
    p_user_id: user.id,
  })

  if (error) {
    return json({ error: 'Не удалось получить состояние кодов' }, 500)
  }

  return json({ active: typeof data === 'number' ? data : 0, configured: true })
}
