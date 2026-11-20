// app/api/recovery/use/route.ts
//
// Восстановление пароля по имени пользователя и резервному коду.
// Работает без почты и без SMTP.
//
// Порядок:
//   1. лимиты по IP и по имени (до обращения к базе пользователей);
//   2. поиск профиля по имени;
//   3. атомарное погашение кода (один UPDATE ... RETURNING);
//   4. смена пароля через Admin API с service_role;
//   5. гашение сессий пользователя.
//
// Внешние сообщения об ошибке одинаковы для «нет такого пользователя»,
// «неверный код» и «код уже использован» — иначе это оракул перебора.
import { NextResponse } from 'next/server'
import { isPreviewRequest } from '@/lib/env-guard'
import { getAdminClient } from '@/lib/supabase/admin'
import {
  MIN_PASSWORD_LENGTH,
  hashCode,
  hmacHex,
  isRecoveryConfigured,
  normalizeCode,
} from '@/lib/recovery'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }

const GENERIC_ERROR =
  'Не удалось восстановить доступ. Проверьте имя пользователя и резервный код.'

const WINDOW_MINUTES = 15
const MAX_IP_FAILURES = 10
const MAX_USER_FAILURES = 5

/** Искусственная пауза на неудаче — чтобы время ответа не выдавало причину */
const FAILURE_DELAY_MS = 300

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE })
}

/**
 * IP клиента для лимитов.
 *
 * Берём ПОСЛЕДНИЙ адрес из X-Forwarded-For, а не первый: прокси дописывает
 * в конец адрес, который видит сам, поэтому первое значение клиент может
 * подделать своим заголовком, а последнее — то, что добавил доверенный прокси.
 * x-real-ip — запасной вариант для платформ, которые его выставляют.
 */
function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')

  if (forwarded) {
    const parts = forwarded
      .split(',')
      .map(part => part.trim())
      .filter(Boolean)

    if (parts.length > 0) return parts[parts.length - 1]
  }

  return request.headers.get('x-real-ip')?.trim() || 'unknown'
}

type FailuresRow = { ip_failures: number; user_failures: number }

export async function POST(request: Request) {
  if (isPreviewRequest(request)) {
    return json({ error: 'Восстановление по коду доступно только на bukleb.ru' }, 404)
  }

  if (!isRecoveryConfigured()) {
    return json({ error: 'Восстановление по резервному коду временно недоступно' }, 503)
  }

  const admin = getAdminClient()
  const secret = process.env.RECOVERY_CODE_SECRET

  if (!admin || !secret) {
    return json({ error: 'Восстановление по резервному коду временно недоступно' }, 503)
  }

  let username = ''
  let rawCode = ''
  let newPassword = ''

  try {
    const body: unknown = await request.json()
    if (body && typeof body === 'object') {
      const b = body as Record<string, unknown>
      if (typeof b.username === 'string') username = b.username.trim()
      if (typeof b.code === 'string') rawCode = b.code
      if (typeof b.newPassword === 'string') newPassword = b.newPassword
    }
  } catch {
    return json({ error: 'Некорректный запрос' }, 400)
  }

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return json(
      { error: `Пароль должен быть не короче ${MIN_PASSWORD_LENGTH} символов` },
      400,
    )
  }

  const ipHash = hmacHex(clientIp(request), secret)
  const usernameHash = hmacHex(username.toLowerCase(), secret)

  const { data: failuresData } = await admin.rpc('recovery_failures', {
    p_ip_hash: ipHash,
    p_username_hash: usernameHash,
    p_window_minutes: WINDOW_MINUTES,
  })

  const failures = (failuresData as FailuresRow[] | null) ?? []
  const row = failures[0]

  if (
    (row?.ip_failures ?? 0) >= MAX_IP_FAILURES ||
    (row?.user_failures ?? 0) >= MAX_USER_FAILURES
  ) {
    await admin.rpc('log_recovery_attempt', {
      p_ip_hash: ipHash,
      p_username_hash: usernameHash,
      p_success: false,
    })

    return json(
      { error: `Слишком много попыток. Попробуйте через ${WINDOW_MINUTES} минут.` },
      429,
    )
  }

  const normalized = normalizeCode(rawCode)

  if (!normalized || username.length < 3 || username.length > 40) {
    await admin.rpc('log_recovery_attempt', {
      p_ip_hash: ipHash,
      p_username_hash: usernameHash,
      p_success: false,
    })

    await new Promise(resolve => setTimeout(resolve, FAILURE_DELAY_MS))
    return json({ error: GENERIC_ERROR }, 400)
  }

  const { data: profile } = await admin
    .from('profiles')
    .select('id')
    .eq('username', username)
    .maybeSingle()

  const userId = profile?.id as string | undefined
  let consumed = false

  if (userId) {
    const { data: consumedData, error: consumeError } = await admin.rpc(
      'consume_recovery_code',
      {
        p_user_id: userId,
        p_code_hash: hashCode(normalized, secret),
        p_ip_hash: ipHash,
      },
    )

    consumed = !consumeError && consumedData === true
  }

  await admin.rpc('log_recovery_attempt', {
    p_ip_hash: ipHash,
    p_username_hash: usernameHash,
    p_success: consumed,
  })

  if (!consumed || !userId) {
    await new Promise(resolve => setTimeout(resolve, FAILURE_DELAY_MS))
    return json({ error: GENERIC_ERROR }, 400)
  }

  // Код уже погашен: даже если смена пароля не удастся, повторно он не сработает
  const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
    password: newPassword,
  })

  if (updateError) {
    return json(
      {
        error:
          'Код принят, но сменить пароль не удалось. ' +
          'Используйте другой резервный код или обратитесь к администрации.',
      },
      500,
    )
  }

  // Пароль изменён — прежние сессии больше не должны продлеваться
  await admin.rpc('revoke_user_sessions', { p_user_id: userId })

  return json({ ok: true })
}
