// supabase/functions/resend-mailer/index.ts
//
// Server-to-server mail delivery through Resend.
// Gateway JWT verification is enabled in supabase/config.toml. The caller
// must present the server-only Supabase service-role JWT; ordinary user JWTs
// are rejected here even though the gateway accepts valid project JWTs.
//
// The Resend API key exists only in Supabase Function Secrets. The sender is
// fixed to the verified bukleb.ru domain; callers cannot spoof the From field.

const FROM = 'Хлеба и букв <no-reply@bukleb.ru>'
const MAX_HTML_LENGTH = 100_000
const MAX_TEXT_LENGTH = 40_000

export type MailMessage = {
  to: string
  subject: string
  html: string
  text: string
  idempotencyKey: string
}

type Dependencies = {
  apiKey?: string | null
  fetcher?: typeof fetch
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}

/**
 * Supabase verifies the JWT signature before invoking this function because
 * verify_jwt=true. We additionally require the service_role claim so a normal
 * signed-in user cannot use this endpoint as an arbitrary email relay.
 */
function hasServiceRole(request: Request): boolean {
  const authorization = request.headers.get('authorization')
  if (!authorization) return false

  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization.trim())
  if (!match) return false

  const parts = match[1].split('.')
  if (parts.length !== 3) return false

  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
    const payload = JSON.parse(atob(padded)) as { role?: unknown }
    return payload.role === 'service_role'
  } catch {
    return false
  }
}

function parseMessage(value: unknown): MailMessage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const input = value as Record<string, unknown>
  const to = typeof input.to === 'string' ? input.to.trim() : ''
  const subject = typeof input.subject === 'string' ? input.subject.trim() : ''
  const html = typeof input.html === 'string' ? input.html : ''
  const text = typeof input.text === 'string' ? input.text : ''
  const idempotencyKey =
    typeof input.idempotencyKey === 'string' ? input.idempotencyKey : ''

  if (to.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return null
  if (!subject || subject.length > 200 || /[\r\n]/.test(subject)) return null
  if (!html || html.length > MAX_HTML_LENGTH) return null
  if (!text || text.length > MAX_TEXT_LENGTH) return null
  if (
    !idempotencyKey ||
    idempotencyKey.length > 256 ||
    !/^[A-Za-z0-9._:/-]+$/.test(idempotencyKey)
  ) {
    return null
  }

  return { to, subject, html, text, idempotencyKey }
}

export async function handle(
  request: Request,
  dependencies: Dependencies = {},
): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405)
  }

  if (!hasServiceRole(request)) {
    return json({ error: 'service_role_required' }, 403)
  }

  const apiKey =
    dependencies.apiKey === undefined
      ? Deno.env.get('RESEND_API_KEY')?.trim() ?? ''
      : dependencies.apiKey?.trim() ?? ''

  if (!apiKey) return json({ error: 'mailer_not_configured' }, 503)

  const contentLength = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(contentLength) && contentLength > 150_000) {
    return json({ error: 'payload_too_large' }, 413)
  }

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const message = parseMessage(raw)
  if (!message) return json({ error: 'invalid_message' }, 400)

  const fetcher = dependencies.fetcher ?? fetch

  try {
    const response = await fetcher('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': message.idempotencyKey,
      },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        from: FROM,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
    })

    if (!response.ok) {
      // Do not read or log the provider response: it may contain PII.
      return json({ error: 'email_provider_failed' }, 502)
    }

    return json({ ok: true })
  } catch {
    // A timeout or network failure must not expose recipient/body/token data.
    return json({ error: 'email_provider_unavailable' }, 502)
  }
}

if (import.meta.main) {
  Deno.serve(handle)
}
