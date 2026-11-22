// supabase/functions/_shared/webhook.test.ts
//
// Deno-тесты проверки подписи Standard Webhooks.
// Запуск: deno test supabase/functions/_shared/webhook.test.ts
import { TOLERANCE_SECONDS, verifyStandardWebhook } from './webhook.ts'

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`)
  }
}

/** Тестовый ключ: 32 байта, base64 */
const KEY_BYTES = new Uint8Array(32).map((_, i) => (i + 1) & 0xff)
const KEY_B64 = btoa(String.fromCharCode(...KEY_BYTES))
const SECRET = `v1,whsec_${KEY_B64}`

function toBase64(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
}

async function sign(
  id: string,
  timestamp: string,
  body: string,
  secret: string = SECRET,
): Promise<string> {
  const withoutVersion = secret.startsWith('v1,') ? secret.slice(3) : secret
  const base64Key = withoutVersion.startsWith('whsec_')
    ? withoutVersion.slice(6)
    : withoutVersion

  const binary = atob(base64Key)
  const keyBytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i++) keyBytes[i] = binary.charCodeAt(i)

  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${body}`),
  )

  return `v1,${toBase64(signature)}`
}

function headers(id: string, timestamp: string, signature: string): Headers {
  return new Headers({
    'webhook-id': id,
    'webhook-timestamp': timestamp,
    'webhook-signature': signature,
  })
}

const BODY = JSON.stringify({ email_data: { email_action_type: 'recovery' } })
const NOW = (): number => Math.floor(Date.now() / 1000)

Deno.test('валидная подпись принимается', async () => {
  const id = 'msg_1'
  const ts = String(NOW())
  const sig = await sign(id, ts, BODY)

  assertEqual(await verifyStandardWebhook(BODY, headers(id, ts, sig), SECRET), true, 'подпись')
})

Deno.test('неверная подпись отклоняется', async () => {
  const id = 'msg_2'
  const ts = String(NOW())

  assertEqual(
    await verifyStandardWebhook(BODY, headers(id, ts, 'v1,AAAA'), SECRET),
    false,
    'битая подпись',
  )
})

Deno.test('изменённое тело отклоняется', async () => {
  const id = 'msg_3'
  const ts = String(NOW())
  const sig = await sign(id, ts, BODY)

  assertEqual(
    await verifyStandardWebhook(`${BODY} `, headers(id, ts, sig), SECRET),
    false,
    'тело изменено после подписи',
  )
})

Deno.test('неправильный секрет отклоняется', async () => {
  const id = 'msg_4'
  const ts = String(NOW())
  const sig = await sign(id, ts, BODY)

  const otherKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)))
  const otherSecret = `v1,whsec_${otherKey}`

  assertEqual(
    await verifyStandardWebhook(BODY, headers(id, ts, sig), otherSecret),
    false,
    'чужой секрет',
  )
})

Deno.test('отсутствующие заголовки отклоняются', async () => {
  assertEqual(
    await verifyStandardWebhook(BODY, new Headers(), SECRET),
    false,
    'без заголовков',
  )

  const id = 'msg_5'
  const ts = String(NOW())
  const sig = await sign(id, ts, BODY)

  assertEqual(
    await verifyStandardWebhook(BODY, new Headers({ 'webhook-id': id }), SECRET),
    false,
    'без timestamp и signature',
  )

  assertEqual(
    await verifyStandardWebhook(
      BODY,
      new Headers({ 'webhook-id': id, 'webhook-timestamp': ts }),
      SECRET,
    ),
    false,
    'без signature',
  )
})

Deno.test('timestamp за пределами ±300 секунд отклоняется', async () => {
  const id = 'msg_6'

  const oldTs = String(NOW() - TOLERANCE_SECONDS - 5)
  const oldSig = await sign(id, oldTs, BODY)
  assertEqual(
    await verifyStandardWebhook(BODY, headers(id, oldTs, oldSig), SECRET),
    false,
    'старый timestamp',
  )

  const futureTs = String(NOW() + TOLERANCE_SECONDS + 5)
  const futureSig = await sign(id, futureTs, BODY)
  assertEqual(
    await verifyStandardWebhook(BODY, headers(id, futureTs, futureSig), SECRET),
    false,
    'будущий timestamp',
  )
})

Deno.test('нечисловой timestamp отклоняется', async () => {
  const id = 'msg_7'
  const ts = 'not-a-number'
  const sig = await sign(id, ts, BODY)

  assertEqual(
    await verifyStandardWebhook(BODY, headers(id, ts, sig), SECRET),
    false,
    'нечисловой timestamp',
  )
})
