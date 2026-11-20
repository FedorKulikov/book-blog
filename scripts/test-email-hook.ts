// scripts/test-email-hook.ts
//
// Проверка Supabase Send Email Hook: подпись Standard Webhooks, подавление
// recovery, отсутствие фиктивного успеха и неизменность регистрации/входа.
//
// Запускается против поднятого сервера. Секрет хука передаётся через
// AUTH_EMAIL_HOOK_SECRET — тот же, с которым стартовал сервер.
import { createHmac } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const BASE = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:3000'

// Цель переключается переменной окружения, сценарии не меняются:
//   EDGE_FUNCTIONS_URL=https://<ref>.supabase.co/functions/v1
const EDGE_FUNCTIONS_URL = process.env.EDGE_FUNCTIONS_URL ?? ''
const HOOK_URL = EDGE_FUNCTIONS_URL
  ? `${EDGE_FUNCTIONS_URL}/auth-email-hook`
  : `${BASE}/api/auth/email-hook`
const SECRET = process.env.AUTH_EMAIL_HOOK_SECRET ?? ''
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
// Новый секретный ключ Supabase (sb_secret_*). Legacy service_role
// в тестовых сценариях не используется.
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY ?? ''

for (const [name, value] of Object.entries({
  AUTH_EMAIL_HOOK_SECRET: SECRET,
  NEXT_PUBLIC_SUPABASE_URL: SUPA_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON,
  SUPABASE_SECRET_KEY: SECRET_KEY,
})) {
  if (!value) {
    console.error(`нет переменной ${name}`)
    process.exit(1)
  }
}

/**
 * Новый секретный ключ (sb_secret_*) не является JWT: убираем его из
 * Authorization, чтобы ключ уходил только в apikey.
 */
function apikeyOnlyFetch(key: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers)
    if (headers.get('authorization') === `Bearer ${key}`) {
      headers.delete('authorization')
    }
    return fetch(input, { ...init, headers })
  }
}

const admin = createClient(SUPA_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: apikeyOnlyFetch(SECRET_KEY) },
})

let failures = 0
let checks = 0

