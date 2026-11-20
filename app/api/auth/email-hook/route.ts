// app/api/auth/email-hook/route.ts
//
// Supabase Auth Hook «Send Email».
//
// Зачем: подтверждение почты в проекте отключено, поэтому Supabase помечает
// ЛЮБОЙ адрес подтверждённым автоматически. Из-за этого `email_confirmed_at`
// ничего не доказывает, а `POST /auth/v1/recover` отправлял ссылку сброса
// владельцу любого чужого ящика — то есть позволял захватить аккаунт.
//
// Hook заменяет встроенную отправку Supabase: если мы не отправили письмо,
// ссылка не уйдёт никуда. Поэтому recovery подавляется нейтральным ответом.
//
// ВАЖНО: hook НЕ имеет fallback на SMTP. Всё, что не отправлено здесь,
// не отправляется вообще. Используемые в проекте сценарии:
//   • recovery        — подавляется осознанно (восстановление по резервным кодам);
//   • signup          — письмо не запрашивается, подтверждение почты выключено;
//   • *_notification  — уведомления не доставляются (SMTP не настроен);
//   • magiclink, invite, email_change, reauthentication — в приложении не используются.
// Для неиспользуемых сценариев, где письмо реально нужно, возвращаем 501,
// а не фиктивный успех: пусть сценарий падает заметно, а не молча.
import { NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Допустимое расхождение часов: защита от повторного использования запроса */
const TOLERANCE_SECONDS = 5 * 60

/** События, где письмо обязано уйти. В приложении не используются. */
const UNDELIVERED_ACTIONS = new Set([
  'invite',
  'magiclink',
  'email_change',
  'email_change_current',
  'email_change_new',
  'reauthentication',
])

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

/**
 * Проверка подписи по спецификации Standard Webhooks.
 *
 * Подписывается строка `id.timestamp.body`, ключ — base64-часть секрета
 * вида `v1,whsec_<base64>`. Сравнение — constant-time.
 */
function hasValidSignature(
  rawBody: string,
  headers: Headers,
  secret: string,
): boolean {
  const id = headers.get('webhook-id')
  const timestamp = headers.get('webhook-timestamp')
  const signatureHeader = headers.get('webhook-signature')

  if (!id || !timestamp || !signatureHeader) return false

  const ts = Number(timestamp)
  if (!Number.isFinite(ts)) return false

  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - ts) > TOLERANCE_SECONDS) return false

  const withoutVersion = secret.startsWith('v1,') ? secret.slice(3) : secret
  const base64Key = withoutVersion.startsWith('whsec_')
    ? withoutVersion.slice(6)
    : withoutVersion

  const key = Buffer.from(base64Key, 'base64')
  if (key.length === 0) return false

  const expected = createHmac('sha256', key)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest('base64')

  const expectedBuffer = Buffer.from(expected)

  return signatureHeader.split(' ').some(entry => {
    const value = entry.startsWith('v1,') ? entry.slice(3) : entry
    const actual = Buffer.from(value)
    return (
      actual.length === expectedBuffer.length &&
      timingSafeEqual(actual, expectedBuffer)
    )
  })
}

/** Тип события из фактического payload Supabase */
function extractAction(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null

  const record = payload as Record<string, unknown>
  const emailData = record.email_data

  if (emailData && typeof emailData === 'object') {
    const action = (emailData as Record<string, unknown>).email_action_type
    if (typeof action === 'string') return action
  }

  // На случай другой версии payload
  if (typeof record.email_action_type === 'string') {
    return record.email_action_type
  }

  return null
}

export async function POST(request: Request) {
  const secret = process.env.AUTH_EMAIL_HOOK_SECRET

  if (!secret) {
    // Без секрета подпись проверить нельзя — письма не отправляем вовсе
    return json({ error: 'hook_not_configured' }, 500)
  }

  // Тело читаем как текст: подпись считается по исходным байтам
  const rawBody = await request.text()

  if (!hasValidSignature(rawBody, request.headers, secret)) {
    return json({ error: 'invalid_signature' }, 401)
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const action = extractAction(payload)

  if (!action) {
    return json({ error: 'unsupported_action' }, 501)
  }

  // Восстановление пароля письмом не отправляем: адрес не подтверждён,
  // значит владение им не доказано. Нейтральный ответ одинаков для любых
  // входных данных — по нему нельзя определить существование аккаунта.
  if (action === 'recovery') {
    return json({ ok: true })
  }

  // Подтверждение регистрации: при выключенном Confirm Email письмо не
  // запрашивается вовсе, поэтому 200 здесь честный — письма и не ждали.
  // Если подтверждение когда-нибудь включат, доставку нужно будет подключать.
  if (action === 'signup') {
    return json({ ok: true })
  }

  // Уведомления о безопасности: доставлять нечем, подавляем.
  if (action.endsWith('_notification')) {
    return json({ ok: true })
  }

  // Письмо требуется, но отправить его не через что.
  if (UNDELIVERED_ACTIONS.has(action)) {
    return json({ error: 'email_delivery_not_configured' }, 501)
  }

  return json({ error: 'unsupported_action' }, 501)
}
