// supabase/functions/_shared/env.ts
//
// Доступ к системным переменным Edge Runtime и клиентам Supabase.
//
// Только официальные системные переменные Supabase:
//   SUPABASE_URL
//   SUPABASE_SECRET_KEYS      → JSON, берём ключ "default"
//   SUPABASE_PUBLISHABLE_KEYS → JSON, берём ключ "default"
//
// Legacy-ключи (SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY) НЕ используются
// как fallback: это отдельное согласование, которого пока нет.
//
// Пустое значение, невалидный JSON, отсутствие "default" или нестроковое
// значение — считаются ошибкой конфигурации и дают null (fail closed).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.117.1'

export function env(name: string): string | null {
  const value = Deno.env.get(name)
  return value && value.trim().length > 0 ? value.trim() : null
}

export function supabaseUrl(): string {
  const url = env('SUPABASE_URL')
  if (!url) throw new Error('SUPABASE_URL is not available in Edge Runtime')
  return url
}

/**
 * Достаёт ключ "default" из системной JSON-переменной.
 * Любое отклонение формата → null.
 */
export function defaultKey(json: string | null): string | null {
  if (!json) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

  const value = (parsed as Record<string, unknown>).default
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** Административный ключ: SUPABASE_SECRET_KEYS.default */
export function adminKey(): string | null {
  return defaultKey(env('SUPABASE_SECRET_KEYS'))
}

/** Публикуемый ключ: SUPABASE_PUBLISHABLE_KEYS.default */
export function publishableKey(): string | null {
  return defaultKey(env('SUPABASE_PUBLISHABLE_KEYS'))
}

/**
 * Административный клиент.
 *
 * Роль service_role в новом формате задаётся самим ключом (sb_secret_*),
 * поэтому шаблон JWT не подставляем.
 */
export function createAdminClient(): SupabaseClient | null {
  const key = adminKey()
  if (!key) return null

  return createClient(supabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

/**
 * Клиент для проверки пользовательского JWT.
 *
 * Публикуемый ключ уходит в заголовок apikey (его выставляет supabase-js),
 * а Authorization: Bearer заполняется уже пользовательским токеном в getUser().
 * Публикуемый ключ НЕ является подтверждением личности: getUser(token)
 * проверяет именно переданный JWT на стороне GoTrue.
 */
export function createPublishableClient(): SupabaseClient | null {
  const key = publishableKey()
  if (!key) return null

  return createClient(supabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

/** Bearer-токен из заголовка Authorization, если он есть */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization')
  if (!header) return null

  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match ? match[1] : null
}
