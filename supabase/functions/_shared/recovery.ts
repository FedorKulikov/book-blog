// supabase/functions/_shared/recovery.ts
//
// Криптография резервных кодов для Edge Runtime (Deno).
// Логика 1:1 повторяет lib/recovery.ts: те же 160 бит энтропии,
// тот же Crockford base32, та же канонизация ввода и HMAC-SHA-256.
// Разница только в реализации: Web Crypto вместо node:crypto.

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** Сколько кодов выдаётся за одну генерацию */
export const CODES_PER_BATCH = 10

/** 20 байт = 160 бит энтропии на код */
const CODE_BYTES = 20

/** 20 байт в base32 = ровно 32 символа */
const CODE_CHARS = 32

const GROUP = 4

/** Минимальная длина пароля при восстановлении */
export const MIN_PASSWORD_LENGTH = 8

/**
 * Десять кодов, гарантированно различных между собой.
 * crypto.getRandomValues — CSPRNG среды исполнения, не Math.random.
 */
export function generateRecoveryCodes(count: number = CODES_PER_BATCH): string[] {
  const seen = new Set<string>()

  while (seen.size < count) {
    const bytes = new Uint8Array(CODE_BYTES)
    crypto.getRandomValues(bytes)
    seen.add(formatCode(toBase32(bytes)))
  }

  return Array.from(seen)
}

function toBase32(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let out = ''

  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8

    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }

  if (bits > 0) {
    out += ALPHABET[(value << (5 - bits)) & 31]
  }

  return out
}

function formatCode(raw: string): string {
  const groups: string[] = []
  for (let i = 0; i < raw.length; i += GROUP) {
    groups.push(raw.slice(i, i + GROUP))
  }
  return groups.join('-')
}

/**
 * Приводит введённый код к канонической форме.
 * Возвращает null, если это заведомо не наш код.
 */
export function normalizeCode(input: string): string | null {
  const cleaned = input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')

  if (cleaned.length !== CODE_CHARS) return null

  for (const ch of cleaned) {
    if (!ALPHABET.includes(ch)) return null
  }

  return cleaned
}

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

/**
 * HMAC-SHA-256 в hex. Один и тот же секрет используется для кодов
 * и для хеширования имени в журнале попыток.
 */
export async function hmacHex(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(value),
  )

  return Array.from(new Uint8Array(signature))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

/** Хеш кода: в базе лежит только он */
export async function hashCode(
  normalizedCode: string,
  secret: string,
): Promise<string> {
  return hmacHex(normalizedCode, secret)
}

export { base64ToBytes }
