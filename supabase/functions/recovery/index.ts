// supabase/functions/recovery/index.ts
//
// Восстановление пароля по резервным кодам. Три операции через ?op=:
//   generate — 10 новых кодов (только владелец аккаунта + пароль);
//   status   — сколько кодов активно (только владелец аккаунта);
//   redeem   — смена пароля по username + одноразовому коду (публично).
//
// Бизнес-логика повторяет проверенную реализацию Next.js: те же коды,
// тот же HMAC, те же лимиты, те же RPC и те же тексты ошибок.
// База не меняется: private.recovery_codes, private.recovery_attempts
// и функции public.* остаются как есть.
import {
  bearerToken,
  createAdminClient,
  createPublishableClient,
  env,
  publishableKey,
} from '../_shared/env.ts'
import {
  CODES_PER_BATCH,
  MIN_PASSWORD_LENGTH,
  generateRecoveryCodes,
  hashCode,
  hmacHex,
  normalizeCode,
} from '../_shared/recovery.ts'

const NO_STORE = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }

const GENERIC_ERROR =
  'Не удалось восстановить доступ. Проверьте имя пользователя и резервный код.'

const WINDOW_MINUTES = 15
const MAX_USER_FAILURES = 5

/** Пауза на неудаче: время ответа не должно выдавать причину */
const FAILURE_DELAY_MS = 300

/**
 * Доверенный заголовок с IP.
 *
 * Шлюз Supabase не подтверждён как перезаписывающий X-Forwarded-For,
 * поэтому использовать его для лимитов нельзя: клиент подставит что угодно.
 * Пока значение равно null, IP-лимит выключен, а попытки пишутся с
 * одноразовым хешем — общего «bucket unknown» не возникает.
 * Основная защита от перебора — лимит по username.
 */
const TRUSTED_IP_HEADER: string | null = null

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: NO_STORE })
}

function clientIp(request: Request): string | null {
  if (!TRUSTED_IP_HEADER) return null
  const value = request.headers.get(TRUSTED_IP_HEADER)
  return value ? value.trim() : null
}

type FailuresRow = { ip_failures: number; user_failures: number }

/** Проверка пользовательского JWT. UID берётся только отсюда. */
async function requireUser(request: Request) {
  const token = bearerToken(request)
  if (!token) return null

  const client = createPublishableClient()
  if (!client) return null

  const { data, error } = await client.auth.getUser(token)
  if (error || !data.user?.email) return null

  return { user: data.user, client }
}

async function handleGenerate(request: Request): Promise<Response> {
  const auth = await requireUser(request)
  if (!auth) return json({ error: 'Требуется вход в аккаунт' }, 401)

  let password = ''
  try {
    const body: unknown = await request.json()
    if (body && typeof body === 'object' && 'password' in body) {
      const value = (body as { password?: unknown }).password
      if (typeof value === 'string') password = value
    }
  } catch {
    return json({ error: 'Некорректный запрос' }, 400)
  }

  if (!password) return json({ error: 'Подтвердите пароль' }, 400)

  // Перепроверка пароля обычным клиентом: service_role для этого не нужен
  const { error: reauthError } = await auth.client.auth.signInWithPassword({
    email: auth.user.email!,
    password,
  })
  if (reauthError) return json({ error: 'Неверный пароль' }, 403)

  const admin = createAdminClient()
  const secret = env('RECOVERY_CODE_SECRET')
  if (!admin || !secret) {
    return json(
      {
        error:
          'Восстановление по резервным кодам не настроено на сервере. ' +
          'Нужны RECOVERY_CODE_SECRET и системный секретный ключ Supabase.',
      },
      503,
    )
  }

  const codes = generateRecoveryCodes(CODES_PER_BATCH)
  const hashes = await Promise.all(codes.map(code => hashCode(code, secret)))

  const { data, error } = await admin.rpc('replace_recovery_codes', {
    p_user_id: auth.user.id,
    p_hashes: hashes,
  })

  if (error) return json({ error: 'Не удалось сохранить коды. Попробуйте ещё раз.' }, 500)

  const saved = typeof data === 'number' ? data : hashes.length

  // Открытые коды покидают сервер ровно один раз — в этом ответе
  return json({ codes, saved })
}

async function handleStatus(request: Request): Promise<Response> {
  const auth = await requireUser(request)
  if (!auth) return json({ error: 'Требуется вход в аккаунт' }, 401)

  const admin = createAdminClient()
  const secret = env('RECOVERY_CODE_SECRET')
  if (!admin || !secret) return json({ active: 0, configured: false })

  const { data, error } = await admin.rpc('count_active_recovery_codes', {
    p_user_id: auth.user.id,
  })

  if (error) return json({ error: 'Не удалось получить состояние кодов' }, 500)

  return json({ active: typeof data === 'number' ? data : 0, configured: true })
}

