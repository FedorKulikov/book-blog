import { NextResponse } from 'next/server'
import { isPreviewRequest } from '@/lib/env-guard'
import { getAdminClient } from '@/lib/supabase/admin'
import {
  buildPasswordRecoveryUrl,
  emailRecoveryHmac,
  escapeEmailHtml,
  getAuthEmailSiteUrl,
  getEmailRecoverySecret,
  hashEmailForRecovery,
  isEmailRecoveryConfigured,
  sendEmailViaResend,
} from '@/lib/email-recovery'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NEUTRAL_RESPONSE = { ok: true }
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

/**
 * Layero appends the address it sees to the end of X-Forwarded-For.
 * Use that last entry, not the first (which is client-controlled).
 */
function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const parts = forwarded.split(',').map(value => value.trim()).filter(Boolean)
    if (parts.length > 0) return parts[parts.length - 1]
  }

  return request.headers.get('x-real-ip')?.trim() || 'unknown'
}

export async function POST(request: Request) {
  if (isPreviewRequest(request)) {
    return json({ error: 'not_available_on_preview' }, 404)
  }

  if (!isEmailRecoveryConfigured()) {
    return json({ error: 'Восстановление по email пока не настроено' }, 503)
  }

  let expectedOrigin: string
  try {
    expectedOrigin = getAuthEmailSiteUrl()
  } catch {
    return json({ error: 'Восстановление по email пока не настроено' }, 503)
  }

  if (request.headers.get('origin') !== expectedOrigin) {
    return json({ error: 'Запрос отклонён' }, 403)
  }

  let rawEmail = ''
  try {
    const body: unknown = await request.json()
    if (body && typeof body === 'object') {
      const value = (body as Record<string, unknown>).email
      if (typeof value === 'string') rawEmail = value.trim()
    }
  } catch {
    // Continue with an empty value and return the same neutral response.
  }

  const email = rawEmail.toLowerCase()
  const secret = getEmailRecoverySecret()
  const admin = getAdminClient()

  if (!secret || !admin) {
    return json({ error: 'Восстановление по email временно недоступно' }, 503)
  }

  const emailHash = hashEmailForRecovery(email, secret)
  const ipHash = emailRecoveryHmac(clientIp(request), secret)

  // Apply rate limits before resolving whether the account exists or the
  // mailbox was previously verified. Unknown emails are recorded too.
  const { data: allowed, error: rateError } = await admin.rpc(
    'allow_email_recovery_reset',
    {
      p_email_hash: emailHash,
      p_ip_hash: ipHash,
    },
  )

  if (rateError || allowed !== true || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    if (rateError) console.error('[email-recovery] reset rate-limit check failed')
    return json(NEUTRAL_RESPONSE)
  }

  // Generate a reset link without asking Supabase to send email. The Auth
  // Send Email Hook remains a defensive barrier for direct /auth/v1/recover
  // calls and intentionally does not send recovery messages.
  let generated: Awaited<ReturnType<typeof admin.auth.admin.generateLink>>
  try {
    const result = await admin.auth.admin.generateLink({
      type: 'recovery',
      email,
    })
    if (result.error || !result.data) return json(NEUTRAL_RESPONSE)
    generated = result
  } catch {
    return json(NEUTRAL_RESPONSE)
  }

  const generatedUser = generated.data.user
  const properties = generated.data.properties as
    | { hashed_token?: unknown }
    | undefined
  const hashedToken = properties?.hashed_token

  if (
    !generatedUser?.id ||
    typeof generatedUser.email !== 'string' ||
    generatedUser.email.trim().toLowerCase() !== email ||
    typeof hashedToken !== 'string' ||
    !/^[A-Za-z0-9_-]{20,128}$/.test(hashedToken)
  ) {
    return json(NEUTRAL_RESPONSE)
  }

  // Historical auth.users.email_confirmed_at is not consulted. A separate
  // HMAC record created through a mailbox verification link is required.
  const { data: verified, error: verifiedError } = await admin.rpc(
    'email_recovery_is_verified',
    {
      p_user_id: generatedUser.id,
      p_email_hash: emailHash,
    },
  )

  if (verifiedError || verified !== true) {
    return json(NEUTRAL_RESPONSE)
  }

  try {
    const recoveryUrl = buildPasswordRecoveryUrl(
      expectedOrigin,
      hashedToken,
    )
    const safeUrl = escapeEmailHtml(recoveryUrl)
    const idempotencyKey = emailRecoveryHmac(
      `email-password-reset:${generatedUser.id}:${hashedToken}`,
      secret,
    )

    await sendEmailViaResend({
      to: email,
      subject: 'Ссылка для восстановления пароля — «Хлеба и букв»',
      html: [
        '<!doctype html><html lang="ru"><body>',
        '<h2>Восстановление пароля</h2>',
        '<p>Получен запрос на смену пароля в аккаунте «Хлеба и букв».</p>',
        `<p><a href="${safeUrl}">Создать новый пароль</a></p>`,
        '<p>Ссылка одноразовая. Если вы не запрашивали сброс, проигнорируйте письмо.</p>',
        '</body></html>',
      ].join(''),
      text: [
        'Получен запрос на смену пароля в аккаунте «Хлеба и букв».',
        recoveryUrl,
        'Ссылка одноразовая. Если вы не запрашивали сброс, проигнорируйте письмо.',
      ].join('\n\n'),
      idempotencyKey: `email-password-reset/${idempotencyKey}`,
    })
  } catch {
    // Do not reveal provider/account state to the caller.
    console.error('[email-recovery] reset email delivery failed')
  }

  return json(NEUTRAL_RESPONSE)
}
