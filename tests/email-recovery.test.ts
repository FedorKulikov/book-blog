import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildEmailVerificationUrl,
  emailRecoveryHmac,
  escapeEmailHtml,
  generateEmailRecoveryToken,
  getAuthEmailSiteUrl,
  getEdgeMailerConfig,
  hashEmailForRecovery,
  isEmailRecoveryConfigured,
  isValidEmailRecoveryToken,
  sendEmailViaEdgeMailer,
} from '../lib/email-recovery'

const SECRET = 'a'.repeat(64)

test('email hashes are normalized and keyed', () => {
  assert.equal(
    hashEmailForRecovery('  Reader@Example.com ', SECRET),
    hashEmailForRecovery('reader@example.com', SECRET),
  )
  assert.notEqual(
    hashEmailForRecovery('reader@example.com', SECRET),
    hashEmailForRecovery('other@example.com', SECRET),
  )
  assert.notEqual(
    hashEmailForRecovery('reader@example.com', SECRET),
    hashEmailForRecovery('reader@example.com', 'b'.repeat(64)),
  )
})

test('verification tokens contain 256 random bits and only valid URL-safe characters', () => {
  const first = generateEmailRecoveryToken(SECRET)
  const second = generateEmailRecoveryToken(SECRET)

  assert.match(first.token, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(isValidEmailRecoveryToken(first.token), true)
  assert.equal(isValidEmailRecoveryToken('short'), false)
  assert.notEqual(first.token, second.token)
  assert.equal(first.tokenHash, emailRecoveryHmac(first.token, SECRET))
  assert.match(first.tokenHash, /^[0-9a-f]{64}$/)
})

test('email verification URL contains only the single-use token', () => {
  const url = new URL(buildEmailVerificationUrl('https://bukleb.ru', 'abc_123'))
  assert.equal(url.origin, 'https://bukleb.ru')
  assert.equal(url.pathname, '/email-recovery/confirm')
  assert.equal(url.searchParams.get('token'), 'abc_123')
  assert.equal(url.searchParams.has('next'), false)
})

test('email HTML escapes untrusted values', () => {
  assert.equal(
    escapeEmailHtml('<script a="b">&\''),
    '&lt;script a=&quot;b&quot;&gt;&amp;&#39;',
  )
})

test('production email verification links are pinned to bukleb.ru', () => {
  const previous = process.env.AUTH_EMAIL_SITE_URL
  try {
    process.env.AUTH_EMAIL_SITE_URL = 'https://bukleb.ru'
    assert.equal(getAuthEmailSiteUrl(), 'https://bukleb.ru')

    process.env.AUTH_EMAIL_SITE_URL = 'https://attacker.example'
    assert.throws(() => getAuthEmailSiteUrl(), /verified production domain/)

    process.env.AUTH_EMAIL_SITE_URL = 'http://bukleb.ru'
    assert.throws(() => getAuthEmailSiteUrl(), /HTTPS/)
  } finally {
    if (previous === undefined) delete process.env.AUTH_EMAIL_SITE_URL
    else process.env.AUTH_EMAIL_SITE_URL = previous
  }
})

test('email verification stays disabled unless all server prerequisites are present', () => {
  const keys = [
    'NEXT_PUBLIC_ENABLE_EMAIL_RECOVERY',
    'EMAIL_RECOVERY_SECRET',
    'SUPABASE_SECRET_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  ] as const
  const previous = new Map(keys.map(key => [key, process.env[key]]))

  try {
    for (const key of keys) process.env[key] = 'configured-test-value'
    process.env.NEXT_PUBLIC_ENABLE_EMAIL_RECOVERY = 'true'
    process.env.EMAIL_RECOVERY_SECRET = 'a'.repeat(64)
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co'
    assert.equal(isEmailRecoveryConfigured(), true)

    delete process.env.SUPABASE_SECRET_KEY
    assert.equal(isEmailRecoveryConfigured(), false)
  } finally {
    for (const key of keys) {
      const value = previous.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

test('Edge mailer config is server-side and restricted to the project URL', () => {
  const keys = [
    'SUPABASE_SECRET_KEY',
    'NEXT_PUBLIC_SUPABASE_URL',
  ] as const
  const previous = new Map(keys.map(key => [key, process.env[key]]))

  try {
    process.env.SUPABASE_SECRET_KEY = 'sb_secret_test'
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co'
    assert.deepEqual(getEdgeMailerConfig(), {
      supabaseUrl: 'https://project.supabase.co',
      secretKey: 'sb_secret_test',
    })

    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://attacker.example'
    assert.equal(getEdgeMailerConfig(), null)
  } finally {
    for (const key of keys) {
      const value = previous.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

test('verification email is sent through the protected Supabase Edge Function', async () => {
  let capturedUrl = ''
  let capturedHeaders: HeadersInit | undefined
  let capturedBody: Record<string, unknown> | undefined
  let hasTimeout = false

  const fakeFetch: typeof fetch = async (input, init) => {
    capturedUrl = String(input)
    capturedHeaders = init?.headers
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    hasTimeout = init?.signal instanceof AbortSignal
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  await sendEmailViaEdgeMailer(
    {
      to: 'reader@example.com',
      subject: 'Verify',
      html: '<p>Verify</p>',
      text: 'Verify',
      idempotencyKey: 'email-recovery-verify/user-1/abc123',
    },
    {
      supabaseUrl: 'https://project.supabase.co',
      secretKey: 'sb_secret_test',
    },
    fakeFetch,
  )

  assert.equal(
    capturedUrl,
    'https://project.supabase.co/functions/v1/resend-mailer',
  )
  const headers = new Headers(capturedHeaders)
  assert.equal(headers.get('Authorization'), null)
  assert.equal(headers.get('apikey'), 'sb_secret_test')
  assert.deepEqual(capturedBody, {
    to: 'reader@example.com',
    subject: 'Verify',
    html: '<p>Verify</p>',
    text: 'Verify',
    idempotencyKey: 'email-recovery-verify/user-1/abc123',
  })
  assert.equal(hasTimeout, true)
})

test('Edge mailer errors never expose response bodies', async () => {
  const fakeFetch: typeof fetch = async () => new Response(
    JSON.stringify({ message: 'recipient private data and token' }),
    { status: 502 },
  )

  await assert.rejects(
    sendEmailViaEdgeMailer(
      {
        to: 'reader@example.com',
        subject: 'Verify',
        html: '<p>Verify</p>',
        text: 'Verify',
        idempotencyKey: 'email-recovery-verify/user-1/failure',
      },
      {
        supabaseUrl: 'https://project.supabase.co',
        secretKey: 'sb_secret_test',
      },
      fakeFetch,
    ),
    error => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /HTTP 502/)
      assert.doesNotMatch(error.message, /recipient private data|token/)
      return true
    },
  )
})

test('Edge mailer hides network error details', async () => {
  const fakeFetch: typeof fetch = async () => {
    throw new Error('private recipient and confirmation token')
  }

  await assert.rejects(
    sendEmailViaEdgeMailer(
      {
        to: 'reader@example.com',
        subject: 'Verify',
        html: '<p>Verify</p>',
        text: 'Verify',
        idempotencyKey: 'email-recovery-verify/user-1/network-failure',
      },
      {
        supabaseUrl: 'https://project.supabase.co',
        secretKey: 'sb_secret_test',
      },
      fakeFetch,
    ),
    error => {
      assert.ok(error instanceof Error)
      assert.equal(error.message, 'Email delivery function request failed')
      assert.doesNotMatch(error.message, /private recipient|confirmation token/)
      return true
    },
  )
})

test('Edge mailer fails closed when not configured', async () => {
  await assert.rejects(
    sendEmailViaEdgeMailer(
      { to: 'reader@example.com', subject: 'Verify', html: '', text: '', idempotencyKey: 'email-recovery-verify/user-1/not-configured' },
      null,
      fetch,
    ),
    /not configured/,
  )
})
