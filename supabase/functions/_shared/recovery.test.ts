// supabase/functions/_shared/recovery.test.ts
//
// Deno-тесты криптографии резервных кодов.
// Запуск: deno test supabase/functions/_shared/recovery.test.ts
import {
  CODES_PER_BATCH,
  generateRecoveryCodes,
  hashCode,
  hmacHex,
  normalizeCode,
} from './recovery.ts'

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`)
  }
}

Deno.test('generateRecoveryCodes: 10 уникальных кодов', () => {
  const codes = generateRecoveryCodes()

  assertEqual(codes.length, CODES_PER_BATCH, 'количество')
  assertEqual(new Set(codes).size, CODES_PER_BATCH, 'уникальность')
})

Deno.test('generateRecoveryCodes: формат XXXX-XXXX-... и длина 39', () => {
  for (const code of generateRecoveryCodes()) {
    assert(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){7}$/.test(code), `формат нарушен: ${code}`)
    assertEqual(code.length, 39, 'длина')
    // Crockford: нет I, L, O, U
    assert(!/[ILOU]/.test(code), `недопустимый символ в ${code}`)
  }
})

Deno.test('normalizeCode: регистр, дефисы, I/L→1, O→0', () => {
  const canonical = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'.slice(0, 32)
  const withDashes = canonical.match(/.{4}/g)!.join('-')

  assertEqual(normalizeCode(withDashes), canonical, 'дефисы')
  assertEqual(normalizeCode(withDashes.toLowerCase()), canonical, 'регистр')
  assertEqual(normalizeCode('O'.repeat(32)), '0'.repeat(32), 'O→0')
  assertEqual(normalizeCode('I'.repeat(32)), '1'.repeat(32), 'I→1')
  assertEqual(normalizeCode('L'.repeat(32)), '1'.repeat(32), 'L→1')
})

Deno.test('normalizeCode: мусор отклоняется', () => {
  assertEqual(normalizeCode(''), null, 'пустая строка')
  assertEqual(normalizeCode('TOO-SHORT'), null, 'короткий код')
  assertEqual(normalizeCode('U'.repeat(32)), null, 'буква U вне алфавита')
})

Deno.test('hmacHex: детерминированность и зависимость от секрета', async () => {
  const a = await hmacHex('payload', 'secret-one')
  const b = await hmacHex('payload', 'secret-one')
  const c = await hmacHex('payload', 'secret-two')

  assertEqual(a, b, 'одинаковый вход и секрет')
  assert(a !== c, 'разные секреты должны давать разные хеши')
  assertEqual(a.length, 64, 'HMAC-SHA-256 в hex — 64 символа')
  assert(/^[0-9a-f]{64}$/.test(a), 'hex-формат')
})

Deno.test('hashCode: хеш кода не совпадает с открытым кодом', async () => {
  const [code] = generateRecoveryCodes(1)
  const normalized = normalizeCode(code)!
  const hash = await hashCode(normalized, 'secret-one')

  assert(hash !== normalized, 'хеш не должен совпадать с кодом')
  assertEqual(await hashCode(normalized, 'secret-one'), hash, 'повторный хеш')
  assert(
    (await hashCode(normalized, 'secret-two')) !== hash,
    'другой секрет — другой хеш',
  )
})
