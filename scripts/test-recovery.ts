// scripts/test-recovery.ts
//
// Интеграционные сценарии Recovery против Edge Function.
//
// Особенности:
//   • RECOVERY_CODE_SECRET НЕ нужен: коды выдаёт реальный generate
//     под сессией тестового пользователя;
//   • административные операции (создание/удаление тестовых аккаунтов)
//     идут через новый секретный ключ SUPABASE_SECRET_KEY (sb_secret_*);
//   • legacy service_role не используется;
//   • ключи, пароли, JWT и recovery-коды в вывод не попадают.
//
// Обязательные переменные:
//   SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SECRET_KEY,
//   EDGE_FUNCTIONS_URL
import { createClient } from '@supabase/supabase-js'

const SUPA_URL = process.env.SUPABASE_URL ?? ''
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY ?? ''
const EDGE = (process.env.EDGE_FUNCTIONS_URL ?? '').replace(/\/+$/, '')

for (const [name, value] of Object.entries({
  SUPABASE_URL: SUPA_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON,
  SUPABASE_SECRET_KEY: SECRET_KEY,
  EDGE_FUNCTIONS_URL: EDGE,
})) {
  if (!value) {
    console.error(`нет переменной ${name}`)
    process.exit(1)
  }
}

/**
 * Новый секретный ключ (sb_secret_*) не является JWT.
 * supabase-js исторически дублирует ключ в Authorization: Bearer <key>,
 * поэтому убираем его оттуда: ключ должен уходить только в apikey.
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

// Административный клиент на новом секретном ключе (только apikey)
const admin = createClient(SUPA_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: apikeyOnlyFetch(SECRET_KEY) },
})

// Публичный клиент для входа тестовых пользователей
const anon = createClient(SUPA_URL, ANON, {
  auth: { persistSession: false, autoRefreshToken: false },
})

let failures = 0
let checks = 0

function check(name: string, ok: boolean, extra = '') {
  checks++
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${extra ? ` :: ${extra}` : ''}`)
}

const stamp = Date.now().toString(36)

type TestUser = { id: string; email: string; username: string; password: string }
type ApiBody = { error?: string; ok?: boolean; codes?: string[] }
type ApiResult = { status: number; body: ApiBody }

function apiUrl(op: string): string {
  return `${EDGE}/recovery?op=${op}`
}

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

  const { data: profile } = await admin
    .from('profiles')
    .select('id')
    .eq('id', id)
    .maybeSingle()

  if (!profile) {
    const { error: insertError } = await admin.from('profiles').insert({ id, username })
    if (insertError) throw new Error(`profile(${prefix}): ${insertError.message}`)
  }

  return { id, email, username, password }
}

/** Сессия тестового пользователя. Токен не печатается. */
async function signIn(user: TestUser, password = user.password): Promise<string> {
  const { data, error } = await anon.auth.signInWithPassword({
    email: user.email,
    password,
  })

  if (error || !data.session) {
    throw new Error(`signIn: ${error?.message ?? 'нет сессии'}`)
  }

  return data.session.access_token
}

/** Выдача кодов через реальный Edge Function generate */
async function generateCodes(user: TestUser): Promise<string[]> {
  const token = await signIn(user)

  const res = await fetch(apiUrl('generate'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: ANON,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ password: user.password }),
  })

  const body = (await res.json().catch(() => ({}))) as ApiBody

  if (res.status !== 200 || !Array.isArray(body.codes)) {
    throw new Error(`generate: статус ${res.status}`)
  }

  return body.codes
}

async function redeem(payload: Record<string, unknown>): Promise<ApiResult> {
  const res = await fetch(apiUrl('redeem'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON },
    body: JSON.stringify(payload),
  })

  const body = (await res.json().catch(() => ({}))) as ApiBody
  return { status: res.status, body }
}

async function canSignIn(email: string, password: string): Promise<boolean> {
  const { error } = await anon.auth.signInWithPassword({ email, password })
  return !error
}