function check(name: string, ok: boolean, extra = '') {
  checks++
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${extra ? ` :: ${extra}` : ''}`)
}

/** Подпись по спецификации Standard Webhooks */
function sign(id: string, timestamp: number, raw: string): string {
  const withoutVersion = SECRET.startsWith('v1,') ? SECRET.slice(3) : SECRET
  const base64Key = withoutVersion.startsWith('whsec_')
    ? withoutVersion.slice(6)
    : withoutVersion

  const key = Buffer.from(base64Key, 'base64')
  return createHmac('sha256', key)
    .update(`${id}.${timestamp}.${raw}`)
    .digest('base64')
}

type HookResult = { status: number; body: { ok?: boolean; error?: string } }

async function postHook(
  payload: unknown,
  opts: {
    id?: string
    timestamp?: number
    signature?: string | null
    skipHeaders?: boolean
  } = {},
): Promise<HookResult> {
  const raw = JSON.stringify(payload)
  const id = opts.id ?? `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`
  const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000)

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (!opts.skipHeaders) {
    headers['webhook-id'] = id
    headers['webhook-timestamp'] = String(timestamp)
    headers['webhook-signature'] =
      opts.signature === undefined ? `v1,${sign(id, timestamp, raw)}` : (opts.signature ?? '')
  }

  const res = await fetch(HOOK_URL, {
    method: 'POST',
    headers,
    body: raw,
  })

  const body = (await res.json().catch(() => ({}))) as HookResult['body']
  return { status: res.status, body }
}

function recoveryPayload(withUser: boolean) {
  return {
    user: withUser ? { id: '00000000-0000-0000-0000-000000000001' } : null,
    email_data: {
      email_action_type: 'recovery',
      site_url: 'https://bukleb.ru',
      token: 'token-not-real',
      token_hash: 'hash-not-real',
      redirect_to: 'https://bukleb.ru/auth/reset',
    },
  }
}

function payloadFor(action: string) {
  return { user: { id: '00000000-0000-0000-0000-000000000002' }, email_data: { email_action_type: action } }
}

async function main() {
  // ---------------------------------------------------------------- //
  // 1–4. Подпись и recovery                                        //
  // ---------------------------------------------------------------- //
  const valid = await postHook(recoveryPayload(true))
  check('валидная подпись принимается', valid.status === 200, `статус ${valid.status}`)
  // Контракт Supabase: успех — пустой HTTP 200 без тела
  check(
    'recovery подавлен без выдачи токена',
    Object.keys(valid.body).length === 0 && !('token' in valid.body),
    `поля: ${Object.keys(valid.body).join(',') || 'нет'}`,
  )

  const badSig = await postHook(recoveryPayload(true), { signature: 'v1,AAAA' })
  check('невалидная подпись отклоняется', badSig.status === 401, `статус ${badSig.status}`)

  const noHeaders = await postHook(recoveryPayload(true), { skipHeaders: true })
  check('без заголовков подписи отклоняется', noHeaders.status === 401, `статус ${noHeaders.status}`)

  const staleTs = await postHook(recoveryPayload(true), {
    timestamp: Math.floor(Date.now() / 1000) - 600,
  })
  check('устаревшая метка времени отклоняется', staleTs.status === 401, `статус ${staleTs.status}`)

  // ---------------------------------------------------------------- //
  // 5. Ответы не различают наличие аккаунта                        //
  // ---------------------------------------------------------------- //
  const withUser = await postHook(recoveryPayload(true))
  const withoutUser = await postHook(recoveryPayload(false))
  check(
    'ответ для «с пользователем» и «без» одинаков',
    withUser.status === withoutUser.status &&
      JSON.stringify(withUser.body) === JSON.stringify(withoutUser.body),
    `${withUser.status}/${withoutUser.status}`,
  )

  // ---------------------------------------------------------------- //
  // 6. Прочие события                                              //
  // ---------------------------------------------------------------- //
  const signup = await postHook(payloadFor('signup'))
  check('signup подавлен без ошибки', signup.status === 200, `статус ${signup.status}`)

  const notification = await postHook(payloadFor('password_changed_notification'))
  check('уведомление подавлено', notification.status === 200, `статус ${notification.status}`)

  const magic = await postHook(payloadFor('magiclink'))
  check('неподключённая доставка даёт 501, а не ложный успех', magic.status === 501, `статус ${magic.status}`)

  const unknown = await postHook(payloadFor('something_new'))
  check('неизвестное событие — 501', unknown.status === 501, `статус ${unknown.status}`)

  const invalidJson = await fetch(`${BASE}/api/auth/email-hook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'webhook-id': 'msg_bad_json',
      'webhook-timestamp': String(Math.floor(Date.now() / 1000)),
      'webhook-signature': `v1,${sign('msg_bad_json', Math.floor(Date.now() / 1000), 'not-json')}`,
    },
    body: 'not-json',
  })
  check('битый JSON — 400', invalidJson.status === 400, `статус ${invalidJson.status}`)

  // ---------------------------------------------------------------- //
  // 7. Регистрация и вход не сломаны                               //
  // ---------------------------------------------------------------- //
  const email = `hook-probe-${Date.now()}@example.com`
  const password = 'ProbePass123!'
  let createdId: string | null = null

  try {
    const signupRes = await fetch(`${SUPA_URL}/auth/v1/signup`, {
      method: 'POST',
      headers: { apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    // Сырой ответ GoTrue кладёт сессию на верхний уровень (access_token),
    // а не в поле session — та обёртка есть только в supabase-js.
    const signupBody = (await signupRes.json().catch(() => ({}))) as {
      access_token?: string
      user?: { id?: string }
    }

    createdId = signupBody.user?.id ?? null
    const hasSession = Boolean(signupBody.access_token)

    check(
      'регистрация без подтверждения почты работает',
      signupRes.status === 200 && hasSession,
      `статус ${signupRes.status}, сессия ${hasSession}, поля: ${Object.keys(signupBody).join(',')}`,
    )

    const loginRes = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    check('вход после регистрации работает', loginRes.status === 200, `статус ${loginRes.status}`)
  } finally {
    if (createdId) {
      await admin.auth.admin.deleteUser(createdId).catch(() => undefined)
    }
  }

  console.log('')
  console.log(`Проверок: ${checks}, провалено: ${failures}`)
  process.exit(failures === 0 ? 0 : 2)
}

main().catch(error => {
  console.error('Тест упал:', error instanceof Error ? error.message : String(error))
  process.exit(1)
})
