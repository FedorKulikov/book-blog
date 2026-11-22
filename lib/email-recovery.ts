import { createHmac, randomBytes } from 'node:crypto'

export const EMAIL_RECOVERY_TOKEN_TTL_MINUTES = 20

export type EdgeMailerConfig = {
  supabaseUrl: string
  secretKey: string
}

export type OutgoingEmail = {
  to: string
  subject: string
  html: string
  text: string
  idempotencyKey?: string
}

/**
 * This flag enables only mailbox-ownership verification. Password-reset
 * links by email are intentionally disabled in the route itself.
 *
 * The Resend API key is not present in the Next.js runtime. Mail is sent by
 * the Supabase Edge Function, which reads RESEND_API_KEY from Function Secrets.
 */
export function isEmailRecoveryConfigured(): boolean {
  const secret = process.env.EMAIL_RECOVERY_SECRET
  return Boolean(
    process.env.NEXT_PUBLIC_ENABLE_EMAIL_RECOVERY === 'true' &&
      secret &&
      secret.length >= 32 &&
      process.env.SUPABASE_SECRET_KEY &&
      process.env.SUPABASE_SERVICE_ROLE_KEY &&
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  )
}

export function getEmailRecoverySecret(): string | null {
  const secret = process.env.EMAIL_RECOVERY_SECRET
  return secret && secret.length >= 32 ? secret : null
}

export function getEdgeMailerConfig(): EdgeMailerConfig | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const secretKey = process.env.SUPABASE_SECRET_KEY

  if (!supabaseUrl || !secretKey) return null

  try {
    const url = new URL(supabaseUrl)
    if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
      return null
    }
    if (!['localhost', '127.0.0.1'].includes(url.hostname) && !url.hostname.endsWith('.supabase.co')) {
      return null
    }
  } catch {
    return null
  }

  return { supabaseUrl, secretKey }
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
 * Fixed-origin URLs prevent redirect_to supplied by a caller from redirecting
 * users to another site. Production uses the custom domain; localhost is
 * available only for local development.
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

export function escapeEmailHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Send a single-purpose verification message through Supabase Edge Function.
 * The Supabase secret API key is server-only and is sent only in the apikey
 * header. The Edge Function validates it with @supabase/server auth: secret.
 * RESEND_API_KEY never enters the Next.js runtime or client bundle.
 */
export async function sendEmailViaEdgeMailer(
  message: OutgoingEmail,
  config: EdgeMailerConfig | null = getEdgeMailerConfig(),
  fetcher: typeof fetch = fetch,
): Promise<void> {
  if (!config) throw new Error('Supabase Edge mailer is not configured')

  const endpoint = new URL('/functions/v1/resend-mailer', config.supabaseUrl).toString()
  let response: Response

  try {
    response = await fetcher(endpoint, {
      method: 'POST',
      headers: {
        apikey: config.secretKey,
        'Content-Type': 'application/json',
      },
      // The Edge Function has its own strict 10-second timeout to Resend.
      // Allow a little time for the gateway and function startup overhead.
      signal: AbortSignal.timeout(12_000),
      body: JSON.stringify({
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        idempotencyKey: message.idempotencyKey,
      }),
    })
  } catch {
    throw new Error('Email delivery function request failed')
  }

  if (!response.ok) {
    // Do not include the function response: it can contain provider details.
    throw new Error(`Email delivery function returned HTTP ${response.status}`)
  }
}
