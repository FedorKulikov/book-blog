// scripts/test-recovery.ts
//
// Сквозная проверка восстановления по резервным кодам.
// Запускается против уже поднятого сервера (next start) и настоящей базы.
//
// Проверяет не интерфейс, а фактическую смену пароля: после восстановления
// выполняется вход с новым паролем через Auth API.
//
// Требуемые переменные:
//   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
//   SUPABASE_SERVICE_ROLE_KEY, RECOVERY_CODE_SECRET
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import {
  generateRecoveryCodes,
  hashCode,
  normalizeCode,
} from '../lib/recovery'

const BASE = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:3000'
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const SECRET = process.env.RECOVERY_CODE_SECRET ?? ''

for (const [name, value] of Object.entries({
  NEXT_PUBLIC_SUPABASE_URL: SUPA_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE,
  RECOVERY_CODE_SECRET: SECRET,
})) {
  if (!value) {
    console.error(`нет переменной ${name}`)
    process.exit(1)
  }
}

const admin = createClient(SUPA_URL, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const anon = createClient(SUPA_URL, ANON, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const createdUserIds: string[] = []

let failures = 0
let checks = 0

function check(name: string, ok: boolean, extra = '') {
  checks++
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${extra ? ` :: ${extra}` : ''}`)
}

const stamp = Date.now().toString(36)

type TestUser = { id: string; email: string; username: string; password: string }

async function createUser(prefix: string): Promise<TestUser> {
  const email = `${prefix}-${stamp}@example.com`
  const username = `${prefix}_${stamp}`
  const password = 'OldPass123!'

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username },
  })

  if (error) throw new Error(`createUser(${prefix}): ${error.message}`)

  const id = data.user?.id
  if (!id) throw new Error(`createUser(${prefix}): нет id`)
  // Track immediately so a profile-fixture error cannot leak this user.
  createdUserIds.push(id)

  // Профиль должен создать триггер на auth.users; если нет — создаём сами,
  // чтобы проверять именно восстановление, а не регистрацию.
  const { data: profile } = await admin
    .from('profiles')
    .select('id')
    .eq('id', id)
    .maybeSingle()

  if (!profile) {
    const { error: insertError } = await admin
      .from('profiles')
      .insert({ id, username })
    if (insertError) throw new Error(`profile(${prefix}): ${insertError.message}`)
  }

  return { id, email, username, password }
}

async function authenticatedSession(user: TestUser) {
  const jar = new Map<string, string>()
  const client = createServerClient(SUPA_URL, ANON, {
    cookies: {
      getAll: () => Array.from(jar, ([name, value]) => ({ name, value })),
      setAll: values => {
        for (const item of values) jar.set(item.name, item.value)
      },
    },
  })

  const { data, error } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  })
  if (error || !data.session) {
    throw new Error(`could not create SSR session for temporary user (${error?.status ?? 'unknown'})`)
  }

  async function request(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers)
    if (jar.size > 0) {
      headers.set('cookie', Array.from(jar, ([name, value]) => `${name}=${value}`).join('; '))
    }
    const response = await fetch(`${BASE}${path}`, { ...init, headers })
    const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie
    for (const value of getSetCookie?.call(response.headers) ?? []) {
      const pair = value.split(';', 1)[0]
      const separator = pair.indexOf('=')
      if (separator > 0) jar.set(pair.slice(0, separator), pair.slice(separator + 1))
    }
    return response
  }

  return { request }
}

async function issueCodes(userId: string, count = 10): Promise<string[]> {
  const codes = generateRecoveryCodes(count)
  const hashes = codes.map(code => hashCode(normalizeCode(code)!, SECRET))

  const { error } = await admin.rpc('replace_recovery_codes', {
    p_user_id: userId,
    p_hashes: hashes,
  })

  if (error) throw new Error(`replace_recovery_codes: ${error.message}`)
  return codes
}

type RecoverResult = { status: number; body: { error?: string; ok?: boolean } }

async function recover(
  payload: Record<string, unknown>,
  ip = '203.0.113.10',
): Promise<RecoverResult> {
  const res = await fetch(`${BASE}/api/recovery/redeem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(payload),
  })

  const body = (await res.json().catch(() => ({}))) as RecoverResult['body']
  return { status: res.status, body }
}

async function canSignIn(email: string, password: string): Promise<boolean> {
  const { error } = await anon.auth.signInWithPassword({ email, password })
  return !error
}

