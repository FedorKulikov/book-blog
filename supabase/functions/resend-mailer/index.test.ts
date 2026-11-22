// supabase/functions/resend-mailer/index.test.ts
//
// Unit tests for the protected Resend mailer. No real email is sent.

import { handle } from './index.ts'

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`)
  }
}

function serviceRoleToken(role = 'service_role'): string {
  const payload = btoa(JSON.stringify({ role }))
  return `test.${payload}.test`
}

function request(
  body: unknown,
  options: { method?: string; role?: string; includeAuth?: boolean } = {},
): Request {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  if (options.includeAuth !== false) {
    headers.set('Authorization', `Bearer ${serviceRoleToken(options.role)}`)
  }

  return new Request('https://project.supabase.co/functions/v1/resend-mailer', {
    method: options.method ?? 'POST',
    headers,
    body: options.method === 'GET' ? undefined : JSON.stringify(body),
  })
}

const MESSAGE = {
  to: 'reader@example.com',
  subject: 'Подтвердите email',
  html: '<p>Откройте ссылку подтверждения.</p>',
  text: 'Откройте ссылку подтверждения.',
  idempotencyKey: 'email-recovery-verify/user-1/abc123',
}

Deno.test('rejects requests without a server authorization token', async () => {
  const response = await handle(request(MESSAGE, { includeAuth: false }), {
    apiKey: 'test-key',
  })
  assertEqual(response.status, 403, 'status')
})

Deno.test('rejects ordinary authenticated users', async () => {
  const response = await handle(request(MESSAGE, { role: 'authenticated' }), {
    apiKey: 'test-key',
  })
  assertEqual(response.status, 403, 'status')
})

Deno.test('rejects non-POST methods', async () => {
  const response = await handle(request(MESSAGE, { method: 'GET' }), {
    apiKey: 'test-key',
  })
  assertEqual(response.status, 405, 'status')
})

Deno.test('fails closed when RESEND_API_KEY is absent', async () => {
  const response = await handle(request(MESSAGE), { apiKey: '' })
  assertEqual(response.status, 503, 'status')
})

Deno.test('rejects malformed outgoing email data', async () => {
  const response = await handle(
    request({ ...MESSAGE, to: 'not-an-email' }),
    { apiKey: 'test-key' },
  )
  assertEqual(response.status, 400, 'status')
})

Deno.test('sends only the fixed sender and the requested recipient', async () => {
  let target = ''
  let headers: HeadersInit | undefined
  let body: Record<string, unknown> | undefined
  let hasTimeout = false

  const response = await handle(request(MESSAGE), {
    apiKey: 'test-key',
    fetcher: async (input, init) => {
      target = String(input)
      headers = init?.headers
      body = JSON.parse(String(init?.body)) as Record<string, unknown>
      hasTimeout = init?.signal instanceof AbortSignal
      return new Response('{"id":"test"}', { status: 200 })
    },
  })

  assertEqual(response.status, 200, 'status')
  assertEqual(target, 'https://api.resend.com/emails', 'provider URL')
  const sentHeaders = new Headers(headers)
  assertEqual(sentHeaders.get('Authorization'), 'Bearer test-key', 'authorization')
  assertEqual(sentHeaders.get('Idempotency-Key'), MESSAGE.idempotencyKey, 'idempotency')
  assertEqual(body?.from, 'Хлеба и букв <no-reply@bukleb.ru>', 'fixed sender')
  assertEqual(JSON.stringify(body?.to), JSON.stringify([MESSAGE.to]), 'recipient')
  assertEqual(body?.html, MESSAGE.html, 'html')
  assertEqual(body?.text, MESSAGE.text, 'text')
  assert(hasTimeout, 'provider request must have an AbortSignal timeout')
})

Deno.test('does not expose the provider response body on failure', async () => {
  const response = await handle(request(MESSAGE), {
    apiKey: 'test-key',
    fetcher: async () =>
      new Response('recipient private data and token', { status: 500 }),
  })
  assertEqual(response.status, 502, 'status')
  const body = await response.text()
  assert(!body.includes('recipient private data'), 'provider body must not be exposed')
})

Deno.test('maps network and timeout errors to a generic response', async () => {
  const response = await handle(request(MESSAGE), {
    apiKey: 'test-key',
    fetcher: async () => {
      throw new Error('private recipient and token')
    },
  })
  assertEqual(response.status, 502, 'status')
  const body = await response.text()
  assert(!body.includes('private recipient'), 'network error must not be exposed')
})
