import {
  generateRecoveryCodes,
  hashCode,
  normalizeCode,
} from '../lib/recovery'

const secret = 'recovery-regression-test-secret'
const codes = generateRecoveryCodes()

if (codes.length !== 10) {
  throw new Error(`Expected 10 generated codes, got ${codes.length}`)
}

for (const code of codes) {
  const normalized = normalizeCode(code)
  if (!normalized) {
    throw new Error('Generated recovery code did not normalize')
  }

  const hashes = [
    hashCode(code, secret),
    hashCode(normalized, secret),
    hashCode(code.replace(/-/g, ''), secret),
    hashCode(code.toLowerCase(), secret),
  ]

  if (new Set(hashes).size !== 1) {
    throw new Error('Formatted, normalized, and lowercase codes must have the same HMAC')
  }
}

let invalidRejected = false
try {
  hashCode('NOT-A-RECOVERY-CODE', secret)
} catch {
  invalidRejected = true
}

if (!invalidRejected) {
  throw new Error('Invalid recovery code was not rejected')
}

console.log('PASS — Node recovery code hashing: formatting is canonical and invalid input is rejected')
