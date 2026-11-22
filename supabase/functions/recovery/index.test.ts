// supabase/functions/recovery/index.test.ts
//
// Тесты HTTP-обработчика recovery. Сеть замокана: ни GoTrue, ни PostgREST
// не вызываются. Проверяется собственная логика функции — аутентификация,
// выбор операции, работа с системными ключами и отсутствие утечек.
import { handle } from './index.ts'

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`)
  }
}

const SUPABASE = 'https://test.supabase.co'

type Captured = { url: string; method: string; body: string | null }

let calls: Captured[] = []

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function installFetchMock(
  rpc: { status: number; body: unknown } = { status: 200, body: 10 },
): void {
  calls = []

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = init?.method ?? 'GET'
    const body = init?.body ? String(init.body) : null
    calls.push({ url, method, body })

    if (url.includes('/auth/v1/user')) {
      return jsonResponse({ id: 'real-user-uuid', email: 'real@example.com' })
    }

    if (url.includes('/auth/v1/token')) {
      return jsonResponse({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_in: 3600,
        token_type: 'bearer',
        user: { id: 'real-user-uuid', email: 'real@example.com' },
      })
    }

    if (url.includes('/rest/v1/rpc/')) {
      return jsonResponse(rpc.body, rpc.status)
    }

    return jsonResponse({ message: 'unexpected call' }, 404)
  }) as typeof fetch
}

function setEnv(): void {
  Deno.env.set('SUPABASE_URL', SUPABASE)
  Deno.env.set('SUPABASE_SECRET_KEYS', JSON.stringify({ default: 'sb_secret_test' }))
  Deno.env.set('SUPABASE_PUBLISHABLE_KEYS', JSON.stringify({ default: 'sb_publishable_test' }))
  Deno.env.set('RECOVERY_CODE_SECRET', 'test-recovery-secret-32-chars-minimum')
}

function clearEnv(): void {
  for (const name of [
    'SUPABASE_URL',
    'SUPABASE_SECRET_KEYS',
    'SUPABASE_PUBLISHABLE_KEYS',
    'RECOVERY_CODE_SECRET',
  ]) {
    Deno.env.delete(name)
  }
}

function request(op: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers)
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')

  return new Request(`${SUPABASE}/functions/v1/recovery?op=${op}`, {
    method: 'POST',
    ...init,
    headers,
  })
}

function bearer(token = 'user-jwt'): Headers {
  return new Headers({ Authorization: `Bearer ${token}` })
}

Deno.test('generate без JWT → 401', async () => {
  setEnv()
  installFetchMock()
  try {
    const res = await handle(request('generate'))
    assertEqual(res.status, 401, 'статус')
  } finally {
    clearEnv()
  }
})

Deno.test('status без JWT → 401', async () => {
  setEnv()
  installFetchMock()
  try {
    const res = await handle(
      new Request(`${SUPABASE}/functions/v1/recovery?op=status`, { method: 'GET' }),
    )
    assertEqual(res.status, 401, 'статус')
  } finally {
    clearEnv()
  }
})

Deno.test('generate: UID берётся из JWT, а не из тела', async () => {
  setEnv()
  installFetchMock({ status: 200, body: 10 })

  try {
    const res = await handle(
      request('generate', {
        headers: bearer(),
        body: JSON.stringify({ password: 'pw', user_id: 'attacker-uuid' }),
      }),
    )

    assertEqual(res.status, 200, 'статус')

    const rpcCall = calls.find(call => call.url.includes('/rest/v1/rpc/replace_recovery_codes'))
    assert(Boolean(rpcCall), 'вызов replace_recovery_codes не найден')

    const rpcBody = JSON.parse(rpcCall!.body!)
    assertEqual(rpcBody.p_user_id, 'real-user-uuid', 'пользователь из JWT')
    assert(!JSON.stringify(rpcBody).includes('attacker-uuid'), 'UID из тела проигнорирован')
  } finally {
    clearEnv()
  }
})

Deno.test('generate без RECOVERY_CODE_SECRET → 503 (fail closed)', async () => {
  setEnv()
  Deno.env.delete('RECOVERY_CODE_SECRET')
  installFetchMock()

  try {
    const res = await handle(
      request('generate', { headers: bearer(), body: JSON.stringify({ password: 'pw' }) }),
    )
    assertEqual(res.status, 503, 'статус')
  } finally {
    clearEnv()
  }
})

Deno.test('redeem без пользовательской сессии допускается', async () => {
  setEnv()
  installFetchMock({ status: 200, body: 1 })

  try {
    const res = await handle(
      request('redeem', {
        body: JSON.stringify({ username: 'someone', code: 'AAAA', newPassword: 'short' }),
      }),
    )

    // Без JWT, но запрос дошёл до валидации: 400 — не 401
    assertEqual(res.status, 400, 'статус')
  } finally {
    clearEnv()
  }
})

Deno.test('redeem без RECOVERY_CODE_SECRET → 503', async () => {
  setEnv()
  Deno.env.delete('RECOVERY_CODE_SECRET')
  installFetchMock()

  try {
    const res = await handle(
      request('redeem', {
        body: JSON.stringify({ username: 'someone', code: 'AAAA', newPassword: 'Password123' }),
      }),
    )
    assertEqual(res.status, 503, 'статус')
  } finally {
    clearEnv()
  }
})

Deno.test('неизвестная операция → 400', async () => {
  setEnv()
  installFetchMock()

  try {
    const res = await handle(request('nope'))
    assertEqual(res.status, 400, 'статус')
  } finally {
    clearEnv()
  }
})

Deno.test('неверный HTTP-метод для generate → 405', async () => {
  setEnv()
  installFetchMock()

  try {
    const res = await handle(
      new Request(`${SUPABASE}/functions/v1/recovery?op=generate`, { method: 'GET' }),
    )
    assertEqual(res.status, 405, 'статус')
  } finally {
    clearEnv()
  }
})

Deno.test('ошибка RPC не раскрывает внутренние детали', async () => {
  setEnv()
  installFetchMock({
    status: 500,
    body: { message: 'relation private.recovery_codes does not exist', code: '42P01' },
  })

  try {
    const res = await handle(
      request('generate', { headers: bearer(), body: JSON.stringify({ password: 'pw' }) }),
    )

    assertEqual(res.status, 500, 'статус')
    const text = await res.text()

    assert(!text.includes('private.recovery_codes'), 'утечка имени таблицы')
    assert(!text.includes('42P01'), 'утечка кода ошибки Postgres')
    assert(text.includes('Не удалось сохранить коды'), 'нейтральное сообщение')
  } finally {
    clearEnv()
  }
})

Deno.test('без publishable key → 503, личность не подтверждается', async () => {
  setEnv()
  Deno.env.delete('SUPABASE_PUBLISHABLE_KEYS')
  installFetchMock()

  try {
    const res = await handle(
      request('generate', { headers: bearer(), body: JSON.stringify({ password: 'pw' }) }),
    )
    assertEqual(res.status, 503, 'статус')
  } finally {
    clearEnv()
  }
})
