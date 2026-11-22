// supabase/functions/auth-email-hook/index.test.ts
//
// No real recipient, Resend call, or Supabase Auth operation is used.
// The tests verify only signed synthetic Send Email Hook payloads.

import { handle } from './index.ts'

const KEY_BYTES = new Uint8Array(32).map((_, index) => (index + 11) & 0xff)
const HOOK_SECRET = `v1,whsec_${btoa(String.fromCharCode(...KEY_BYTES))}`
const SUPABASE_SECRET_KEY = 'sb_secret_synthetic_test_value'

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

function equal<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`)
  }
}

async function signature(id: string, timestamp: string, body: string): Promise<string> {
  const bytes = new Uint8Array(new ArrayBuffer(KEY_BYTES.length))
  bytes.set(KEY_BYTES)
  const key = await crypto.subtle.importKey(
    'raw',
    bytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signed = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${body}`),
  )
  return `v1,${btoa(String.fromCharCode(...new Uint8Array(signed)))}`
}

async function signedRequest(payload: unknown, options: {
  timestamp?: number
  signature?: string
} = {}): Promise<Request> {
  const body = JSON.stringify(payload)
  const id = 'msg_synthetic_test'
  const timestamp = String(options.timestamp ?? Math.floor(Date.now() / 1000))
  const headers = new Headers({
    'Content-Type': 'application/json',
    'webhook-id': id,
    'webhook-timestamp': timestamp,
    'webhook-signature': options.signature ?? await signature(id, timestamp, body),
  })

  return new Request('https://project.supabase.co/functions/v1/auth-email-hook', {
    method: 'POST',
    headers,
    body,
  })
}

function signupPayload() {
  return {
    user: {
      id: 'user-synthetic-1',
      email: 'reader@example.test',
    },
    email_data: {
      email_action_type: 'signup',
      token_hash: 'synthetic_signup_token_hash_1234567890',
      site_url: 'https://auth-project.supabase.co',
      redirect_to: 'https://evil.example/redirect',
    },
  }
}

function dependencies(fetcher: typeof fetch) {
  return {
    hookSecret: HOOK_SECRET,
    siteUrl: 'https://bukleb.ru',
    projectUrl: 'https://project.supabase.co',
    supabaseSecretKey: SUPABASE_SECRET_KEY,
    fetcher,
  }
}

Deno.test('signed signup sends one confirmation through the internal Edge mailer', async () => {
  let calls = 0
  let destination = ''
  let headers: HeadersInit | undefined
  let body: Record<string, unknown> | undefined

  const request = await signedRequest(signupPayload())
  const response = await handle(request, dependencies(async (input, init) => {
    calls++
    destination = String(input)
    headers = init?.headers
    body = JSON.parse(String(init?.body)) as Record<string, unknown>
    return new Response('{}', { status: 200 })
  }))

  equal(response.status, 200, 'hook response')
  equal(await response.text(), '{}', 'hook body')
  equal(calls, 1, 'mailer calls')
  equal(destination, 'https://project.supabase.co/functions/v1/resend-mailer', 'mailer URL')

  const sentHeaders = new Headers(headers)
  equal(sentHeaders.get('apikey'), SUPABASE_SECRET_KEY, 'Supabase secret apikey header')
  equal(sentHeaders.get('Authorization'), null, 'no bearer header')

  equal(body?.to, 'reader@example.test', 'recipient')
  equal(body?.subject, 'Подтвердите email — Хлеба и букв', 'subject')
  equal(body?.from, undefined, 'caller cannot supply sender')

  const html = String(body?.html ?? '')
  const text = String(body?.text ?? '')
  const htmlLink = html.match(/href="([^"]+)"/)?.[1] ?? ''
  const link = new URL(htmlLink)

  equal(link.origin, 'https://bukleb.ru', 'confirmation link origin')
  equal(link.pathname, '/auth/confirm', 'confirmation path')
  equal(link.searchParams.get('token_hash'), 'synthetic_signup_token_hash_1234567890', 'token hash')
  equal(link.searchParams.get('type'), 'signup', 'external signup type')
  assert(!link.searchParams.has('redirect_to'), 'untrusted redirect_to must be ignored')
  assert(html.includes('Не пересылайте это письмо'), 'forwarding warning in HTML')
  assert(text.includes('ограниченное время'), 'expiry notice in text')
  assert(!text.includes('auth-project.supabase.co'), 'never link to Supabase Auth domain')
})