async function main() {
  try {
    const a = await createUser('rec_a')
    const b = await createUser('rec_b')
    const session = await authenticatedSession(a)

    const unauthStatus = await fetch(`${BASE}/api/recovery/status`, { cache: 'no-store' })
    check('status without a session → 401', unauthStatus.status === 401, `status ${unauthStatus.status}`)
    const unauthGenerate = await fetch(`${BASE}/api/recovery/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: a.password }),
    })
    check('generation without a session → 401', unauthGenerate.status === 401, `status ${unauthGenerate.status}`)
    // ---------------------------------------------------------------- //
    // 1. Генерация                                                   //
    // ---------------------------------------------------------------- //
    const codesA = await issueCodes(a.id)
    const codesB = await issueCodes(b.id)

    const statusBefore = await session.request('/api/recovery/status', { cache: 'no-store' })
    const statusBeforeBody = await statusBefore.json().catch(() => ({})) as { active?: number; configured?: boolean }
    check(
      'authenticated status reports the owner’s active codes',
      statusBefore.status === 200 && statusBeforeBody.configured === true && statusBeforeBody.active === 10,
      `status ${statusBefore.status}, active ${statusBeforeBody.active ?? 'unknown'}`,
    )
    check('status endpoint sets no-store', statusBefore.headers.get('cache-control')?.includes('no-store') === true)

    const wrongPasswordResponse = await session.request('/api/recovery/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'WrongPassword123!' }),
    })
    check('generation requires the current password', wrongPasswordResponse.status === 403, `status ${wrongPasswordResponse.status}`)

    const stillTen = await session.request('/api/recovery/status', { cache: 'no-store' })
    const stillTenBody = await stillTen.json().catch(() => ({})) as { active?: number }
    check('wrong password does not replace existing recovery codes', stillTen.status === 200 && stillTenBody.active === 10)

    const generateResponse = await session.request('/api/recovery/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: a.password }),
    })
    const generated = await generateResponse.json().catch(() => ({})) as { codes?: string[]; saved?: number }
    const codesGenerated = generated.codes ?? []
    check(
      'authenticated user can generate codes through the profile API',
      generateResponse.status === 200 && codesGenerated.length === 10 && generated.saved === 10,
      `status ${generateResponse.status}, count ${codesGenerated.length}`,
    )
    check('generated codes are unique', new Set(codesGenerated).size === 10)
    check('generated code format: 8 groups of 4', codesGenerated.every(c => /^[0-9A-Z]{4}(-[0-9A-Z]{4}){7}$/.test(c)))
    check('generation response sets no-store', generateResponse.headers.get('cache-control')?.includes('no-store') === true)

    const statusAfter = await session.request('/api/recovery/status', { cache: 'no-store' })
    const statusAfterBody = await statusAfter.json().catch(() => ({})) as { active?: number; configured?: boolean }
    check('status reflects newly generated code batch', statusAfter.status === 200 && statusAfterBody.configured === true && statusAfterBody.active === 10)

    // ---------------------------------------------------------------- //
    // 2. Successful recovery through the actual unauthenticated API  //
    // ---------------------------------------------------------------- //
    const newPassword = 'NewPass456!'
    const staleAfterReissue = await recover({
      username: a.username,
      code: codesA[0],
      newPassword,
    })
    check('old batch codes stop working after regeneration', staleAfterReissue.status === 400, `status ${staleAfterReissue.status}`)

    const shortPassword = await recover({
      username: a.username,
      code: codesGenerated[0] ?? '',
      newPassword: 'short77',
    })
    check('password shorter than eight characters is rejected', shortPassword.status === 400, `status ${shortPassword.status}`)

    const ok = await recover({
      username: a.username,
      code: codesGenerated[0] ?? '',
      newPassword,
    })

    check('верный код → 200', ok.status === 200, `статус ${ok.status}`)
    check('новый пароль работает', await canSignIn(a.email, newPassword))
    check('старый пароль больше не работает', !(await canSignIn(a.email, a.password)))

    // ---------------------------------------------------------------- //
    // 3. Отказы                                                      //
    // ---------------------------------------------------------------- //
    const reuse = await recover({
      username: a.username,
      code: codesGenerated[0] ?? '',
      newPassword: 'Another789!',
    })
    check('повторное использование кода → отказ', reuse.status === 400, `статус ${reuse.status}`)

    const wrong = await recover({
      username: a.username,
      code: '0000-0000-0000-0000-0000-0000-0000-0000',
      newPassword: 'Another789!',
    })
    check('неверный код → отказ', wrong.status === 400, `статус ${wrong.status}`)

    const foreign = await recover({
      username: a.username,
      code: codesB[0],
      newPassword: 'Another789!',
    })
    check('код другого пользователя → отказ', foreign.status === 400, `статус ${foreign.status}`)

    const noCode = await recover({
      username: a.username,
      code: '',
      newPassword: 'Another789!',
    })
    check('только имя без кода → отказ', noCode.status === 400, `статус ${noCode.status}`)

    check(
      'сообщения об ошибке одинаковые',
      reuse.body.error === wrong.body.error &&
        wrong.body.error === foreign.body.error,
      String(reuse.body.error ?? ''),
    )

    // ---------------------------------------------------------------- //
    // 5. Лимит попыток                                               //
    // ---------------------------------------------------------------- //
    const limited = await recover({
      username: a.username,
      code: '1111-1111-1111-1111-1111-1111-1111-1111',
      newPassword: 'Another789!',
    })
    check('после серии ошибок — 429', limited.status === 429, `статус ${limited.status}`)

    // ---------------------------------------------------------------- //
    // 6. Гонка: два запроса с одним кодом                            //
    // ---------------------------------------------------------------- //
    const [r1, r2] = await Promise.all([
      recover({ username: b.username, code: codesB[0], newPassword: 'Race11111!' }, '203.0.113.77'),
      recover({ username: b.username, code: codesB[0], newPassword: 'Race22222!' }, '203.0.113.78'),
    ])
    const wins = [r1, r2].filter(r => r.status === 200).length
    check('параллельно один код → успешен ровно один', wins === 1, `успешных ${wins}`)

    // ---------------------------------------------------------------- //
    // 7. Данные пользователя не пострадали                           //
    // ---------------------------------------------------------------- //
    const { data: profileAfter } = await admin
      .from('profiles')
      .select('id, username')
      .eq('id', a.id)
      .maybeSingle()

    check(
      'профиль не изменился (id и имя те же)',
      profileAfter?.id === a.id && profileAfter?.username === a.username,
    )

    const { count: postCount } = await admin
      .from('posts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', a.id)

    check('посты пользователя не тронуты', (postCount ?? 0) === 0, `постов ${postCount ?? 0}`)
  } finally {
    // Чистим тестовых пользователей; коды уходят каскадом (ON DELETE CASCADE)
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id).catch(() => undefined)
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
