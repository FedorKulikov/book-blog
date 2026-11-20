// supabase/functions/auth-email-hook/index.ts
//
// Supabase Auth Hook «Send Email» в Edge Runtime.
//
// Политика та же, что в Next.js-реализации:
//   • recovery        — письмо не отправляется, ответ 200 {};
//   • signup          — при выключенном Confirm Email письмо не запрашивается;
//   • *_notification  — подавляются;
//   • magiclink, invite, email_change, reauthentication — 501, без фиктивного успеха.
//
// Защита: подпись Standard Webhooks проверяется ДО JSON.parse и до любого
// использования payload. Без секрета функция ничего не отправляет (fail closed).
import { env } from '../_shared/env.ts'
import { verifyStandardWebhook } from '../_shared/webhook.ts'

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
}

/** События, где письмо обязано уйти, но доставка не настроена */
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
 * Тело {} с application/json: клиент GoTrue отклоняет ответ без JSON
 * Content-Type (hook_payload_invalid_content_type), из-за чего recovery
 * начинал отдавать 400 только для существующих адресов — оракул перечисления.
 */
function ok(): Response {
  return new Response('{}', { status: 200, headers: JSON_HEADERS })
}

function fail(status: number, message: string): Response {
  return new Response(
    JSON.stringify({ error: { http_code: status, message } }),
    { status, headers: JSON_HEADERS },
  )
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

  if (typeof record.email_action_type === 'string') {
    return record.email_action_type
  }

  return null
}

export async function handle(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return fail(405, 'method_not_allowed')
  }

  // Тело читаем как текст: подпись считается по исходным байтам
  const rawBody = await request.text()

  const secret = env('AUTH_EMAIL_HOOK_SECRET')

  // Секрета нет — подпись проверить нельзя. Это ошибка конфигурации,
  // а не успешная обработка: 200 заставил бы Supabase считать событие
  // доставленным. Отвечаем non-2xx с JSON.
  if (!secret) {
    return fail(500, 'hook_not_configured')
  }

  if (!(await verifyStandardWebhook(rawBody, request.headers, secret))) {
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
  // владение им не доказано. Ответ нейтрален и одинаков для любых входных
  // данных — по нему нельзя определить существование аккаунта.
  if (action === 'recovery') {
    return ok()
  }

  // Подтверждение регистрации: при выключенном Confirm Email письмо
  // не запрашивается, поэтому 200 честный.
  if (action === 'signup') {
    return ok()
  }

  if (action.endsWith('_notification')) {
    return ok()
  }

  if (UNDELIVERED_ACTIONS.has(action)) {
    return fail(501, 'email_delivery_not_configured')
  }

  return fail(501, 'unsupported_action')
}

// Обработчик запускается только при прямом запуске функции.
if (import.meta.main) {
  Deno.serve(handle)
}
