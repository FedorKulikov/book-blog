// app/api/recovery/generate/route.ts
//
// Выдача нового набора резервных кодов.
// Требует действующую сессию И повторный ввод пароля: смена набора
// аннулирует все прежние коды, то есть действие по последствиям
// сравнимо со сменой пароля.
import { NextResponse } from 'next/server'
import { isPreviewRequest } from '@/lib/env-guard'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'
import {
  CODES_PER_BATCH,
  generateRecoveryCodes,
  hashCode,
  isRecoveryConfigured,
} from '@/lib/recovery'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE })
}

export async function POST(request: Request) {
  if (isPreviewRequest(request)) {
    return json({ error: 'not_available_on_preview' }, 404)
  }

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.email) {
    return json({ error: 'Требуется вход в аккаунт' }, 401)
  }

  let password = ''
  try {
    const body: unknown = await request.json()
    if (body && typeof body === 'object' && 'password' in body) {
      const value = (body as { password?: unknown }).password
      if (typeof value === 'string') password = value
    }
  } catch {
    return json({ error: 'Некорректный запрос' }, 400)
  }

  if (!password) {
    return json({ error: 'Подтвердите пароль' }, 400)
  }

  // Перепроверка пароля идёт через обычный anon-клиент: никакого
  // service_role для проверки пароля не нужно.
  const { error: reauthError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password,
  })

  if (reauthError) {
    return json({ error: 'Неверный пароль' }, 403)
  }

  if (!isRecoveryConfigured()) {
    return json(
      {
        error:
          'Восстановление по резервным кодам не настроено на сервере. ' +
          'Нужны переменные SUPABASE_SERVICE_ROLE_KEY и RECOVERY_CODE_SECRET.',
      },
      503,
    )
  }

  const admin = getAdminClient()
  const secret = process.env.RECOVERY_CODE_SECRET

  if (!admin || !secret) {
    return json({ error: 'Восстановление по резервным кодам недоступно' }, 503)
  }

  const codes = generateRecoveryCodes(CODES_PER_BATCH)
  const hashes = codes.map(code => hashCode(code, secret))

  const { data, error } = await admin.rpc('replace_recovery_codes', {
    p_user_id: user.id,
    p_hashes: hashes,
  })

  if (error) {
    return json({ error: 'Не удалось сохранить коды. Попробуйте ещё раз.' }, 500)
  }

  const saved = typeof data === 'number' ? data : hashes.length

  // Открытые коды покидают сервер ровно один раз — в этом ответе.
  return json({ codes, saved })
}
