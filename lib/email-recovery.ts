import { createHmac, randomBytes } from 'node:crypto'

export const EMAIL_RECOVERY_TOKEN_TTL_MINUTES = 20

export type ResendConfig = {
  apiKey: string
  from: string
}

export type OutgoingEmail = {
  to: string
  subject: string
  html: string
  text: string
  idempotencyKey?: string
}

/**
 * Email recovery is intentionally opt-in. The Auth hook must also be
 * configured, because password-reset links are sent only through that hook.
 */
export function isEmailRecoveryConfigured(): boolean {
  const secret = process.env.EMAIL_RECOVERY_SECRET
  return Boolean(
    process.env.NEXT_PUBLIC_ENABLE_EMAIL_RECOVERY === 'true' &&
      secret &&
      secret.length >= 32 &&
      process.env.SUPABASE_SERVICE_ROLE_KEY &&
      process.env.AUTH_EMAIL_HOOK_SECRET &&
      process.env.RESEND_API_KEY &&
      process.env.AUTH_EMAIL_FROM &&
      process.env.AUTH_EMAIL_SITE_URL,
  )
}

export function getEmailRecoverySecret(): string | null {
  const secret = process.env.EMAIL_RECOVERY_SECRET
  return secret && secret.length >= 32 ? secret : null
}

export function getResendConfig(): ResendConfig | null {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.AUTH_EMAIL_FROM
  return apiKey && from ? { apiKey, from } : null
}

/** HMAC-SHA-256; raw email addresses and one-time tokens are never stored. */
export function emailRecoveryHmac(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('hex')
}

export function hashEmailForRecovery(email: string, secret: string): string {
  return emailRecoveryHmac(email.trim().toLowerCase(), secret)
}

export function generateEmailRecoveryToken(secret: string): {
  token: string
  tokenHash: string
} {
  const token = randomBytes(32).toString('base64url')
  return {
    token,
    tokenHash: emailRecoveryHmac(token, secret),
  }
}

export function isValidEmailRecoveryToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token)
}

/**
 * Fixed-origin URLs prevent the Auth hook from trusting redirect_to supplied
 * by a caller. Production uses the custom domain; localhost remains available
 * for local development only.
 */
export function getAuthEmailSiteUrl(): string {
  const configured = process.env.AUTH_EMAIL_SITE_URL
  if (!configured) throw new Error('AUTH_EMAIL_SITE_URL is not configured')

  const url = new URL(configured)
  const isLocal = ['localhost', '127.0.0.1'].includes(url.hostname)

  if (url.protocol !== 'https:' && !isLocal) {
    throw new Error('AUTH_EMAIL_SITE_URL must use HTTPS')
  }

  if (!isLocal && url.hostname !== 'bukleb.ru') {
    throw new Error('AUTH_EMAIL_SITE_URL must use the verified production domain')
  }

  return url.origin
}

export function buildEmailVerificationUrl(siteUrl: string, token: string): string {
  const url = new URL('/email-recovery/confirm', siteUrl)
  url.searchParams.set('token', token)
  return url.toString()
}

export function buildPasswordRecoveryUrl(siteUrl: string, tokenHash: string): string {
  const url = new URL('/auth/confirm', siteUrl)
  url.searchParams.set('token_hash', tokenHash)
  url.searchParams.set('type', 'recovery')
  url.searchParams.set('next', '/auth/reset')
  return url.toString()
}

export function escapeEmailHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export async function sendEmailViaResend(
  message: OutgoingEmail,
  config: ResendConfig | null = getResendConfig(),
  fetcher: typeof fetch = fetch,
): Promise<void> {
  if (!config) throw new Error('Resend email delivery is not configured')

  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
  }

  if (message.idempotencyKey) {
    headers['Idempotency-Key'] = message.idempotencyKey
  }

  let response: Response
  try {
    response = await fetcher('https://api.resend.com/emails', {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        from: config.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
    })
  } catch {
    throw new Error('Email provider request failed')
  }

  if (!response.ok) {
    // Do not include the provider response in logs: it can contain addresses.
    throw new Error(`Email provider returned HTTP ${response.status}`)
  }
}