Deno.test('recovery is suppressed without calling the Resend mailer', async () => {
  const request = await signedRequest({
    user: { id: 'user-synthetic-2', email: 'reader@example.test' },
    email_data: {
      email_action_type: 'recovery',
      token_hash: 'synthetic_recovery_hash',
    },
  })
  let calls = 0
  const response = await handle(request, dependencies(async () => {
    calls++
    return new Response('{}', { status: 200 })
  }))

  equal(response.status, 200, 'recovery status')
  equal(await response.text(), '{}', 'recovery body')
  equal(calls, 0, 'recovery must not send a reset link')
})

Deno.test('secure email change sends current and new address with documented hash mapping', async () => {
  const request = await signedRequest({
    user: {
      id: 'user-synthetic-3',
      email: 'old@example.test',
      new_email: 'new@example.test',
    },
    email_data: {
      email_action_type: 'email_change',
      token: '111111',
      token_hash_new: 'synthetic_hash_for_current_address_123456',
      token_new: '222222',
      token_hash: 'synthetic_hash_for_new_address_123456',
    },
  })

  const sent: Array<{ to: string; html: string }> = []
  const response = await handle(request, dependencies(async (_input, init) => {
    const message = JSON.parse(String(init?.body)) as { to: string; html: string }
    sent.push(message)
    return new Response('{}', { status: 200 })
  }))

  equal(response.status, 200, 'email change status')
  equal(sent.length, 2, 'secure email change mail count')
  equal(sent[0].to, 'old@example.test', 'current address')
  equal(sent[1].to, 'new@example.test', 'new address')

  const currentLink = new URL(sent[0].html.match(/href="([^"]+)"/)?.[1] ?? '')
  const newLink = new URL(sent[1].html.match(/href="([^"]+)"/)?.[1] ?? '')
  equal(currentLink.searchParams.get('token_hash'), 'synthetic_hash_for_current_address_123456', 'current hash mapping')
  equal(newLink.searchParams.get('token_hash'), 'synthetic_hash_for_new_address_123456', 'new address hash mapping')
  equal(currentLink.searchParams.get('type'), 'email_change', 'current email change type')
  equal(newLink.searchParams.get('type'), 'email_change', 'new email change type')
})

Deno.test('single-token email change sends only to the new address', async () => {
  const request = await signedRequest({
    user: {
      id: 'user-synthetic-4',
      email: 'old@example.test',
      new_email: 'new@example.test',
    },
    email_data: {
      email_action_type: 'email_change',
      token: '333333',
      token_hash: 'synthetic_hash_for_new_address_abcdef',
      token_hash_new: '',
    },
  })

  const sent: Array<{ to: string }> = []
  const response = await handle(request, dependencies(async (_input, init) => {
    sent.push(JSON.parse(String(init?.body)) as { to: string })
    return new Response('{}', { status: 200 })
  }))

  equal(response.status, 200, 'single-token email change status')
  equal(sent.length, 1, 'single-token mail count')
  equal(sent[0].to, 'new@example.test', 'single-token recipient')
})

Deno.test('unsupported action returns 501 without sending', async () => {
  const request = await signedRequest({
    user: { id: 'user-synthetic-5', email: 'reader@example.test' },
    email_data: { email_action_type: 'magiclink' },
  })
  let calls = 0
  const response = await handle(request, dependencies(async () => {
    calls++
    return new Response('{}', { status: 200 })
  }))

  equal(response.status, 501, 'unsupported action status')
  equal(calls, 0, 'unsupported action mailer calls')
})

Deno.test('missing Hook secret fails closed', async () => {
  const request = await signedRequest(signupPayload())
  const response = await handle(request, dependencies(async () => {
    throw new Error('must not call mailer')
  }) && {
    ...dependencies(async () => new Response('{}', { status: 200 })),
    hookSecret: '',
  })

  equal(response.status, 500, 'missing secret status')
})

Deno.test('invalid signature is rejected before parsing or sending', async () => {
  const request = await signedRequest(signupPayload(), { signature: 'v1,invalid' })
  let calls = 0
  const response = await handle(request, dependencies(async () => {
    calls++
    return new Response('{}', { status: 200 })
  }))

  equal(response.status, 401, 'invalid signature status')
  equal(calls, 0, 'invalid signature must not call mailer')
})

Deno.test('mailer failure is returned as generic 502 without provider details', async () => {
  const request = await signedRequest(signupPayload())
  const response = await handle(request, dependencies(async () =>
    new Response('private provider detail', { status: 502 }),
  ))

  equal(response.status, 502, 'mailer failure status')
  const body = await response.text()
  assert(!body.includes('private provider detail'), 'provider response must not be exposed')
})

Deno.test('non-POST requests are rejected', async () => {
  const response = await handle(
    new Request('https://project.supabase.co/functions/v1/auth-email-hook', {
      method: 'GET',
    }),
    dependencies(async () => new Response('{}', { status: 200 })),
  )

  equal(response.status, 405, 'method status')
})
