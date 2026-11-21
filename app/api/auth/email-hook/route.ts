// app/api/auth/email-hook/route.ts
//
// Supabase Auth Send Email Hook.
// Supabase's public /auth/v1/recover email is always suppressed here.
 // The application sends recovery messages only through its own rate-limited
 // endpoint after checking a separate verified-mailbox record. Historical
 // auth.users.email_confirmed_at values are intentionally ignored.
import { NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { isPreviewRequest } from '@/lib/env-guard'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TOLERANCE_SECONDS = 5 * 60

const UNDELIVERED_ACTIONS = new Set([
  'invite',
  'magiclink',
  'email_change',
  'email_change_current',
  'email_change_new',
  'reauthentication',
])

type EmailHookPayload = {
  user?: {
    id?: unknown
    email?: unknown
  } | null
  email_data?: {
    email_action_type?: unknown
    token_hash?: unknown
  }
  email_action_type?: unknown
}

function ok() {
  return NextResponse.json({}, {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
  })
}

function fail(status: number, message: string) {
  return NextResponse.json(
    { error: { http_code: status, message } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  )
}

/** Verify Standard Webhooks: HMAC-SHA256(id.timestamp.body), constant-time. */
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

function parsePayload(value: unknown): EmailHookPayload | null {
  if (!value || typeof value !== 'object') return null
  return value as EmailHookPayload
}

function actionOf(payload: EmailHookPayload): string | null {
  const action = payload.email_data?.email_action_type ?? payload.email_action_type
  return typeof action === 'string' ? action : null
}


export async function POST(request: Request) {
  if (isPreviewRequest(request)) {
    return fail(404, 'not_available_on_preview')
  }

  const secret = process.env.AUTH_EMAIL_HOOK_SECRET

  // No secret means delivery is disabled. Never fall back to built-in SMTP.
  if (!secret) return ok()

  const rawBody = await request.text()

  if (!hasValidSignature(rawBody, request.headers, secret)) {
    return fail(401, 'invalid_signature')
  }

  let payload: EmailHookPayload | null
  try {
    payload = parsePayload(JSON.parse(rawBody))
  } catch {
    return fail(400, 'invalid_json')
  }

  if (!payload) return fail(400, 'invalid_payload')

  const action = actionOf(payload)
  if (!action) return fail(501, 'unsupported_action')

  if (action === 'recovery') {
    // Never send from the public Auth endpoint. The custom reset endpoint
    // calls admin.generateLink, checks the verified-email record and then
    // sends through Resend with its own email/IP rate limits.
    return ok()
  }

  // Email confirmations remain disabled. Signup does not request a message.
  if (action === 'signup') return ok()

  // Security notices are not enabled until a notification policy is designed.
  if (action.endsWith('_notification')) return ok()

  if (UNDELIVERED_ACTIONS.has(action)) {
    return fail(501, 'email_delivery_not_configured')
  }

  return fail(501, 'unsupported_action')
}
