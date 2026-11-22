// supabase/functions/_shared/webhook.ts
//
// Проверка подписи Supabase Send Email Hook по спецификации Standard Webhooks,
// на Web Crypto (Edge Runtime).
//
// Схема подписи: HMAC-SHA-256 по строке `${webhook-id}.${webhook-timestamp}.${body}`,
// результат в base64. Ключ — base64-часть секрета вида `v1,whsec_<base64>`.

/** Допустимое расхождение часов: защита от повторного использования запроса */
const TOLERANCE_SECONDS = 5 * 60

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  // Явный ArrayBuffer: Web Crypto ожидает BufferSource<ArrayBuffer>,
  // а не Uint8Array<ArrayBufferLike>
  const buffer = new ArrayBuffer(binary.length)
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** Сравнение без ранних выходов: одинаковое время для равных и неравных строк */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false

  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

/**
 * Проверяет подпись по исходному телу запроса.
 * Возвращает true только при полностью валидной подписи и свежем timestamp.
 */
export async function verifyStandardWebhook(
  rawBody: string,
  headers: Headers,
  secret: string,
): Promise<boolean> {
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

  const keyBytes = base64ToBytes(base64Key)
  if (keyBytes.length === 0) return false

  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const signed = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`),
  )

  const expected = new Uint8Array(signed)

  // В заголовке может быть несколько подписей, разделённых пробелом
  for (const entry of signatureHeader.split(' ')) {
    const value = entry.startsWith('v1,') ? entry.slice(3) : entry
    if (!value) continue

    if (constantTimeEqual(base64ToBytes(value), expected)) return true
  }

  return false
}

export { TOLERANCE_SECONDS }