async function handleRedeem(request: Request): Promise<Response> {
  const admin = createAdminClient()
  const secret = env('RECOVERY_CODE_SECRET')
  if (!admin || !secret) {
    return json({ error: 'Восстановление по резервному коду временно недоступно' }, 503)
  }

  let username = ''
  let rawCode = ''
  let newPassword = ''

  try {
    const body: unknown = await request.json()
    if (body && typeof body === 'object') {
      const b = body as Record<string, unknown>
      if (typeof b.username === 'string') username = b.username.trim()
      if (typeof b.code === 'string') rawCode = b.code
      if (typeof b.newPassword === 'string') newPassword = b.newPassword
    }
  } catch {
    return json({ error: 'Некорректный запрос' }, 400)
  }

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return json(
      { error: `Пароль должен быть не короче ${MIN_PASSWORD_LENGTH} символов` },
      400,
    )
  }

  const ip = clientIp(request)
  // Без доверенного IP пишем одноразовый хеш: NOT NULL соблюдён,
  // но попытки не складываются в общий заблокированный bucket
  const ipHash = ip
    ? await hmacHex(ip, secret)
    : await hmacHex(`no-ip:${crypto.randomUUID()}`, secret)

  const usernameHash = await hmacHex(username.toLowerCase(), secret)

  const { data: failuresData } = await admin.rpc('recovery_failures', {
    p_ip_hash: ipHash,
    p_username_hash: usernameHash,
    p_window_minutes: WINDOW_MINUTES,
  })

  const failures = (failuresData as FailuresRow[] | null) ?? []
  const row = failures[0]

  if ((row?.user_failures ?? 0) >= MAX_USER_FAILURES) {
    await admin.rpc('log_recovery_attempt', {
      p_ip_hash: ipHash,
      p_username_hash: usernameHash,
      p_success: false,
    })

    return json(
      { error: `Слишком много попыток. Попробуйте через ${WINDOW_MINUTES} минут.` },
      429,
    )
  }

  const normalized = normalizeCode(rawCode)

  if (!normalized || username.length < 3 || username.length > 40) {
    await admin.rpc('log_recovery_attempt', {
      p_ip_hash: ipHash,
      p_username_hash: usernameHash,
      p_success: false,
    })

    await new Promise(resolve => setTimeout(resolve, FAILURE_DELAY_MS))
    return json({ error: GENERIC_ERROR }, 400)
  }

  const { data: profile } = await admin
    .from('profiles')
    .select('id')
    .eq('username', username)
    .maybeSingle()

  const userId = profile?.id as string | undefined
  let consumed = false

  if (userId) {
    const { data: consumedData, error: consumeError } = await admin.rpc(
      'consume_recovery_code',
      {
        p_user_id: userId,
        p_code_hash: hashCode(normalized, secret),
        p_ip_hash: ipHash,
      },
    )

    consumed = !consumeError && (await consumedData) === true
  }

  await admin.rpc('log_recovery_attempt', {
    p_ip_hash: ipHash,
    p_username_hash: usernameHash,
    p_success: consumed,
  })

  if (!consumed || !userId) {
    await new Promise(resolve => setTimeout(resolve, FAILURE_DELAY_MS))
    return json({ error: GENERIC_ERROR }, 400)
  }

  // Код уже погашен: даже при сбое смены пароля повторно он не сработает
  const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
    password: newPassword,
  })

  if (updateError) {
    return json(
      {
        error:
          'Код принят, но сменить пароль не удалось. ' +
          'Используйте другой резервный код или обратитесь к администрации.',
      },
      500,
    )
  }

  await admin.rpc('revoke_user_sessions', { p_user_id: userId })

  return json({ ok: true })
}

export async function handle(request: Request): Promise<Response> {
  if (!publishableKey()) {
    return json({ error: 'Сервис восстановления не настроен' }, 503)
  }

  const url = new URL(request.url)
  const op = url.searchParams.get('op') ?? ''

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: NO_STORE })
  }

  if (request.method !== 'POST' && op !== 'status') {
    return json({ error: 'Method not allowed' }, 405)
  }

  switch (op) {
    case 'generate':
      return handleGenerate(request)
    case 'status':
      return handleStatus(request)
    case 'redeem':
      return handleRedeem(request)
    default:
      return json({ error: 'Unknown operation' }, 400)
  }
}

// Обработчик запускается только при прямом запуске функции,
// что позволяет импортировать handle в тестах.
if (import.meta.main) {
  Deno.serve(handle)
}
