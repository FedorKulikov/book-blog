// supabase/functions/auth-email-hook/index.ts
//
// Supabase Auth Send Email Hook.
//  - signup: sends a confirmation link to user.email;
//  - email_change: sends the token/hash pair(s) required by Secure Email Change;
//  - recovery: returns 200 {} without sending a password-reset email;
//  - all other event types: 501, so GoTrue never treats unsupported delivery as success.
//
// The webhook signature is checked before JSON parsing or payload use.
// Delivery is internal: auth-email-hook -> resend-mailer -> Resend.

import { adminKey, env, supabaseUrl } from '../_shared/env.ts'
import { verifyStandardWebhook } from '../_shared/webhook.ts'

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
}
const SUBJECT = 'Подтвердите email — Хлеба и букв'
const MAX_BODY_BYTES = 256_000

type EmailData = {
  token_hash?: unknown
  token_hash_new?: unknown
  token?: unknown
  token_new?: unknown
  email_action_type?: unknown
  site_url?: unknown
  redirect_to?: unknown
}

type HookPayload = {
  user?: {
    id?: unknown
    email?: unknown
    new_email?: unknown
  } | null
  email_data?: EmailData
}

type Recipient = {
  email: string
  tokenHash: string
  type: 'signup' | 'email_change'
  ordinal: number
  heading: string
  instruction: string
}

type Dependencies = {
  hookSecret?: string | null
  siteUrl?: string | null
  projectUrl?: string | null
  supabaseSecretKey?: string | null
  fetcher?: typeof fetch
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  })
}

