/**
 * Single source of truth for disposable Supabase Auth accounts created by production smoke scripts.
 * Keep all smoke email prefixes here; selectors, SQL predicates and generators derive from this map.
 */
export const SMOKE_ACCOUNT_PREFIX = {
  data: 'data-smoke-',
  chat: 'chat-smoke-',
} as const

export const SMOKE_ACCOUNT_EMAIL_PREFIXES = Object.values(SMOKE_ACCOUNT_PREFIX)
export const SMOKE_ACCOUNT_EMAIL_SUFFIX = '@example.com'

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const escapedPrefixes = SMOKE_ACCOUNT_EMAIL_PREFIXES.map(escapeRegex)
const escapedSuffix = escapeRegex(SMOKE_ACCOUNT_EMAIL_SUFFIX)

export const SMOKE_ACCOUNT_EMAIL_REGEX = new RegExp(
  `^(?:${escapedPrefixes.join('|')})[^@\\s]+${escapedSuffix}$`,
  'i',
)

export function smokeAccountEmailLikeSql(column = 'lower(email)'): string {
  const patterns = SMOKE_ACCOUNT_EMAIL_PREFIXES
    .map(prefix => `'${(prefix + '%' + SMOKE_ACCOUNT_EMAIL_SUFFIX).replace(/'/g, "''").toLowerCase()}'`)
    .join(', ')
  return `${column} like any(array[${patterns}]::text[])`
}

export function smokeAccountEmailMatches(email: string): boolean {
  return SMOKE_ACCOUNT_EMAIL_REGEX.test(email)
}
