// lib/recovery.ts
//
// Генерация и хеширование резервных кодов восстановления.
//
// ВАЖНО: модуль серверный — использует node:crypto. Импортировать его из
// клиентских компонентов нельзя: код и секрет не должны попасть в браузер.
//
// Формат кода: 160 бит энтропии (20 случайных байт) → Crockford base32
// (32 символа) → группы по 4 через дефис: XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX
//
// В base32 нет букв I, L, O, U — их невозможно перепутать с 1, 0 и между
// собой при вводе с бумаги. При нормализации ввода они всё равно
// приводятся к цифрам, чтобы человек не мучился.
import { createHmac, randomBytes } from 'node:crypto'

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
 * randomBytes — криптостойкий источник (CSPRNG ОС), не Math.random.
 */
export function generateRecoveryCodes(count: number = CODES_PER_BATCH): string[] {
  const seen = new Set<string>()

  while (seen.size < count) {
    seen.add(formatCode(toBase32(randomBytes(CODE_BYTES))))
  }

  return Array.from(seen)
}

function toBase32(bytes: Buffer): string {
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

/**
 * HMAC-SHA-256 в hex. Один и тот же секрет используется для кодов
 * и для хеширования IP/имени в журнале попыток.
 */
export function hmacHex(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('hex')
}

/** Хеш кода: в базе лежит только он */
export function hashCode(normalizedCode: string, secret: string): string {
  return hmacHex(normalizedCode, secret)
}

/**
 * Настроено ли восстановление на сервере.
 * Секрет короче 32 байт не принимаем: HMAC с коротким ключом
 * обесценивает всю схему.
 */
export function isRecoveryConfigured(): boolean {
  const secret = process.env.RECOVERY_CODE_SECRET
  return Boolean(secret && secret.length >= 32 && process.env.SUPABASE_SERVICE_ROLE_KEY)
}
