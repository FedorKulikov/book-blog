// supabase/functions/auth-email-hook/index.test.ts
//
// Тесты HTTP-обработчика Send Email Hook без сети: проверяется только
// собственная логика — конфигурация, подпись и выбор ответа.
import { handle } from './index.ts'

const KEY_BYTES = new Uint8Array(32).map((_, i) => (i + 7) & 0xff)
const SECRET = `v1,whsec_${btoa(String.fromCharCode(...KEY_BYTES))}`

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`)
  }
}

async function sign(id: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(new ArrayBuffer(KEY_BYTES.length)).map((_, i) => (i + 7) & 0xff),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${body}`),
  )
  return `v1,${btoa(String.fromCharCode(...new Uint8Array(signature)))}`
}

function payload(action: string): string {
  return JSON.stringify({ user: { id: 'u1' }, email_data: { email_action_type: action } })
}

async function post(
  action: string,
  opts: { body?: string; signature?: string; timestamp?: number; noHeaders?: boolean } = {},
): Promise<Response> {
  const body = opts.body ?? payload(action)
  const id = 'msg_test'
  const ts = String(opts.timestamp ?? Math.floor(Date.now() / 1000))
  const headers = new Headers({ 'Content-Type': 'application/json' })

  if (!opts.noHeaders) {
    headers.set('webhook-id', id)
    headers.set('webhook-timestamp', ts)
    headers.set('webhook-signature', opts.signature ?? (await sign(id, ts, body)))
  }

  return handle(
    new Request('https://example.com/functions/v1/auth-email-hook', {
      method: 'POST',
      headers,
      body,
    }),
  )
}

function withSecret<T>(fn: () => Promise<T>): Promise<T> {
  Deno.env.set('AUTH_EMAIL_HOOK_SECRET', SECRET)
  return fn().finally(() => Deno.env.delete('AUTH_EMAIL_HOOK_SECRET'))
}

Deno.test('подписанный recovery → 200 {} с JSON', async () => {
  await withSecret(async () => {
    const res = await post('recovery')
    assertEqual(res.status, 200, 'статус')
    assertEqual(res.headers.get('content-type')?.includes('application/json'), true, 'content-type')
    assertEqual(await res.text(), '{}', 'тело')
  })
})

Deno.test('подписанный signup → 200', async () => {
  await withSecret(async () => {
    const res = await post('signup')
    assertEqual(res.status, 200, 'статус')
  })
})

Deno.test('отсутствие секрета → 500, а не 200', async () => {
  Deno.env.delete('AUTH_EMAIL_HOOK_SECRET')
  const res = await post('recovery')
  assertEqual(res.status, 500, 'статус')
  const body = await res.json()
  assertEqual(body.error.message, 'hook_not_configured', 'сообщение')
})

Deno.test('неверная подпись → 401', async () => {
  await withSecret(async () => {
    const res = await post('recovery', { signature: 'v1,AAAA' })
    assertEqual(res.status, 401, 'статус')
  })
})

Deno.test('просроченная подпись → 401', async () => {
  await withSecret(async () => {
    const res = await post('recovery', { timestamp: Math.floor(Date.now() / 1000) - 600 })
    assertEqual(res.status, 401, 'статус')
  })
})

Deno.test('изменённое тело → 401', async () => {
  await withSecret(async () => {
    const original = payload('recovery')
    const tampered = payload('signup')
    const id = 'msg_test'
    const ts = String(Math.floor(Date.now() / 1000))
    const sig = await sign(id, ts, original)

    const res = await handle(
      new Request('https://example.com/functions/v1/auth-email-hook', {
        method: 'POST',
        headers: new Headers({
          'Content-Type': 'application/json',
          'webhook-id': id,
          'webhook-timestamp': ts,
          'webhook-signature': sig,
        }),
        body: tampered,
      }),
    )

    assertEqual(res.status, 401, 'статус')
  })
})

Deno.test('отсутствие заголовков подписи → 401', async () => {
  await withSecret(async () => {
    const res = await post('recovery', { noHeaders: true })
    assertEqual(res.status, 401, 'статус')
  })
})

Deno.test('неизвестное событие → 501', async () => {
  await withSecret(async () => {
    const res = await post('something_new')
    assertEqual(res.status, 501, 'статус')
  })
})

Deno.test('неподдерживаемая доставка → 501', async () => {
  await withSecret(async () => {
    const res = await post('magiclink')
    assertEqual(res.status, 501, 'статус')
  })
})

Deno.test('не-POST метод → 405', async () => {
  const res = await handle(
    new Request('https://example.com/functions/v1/auth-email-hook', { method: 'GET' }),
  )
  assertEqual(res.status, 405, 'статус')
})
