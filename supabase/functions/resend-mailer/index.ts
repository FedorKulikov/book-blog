// supabase/functions/resend-mailer/index.ts
//
// Private service-to-service mail delivery through Resend.
//
// Supabase's new secret API keys are opaque values, not JWTs. The platform
// gateway therefore has verify_jwt=false for this function. Before processing
// any payload, this handler compares the request's apikey header against the
// project's default key in SUPABASE_SECRET_KEYS. No email is sent to callers
// that do not present that exact server-only key.
//
// RESEND_API_KEY exists only in Supabase Function Secrets. The sender is
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
  supabaseSecretKey?: string | null
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

function constantTimeEqual(actual: string, expected: string): boolean {
  const actualBytes = new TextEncoder().encode(actual)
  const expectedBytes = new TextEncoder().encode(expected)
  if (actualBytes.length !== expectedBytes.length) return false

  let difference = 0
  for (let index = 0; index < actualBytes.length; index++) {
    difference |= actualBytes[index] ^ expectedBytes[index]
  }
  return difference === 0
}

function defaultSupabaseSecretKey(): string {
  const raw = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (!raw) return ''

  try {
    const keys = JSON.parse(raw) as Record<string, unknown>
    const value = keys.default
    return typeof value === 'string' ? value : ''
  } catch {
    return ''
  }
}

function hasServiceAuthorization(
  request: Request,
  expectedKey: string,
): boolean {
  const provided = request.headers.get('apikey')?.trim() ?? ''
  return Boolean(provided && expectedKey && constantTimeEqual(provided, expectedKey))
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

  const expectedKey =
    dependencies.supabaseSecretKey === undefined
      ? defaultSupabaseSecretKey()
      : dependencies.supabaseSecretKey ?? ''

  if (!hasServiceAuthorization(request, expectedKey)) {
    return json({ error: 'service_authorization_required' }, 401)
  }

  const resendApiKey =
    dependencies.apiKey === undefined
      ? Deno.env.get('RESEND_API_KEY')?.trim() ?? ''
      : dependencies.apiKey?.trim() ?? ''

  if (!resendApiKey) return json({ error: 'mailer_not_configured' }, 503)

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
        Authorization: `Bearer ${resendApiKey}`,
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

Deno.serve(handle)
