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
import { isPreviewRequest } from '@/lib/env-guard'

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

/**
 * Успех по контракту Supabase Auth Hooks.
 *
 * Тело пустое по смыслу, но с Content-Type: application/json и телом {}:
 * клиент хуков в GoTrue отклоняет ответ без JSON Content-Type
 * (hook_payload_invalid_content_type), и тогда recovery возвращает 400
 * для существующего адреса — то есть появляется оракул перечисления.
 */
function ok() {
  return NextResponse.json({}, {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
  })
}

/** Ошибка в документированном формате Supabase Auth Hooks */
function fail(status: number, message: string) {
  return NextResponse.json(
    { error: { http_code: status, message } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  )
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
  if (isPreviewRequest(request)) {
    return fail(404, 'not_available_on_preview')
  }

  const secret = process.env.AUTH_EMAIL_HOOK_SECRET

  // Секрета нет — подпись проверить нельзя, значит ни одно письмо отправить
  // нельзя. Отвечаем успехом осознанно: иначе Supabase начнёт отдавать ошибки
  // на recovery, и появится разница между существующим и несуществующим
  // адресом. Ничего не отправлено — это безопасное поведение по умолчанию.
  if (!secret) {
    return ok()
  }

  // Тело читаем как текст: подпись считается по исходным байтам
  const rawBody = await request.text()

  if (!hasValidSignature(rawBody, request.headers, secret)) {
    return fail(401, 'invalid_signature')
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return fail(400, 'invalid_json')
  }

  const action = extractAction(payload)

  if (!action) {
    return fail(501, 'unsupported_action')
  }

  // Восстановление пароля письмом не отправляем: адрес не подтверждён,
  // значит владение им не доказано. Нейтральный ответ одинаков для любых
  // входных данных — по нему нельзя определить существование аккаунта.
  if (action === 'recovery') {
    return ok()
  }

  // Подтверждение регистрации: при выключенном Confirm Email письмо не
  // запрашивается вовсе, поэтому 200 здесь честный — письма и не ждали.
  // Если подтверждение когда-нибудь включат, доставку нужно будет подключать.
  if (action === 'signup') {
    return ok()
  }

  // Уведомления о безопасности: доставлять нечем, подавляем.
  if (action.endsWith('_notification')) {
    return ok()
  }

  // Письмо требуется, но отправить его не через что.
  if (UNDELIVERED_ACTIONS.has(action)) {
    return fail(501, 'email_delivery_not_configured')
  }

  return fail(501, 'unsupported_action')
}