function fail(status: number, message: string): Response {
  return json({ error: { http_code: status, message } }, status)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isEmail(value: unknown): value is string {
  return isNonEmptyString(value) &&
    value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function isTokenHash(value: unknown): value is string {
  return isNonEmptyString(value) &&
    value.length <= 512 &&
    /^[A-Za-z0-9_-]+$/.test(value)
}

function parsePayload(value: unknown): HookPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as HookPayload
}

function actionOf(payload: HookPayload): string | null {
  const action = payload.email_data?.email_action_type
  return isNonEmptyString(action) ? action : null
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function confirmationUrl(siteUrl: string, tokenHash: string, type: Recipient['type']): string {
  const url = new URL('/auth/confirm', siteUrl)
  url.searchParams.set('token_hash', tokenHash)
  url.searchParams.set('type', type)
  return url.toString()
}

function recipientsFor(payload: HookPayload, action: string): Recipient[] | null {
  const user = payload.user
  const emailData = payload.email_data
  if (!user || !emailData) return null

  if (action === 'signup') {
    if (!isEmail(user.email) || !isTokenHash(emailData.token_hash)) return null
    return [{
      email: user.email,
      tokenHash: emailData.token_hash,
      type: 'signup',
      ordinal: 0,
      heading: 'Подтвердите адрес электронной почты',
      instruction: 'Завершите регистрацию в «Хлеба и букв», подтвердив, что этот почтовый ящик принадлежит вам.',
    }]
  }

  if (action === 'email_change') {
    const currentEmail = isEmail(user.email) ? user.email : null
    const newEmail = isEmail(user.new_email) ? user.new_email : null
    const oldSideHash = isTokenHash(emailData.token_hash_new)
      ? emailData.token_hash_new
      : null
    const newSideHash = isTokenHash(emailData.token_hash)
      ? emailData.token_hash
      : null

    // Secure Email Change enabled: two tokens/hashes; token_hash_new belongs
    // to the current address and token_hash belongs to user.new_email.
    if (currentEmail && newEmail && oldSideHash && newSideHash) {
      return [
        {
          email: currentEmail,
          tokenHash: oldSideHash,
          type: 'email_change',
          ordinal: 0,
          heading: 'Подтвердите изменение адреса',
          instruction: 'Подтвердите запрос на изменение адреса электронной почты. Это письмо отправлено на текущий адрес аккаунта.',
        },
        {
          email: newEmail,
          tokenHash: newSideHash,
          type: 'email_change',
          ordinal: 1,
          heading: 'Подтвердите новый адрес электронной почты',
          instruction: 'Подтвердите новый адрес, чтобы завершить его привязку к аккаунту «Хлеба и букв».',
        },
      ]
    }

    // Secure Email Change disabled: only one token/hash pair is generated
    // for the new address. Prefer token_hash; token_hash_new is not a fallback
    // here because Supabase documents token_hash as the new-address hash.
    if (newEmail && newSideHash) {
      return [{
        email: newEmail,
        tokenHash: newSideHash,
        type: 'email_change',
        ordinal: 1,
        heading: 'Подтвердите новый адрес электронной почты',
        instruction: 'Подтвердите новый адрес, чтобы завершить его привязку к аккаунту «Хлеба и букв».',
      }]
    }

    return null
  }

  return null
}

async function idempotencyKey(
  webhookId: string,
  action: string,
  userId: string,
  ordinal: number,
): Promise<string> {
  const source = new TextEncoder().encode(
    `auth-email-hook:${webhookId}:${action}:${userId}:${ordinal}`,
  )
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', source))
  const hex = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')
  return `auth-hook:${hex}`
}

async function sendConfirmation(
  recipient: Recipient,
  siteUrl: string,
  projectUrl: string,
  supabaseSecretKey: string,
  webhookId: string,
  userId: string,
  fetcher: typeof fetch,
): Promise<boolean> {
  const link = confirmationUrl(siteUrl, recipient.tokenHash, recipient.type)
  const safeLink = escapeHtml(link)
  const expiryText =
    'Ссылка действует ограниченное время согласно настройке срока действия подтверждений в Supabase Auth.'

  const html = [
    '<!doctype html><html lang="ru"><body>',
    '<main style="font-family:Arial,sans-serif;line-height:1.55;max-width:560px;margin:0 auto;padding:24px">',
    '<h1 style="font-size:22px;color:#214d40">Хлеба и букв</h1>',
    `<h2>${escapeHtml(recipient.heading)}</h2>`,
    `<p>${escapeHtml(recipient.instruction)}</p>`,
    `<p><a href="${safeLink}" style="display:inline-block;padding:12px 20px;background:#356b59;color:#fff;text-decoration:none;border-radius:24px">Подтвердить email</a></p>`,
    `<p>${escapeHtml(expiryText)}</p>`,
    '<p>Не пересылайте это письмо и ссылку из него другим людям. Если вы не запрашивали подтверждение, просто проигнорируйте письмо.</p>',
    '</main></body></html>',
  ].join('')

  const text = [
    'Хлеба и букв',
    recipient.heading,
    recipient.instruction,
    `Подтвердить email: ${link}`,
    expiryText,
    'Не пересылайте это письмо и ссылку из него другим людям. Если вы не запрашивали подтверждение, просто проигнорируйте письмо.',
  ].join('\n\n')

  const key = await idempotencyKey(webhookId, recipient.type, userId, recipient.ordinal)

  try {
    const response = await fetcher(
      `${projectUrl.replace(/\/+$/, '')}/functions/v1/resend-mailer`,
      {
        method: 'POST',
        headers: {
          apikey: supabaseSecretKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: recipient.email,
          subject: SUBJECT,
          html,
          text,
          idempotencyKey: key,
        }),
        signal: AbortSignal.timeout(12_000),
      },
    )

    return response.ok
  } catch {
    return false
  }
}

export async function handle(
  request: Request,
  dependencies: Dependencies = {},
): Promise<Response> {
  if (request.method !== 'POST') return fail(405, 'method_not_allowed')

  const hookSecret = dependencies.hookSecret === undefined
    ? env('AUTH_EMAIL_HOOK_SECRET')
    : dependencies.hookSecret
  if (!hookSecret) return fail(500, 'hook_not_configured')

  const rawBody = await request.text()
  if (new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) {
    return fail(413, 'payload_too_large')
  }

  let validSignature = false
  try {
    validSignature = await verifyStandardWebhook(rawBody, request.headers, hookSecret)
  } catch {
    return fail(401, 'invalid_signature')
  }
  if (!validSignature) return fail(401, 'invalid_signature')

  let payload: HookPayload | null
  try {
    payload = parsePayload(JSON.parse(rawBody))
  } catch {
    return fail(400, 'invalid_json')
  }
  if (!payload?.email_data) return fail(400, 'invalid_payload')

  const action = actionOf(payload)
  if (!action) return fail(501, 'unsupported_action')

  // Email password recovery is explicitly disabled. Do not invoke the mailer.
  if (action === 'recovery') return json({})

  if (action !== 'signup' && action !== 'email_change') {
    return fail(501, 'email_delivery_not_configured')
  }

  const rawUserId = payload.user?.id
  if (!isNonEmptyString(rawUserId)) return fail(400, 'invalid_user')
  const userId = rawUserId.trim()

  const recipients = recipientsFor(payload, action)
  if (!recipients || recipients.length === 0) return fail(400, 'invalid_email_payload')

  const configuredSiteUrl = dependencies.siteUrl === undefined
    ? env('AUTH_EMAIL_SITE_URL')
    : dependencies.siteUrl
  if (!configuredSiteUrl) return fail(500, 'email_site_url_not_configured')

  let siteUrl: string
  try {
    const parsed = new URL(configuredSiteUrl)
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'bukleb.ru' || parsed.port) {
      return fail(500, 'invalid_email_site_url')
    }
    siteUrl = parsed.origin
  } catch {
    return fail(500, 'invalid_email_site_url')
  }

  const secretKey = dependencies.supabaseSecretKey === undefined
    ? adminKey()
    : dependencies.supabaseSecretKey
  const projectUrl = dependencies.projectUrl === undefined
    ? env('SUPABASE_URL')
    : dependencies.projectUrl

  if (!secretKey || !projectUrl) return fail(500, 'mailer_not_configured')

  const webhookId = request.headers.get('webhook-id')
  if (!webhookId) return fail(401, 'invalid_signature')

  const fetcher = dependencies.fetcher ?? fetch
  for (const recipient of recipients) {
    const sent = await sendConfirmation(
      recipient,
      siteUrl,
      projectUrl,
      secretKey,
      webhookId,
      userId,
      fetcher,
    )
    if (!sent) return fail(502, 'email_delivery_failed')
  }

  return json({})
}

if (import.meta.main) {
  Deno.serve(request => handle(request))
}
