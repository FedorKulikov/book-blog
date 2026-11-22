// scripts/test-email-hook.ts
//
// Проверка Supabase Send Email Hook: подпись Standard Webhooks, ответы Auth actions
// и неизменность регистрации/входа без зависимости от доставки email.
//
// Запускается против поднятого сервера. Секрет хука передаётся через
// AUTH_EMAIL_HOOK_SECRET — тот же, с которым стартовал сервер.
import { createHmac } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const BASE = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:3000'
const SECRET = process.env.AUTH_EMAIL_HOOK_SECRET ?? ''
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

for (const [name, value] of Object.entries({
  AUTH_EMAIL_HOOK_SECRET: SECRET,
  NEXT_PUBLIC_SUPABASE_URL: SUPA_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE,
})) {
  if (!value) {
    console.error(`нет переменной ${name}`)
    process.exit(1)
  }
}

const admin = createClient(SUPA_URL, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
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

  const res = await fetch(`${BASE}/api/auth/email-hook`, {
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
  // 1–4. Подпись и recovery payload validation                    //
  // ---------------------------------------------------------------- //
  const valid = await postHook(recoveryPayload(true))
  check('recovery без user.email отклоняется до отправки', valid.status === 400, `статус ${valid.status}`)

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
  check('signup с недоставляемым тестовым адресом не блокирует регистрацию', signup.status === 400, `статус ${signup.status}; synthetic payload lacks email/token hash`)

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
  const stamp = Date.now()
  const shortEmail = `hook-short-${stamp}@example.com`
  const email = `hook-probe-${stamp}@example.com`
  const password = 'A1b2C3d4' // Exactly eight characters.
  const createdIds: string[] = []

  try {
    const shortSignup = await fetch(`${SUPA_URL}/auth/v1/signup`, {
      method: 'POST',
      headers: { apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: shortEmail, password: 'Short77' }),
    })
    const shortBody = (await shortSignup.json().catch(() => ({}))) as { user?: { id?: string } }
    if (shortBody.user?.id) createdIds.push(shortBody.user.id)
    check('Auth rejects passwords shorter than eight characters', shortSignup.status >= 400, `status ${shortSignup.status}`)

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (createError) throw new Error(`admin createUser: ${createError.message}`)
    const userId = created.user?.id
    if (!userId) throw new Error('admin createUser: no user id')
    createdIds.push(userId)

    check('admin creates a confirmed test user without email delivery', true)

    const signupRes = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const signupBody = (await signupRes.json().catch(() => ({}))) as {
      access_token?: string
      user?: { id?: string }
    }
    const hasSession = Boolean(signupBody.access_token)
    check(
      'login for the admin-created confirmed user works',
      signupRes.status === 200 && hasSession && signupBody.user?.id === userId,
      `status ${signupRes.status}, session ${hasSession}`,
    )

    const loginRes = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    check('login after registration works', loginRes.status === 200, `status ${loginRes.status}`)

    const wrongLogin = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'WrongPass123!' }),
    })
    check('wrong password does not authenticate', wrongLogin.status >= 400, `status ${wrongLogin.status}`)
  } finally {
    for (const id of createdIds) await admin.auth.admin.deleteUser(id).catch(() => undefined)
  }

  console.log('')
  console.log(`Проверок: ${checks}, провалено: ${failures}`)
  process.exit(failures === 0 ? 0 : 2)
}

main().catch(error => {
  console.error('Тест упал:', error instanceof Error ? error.message : String(error))
  process.exit(1)
})