async function main() {
  const created: string[] = []

  try {
    // ---------------------------------------------------------------- //
    // 1. Выдача кодов через реальный generate                          //
    // ---------------------------------------------------------------- //
    const a = await createUser('rec_a')
    created.push(a.id)
    const b = await createUser('rec_b')
    created.push(b.id)

    const codesA = await generateCodes(a)
    check('выдано 10 кодов', codesA.length === 10, `получено ${codesA.length}`)
    check('все коды уникальны', new Set(codesA).size === codesA.length)
    check(
      'формат кода: 8 групп по 4',
      codesA.every(code => /^[0-9A-Z]{4}(-[0-9A-Z]{4}){7}$/.test(code)),
      `длина ${codesA[0]?.length ?? 0}`,
    )

    // ---------------------------------------------------------------- //
    // 2. Успешное восстановление                                       //
    // ---------------------------------------------------------------- //
    const newPassword = 'NewPass456!'
    const ok = await redeem({ username: a.username, code: codesA[0], newPassword })

    check('верный код → 200', ok.status === 200, `статус ${ok.status}`)
    check('новый пароль работает', await canSignIn(a.email, newPassword))
    check('старый пароль больше не работает', !(await canSignIn(a.email, a.password)))

    // ---------------------------------------------------------------- //
    // 3. Отказы                                                        //
    // ---------------------------------------------------------------- //
    const reuse = await redeem({ username: a.username, code: codesA[0], newPassword: 'Another789!' })
    check('повторное использование кода → отказ', reuse.status === 400, `статус ${reuse.status}`)

    const wrong = await redeem({
      username: a.username,
      code: '0000-0000-0000-0000-0000-0000-0000-0000',
      newPassword: 'Another789!',
    })
    check('неверный код → отказ', wrong.status === 400, `статус ${wrong.status}`)

    const codesB = await generateCodes(b)
    const foreign = await redeem({ username: a.username, code: codesB[0], newPassword: 'Another789!' })
    check('код другого пользователя → отказ', foreign.status === 400, `статус ${foreign.status}`)

    const noCode = await redeem({ username: a.username, code: '', newPassword: 'Another789!' })
    check('только имя без кода → отказ', noCode.status === 400, `статус ${noCode.status}`)

    check(
      'сообщения об ошибке одинаковые',
      reuse.body.error === wrong.body.error && wrong.body.error === foreign.body.error,
      String(reuse.body.error ?? ''),
    )

    // ---------------------------------------------------------------- //
    // 4. Перегенерация отменяет предыдущий набор                       //
    // ---------------------------------------------------------------- //
    await generateCodes({ ...a, password: newPassword })
    const stale = await redeem({ username: a.username, code: codesA[1], newPassword: 'Another789!' })
    check('код из старой партии → отказ', stale.status === 400, `статус ${stale.status}`)

    // ---------------------------------------------------------------- //
    // 5. Лимит попыток (отдельное имя, чтобы не портить A)             //
    // ---------------------------------------------------------------- //
    const throwaway = `ghost_${stamp}`
    let limited = 0
    for (let i = 0; i < 7; i++) {
      const attempt = await redeem({
        username: throwaway,
        code: '1111-1111-1111-1111-1111-1111-1111-1111',
        newPassword: 'Another789!',
      })
      limited = attempt.status
      if (attempt.status === 429) break
    }
    check('после серии ошибок — 429', limited === 429, `статус ${limited}`)

    // ---------------------------------------------------------------- //
    // 6. Гонка: два запроса с одним кодом                              //
    // ---------------------------------------------------------------- //
    const raceCodes = await generateCodes(b)
    const [r1, r2] = await Promise.all([
      redeem({ username: b.username, code: raceCodes[0], newPassword: 'Race11111!' }),
      redeem({ username: b.username, code: raceCodes[0], newPassword: 'Race22222!' }),
    ])
    const wins = [r1, r2].filter(result => result.status === 200).length
    check('параллельно один код → успешен ровно один', wins === 1, `успешных ${wins}`)

    // ---------------------------------------------------------------- //
    // 7. Данные пользователя не пострадали                             //
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
    for (const id of created) {
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
