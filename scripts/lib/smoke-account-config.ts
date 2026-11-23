/**
 * Central allow-list for disposable Supabase Auth accounts created by production smoke scripts.
 * Keep email prefixes here; SQL match predicates and TypeScript validation derive from this list.
 */
export const SMOKE_ACCOUNT_EMAIL_PREFIXES = [
  'data-smoke-',
  'chat-smoke-',
] as const

export const SMOKE_ACCOUNT_EMAIL_SUFFIX = '@example.com'

const escapedPrefixes = SMOKE_ACCOUNT_EMAIL_PREFIXES.map(prefix =>
  prefix.replace(/[.*+?^\${}()|[\]\\]/g, '\\$&'),
)

export const SMOKE_ACCOUNT_EMAIL_REGEX = new RegExp(
  `^(?:${escapedPrefixes.join('|')})[^@\\s]+${SMOKE_ACCOUNT_EMAIL_SUFFIX.replace('.', '\\.')} $`.replace(' $', '$'),
  'i',
)

export function smokeAccountEmailLikeSql(column = 'lower(email)'): string {
  const patterns = SMOKE_ACCOUNT_EMAIL_PREFIXES
    .map(prefix => `'${(prefix + '%'+SMOKE_ACCOUNT_EMAIL_SUFFIX).replace(/'/g, "''").toLowerCase()}'`)
    .join(', ')
  return `${column} like any(array[${patterns}]::text[])`
}

export function smokeAccountEmailMatches(email: string): boolean {
  return SMOKE_ACCOUNT_EMAIL_REGEX.test(email)
}
