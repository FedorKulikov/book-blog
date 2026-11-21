import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildEmailVerificationUrl,
  buildPasswordRecoveryUrl,
  emailRecoveryHmac,
  escapeEmailHtml,
  generateEmailRecoveryToken,
  hashEmailForRecovery,
  isValidEmailRecoveryToken,
  sendEmailViaResend,
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
  assert.equal(url.pathname, '/api/email-recovery/confirm')
  assert.equal(url.searchParams.get('token'), 'abc_123')
  assert.equal(url.searchParams.has('next'), false)
})

test('password recovery URL is pinned to the internal reset route', () => {
  const url = new URL(buildPasswordRecoveryUrl('https://bukleb.ru', 'a'.repeat(30)))
  assert.equal(url.origin, 'https://bukleb.ru')
  assert.equal(url.pathname, '/auth/confirm')
  assert.equal(url.searchParams.get('type'), 'recovery')
  assert.equal(url.searchParams.get('next'), '/auth/reset')
  assert.equal(url.searchParams.get('token_hash'), 'a'.repeat(30))
})

test('email HTML escapes untrusted values', () => {
  assert.equal(
    escapeEmailHtml('<script a="b">&\''),
    '&lt;script a=&quot;b&quot;&gt;&amp;&#39;',
  )
})

test('Resend delivery sends only the intended recipient and fails closed', async () => {
  let capturedUrl = ''
  let capturedHeaders: HeadersInit | undefined
  let capturedBody: Record<string, unknown> | undefined

  const fakeFetch: typeof fetch = async (input, init) => {
    capturedUrl = String(input)
    capturedHeaders = init?.headers
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    return new Response(JSON.stringify({ id: 'email_test_id' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  await sendEmailViaResend(
    {
      to: 'reader@example.com',
      subject: 'Verify',
      html: '<p>Verify</p>',
      text: 'Verify',
      idempotencyKey: 'test-message-key',
    },
    { apiKey: 're_test_key', from: 'Book Blog <no-reply@mail.bukleb.ru>' },
    fakeFetch,
  )

  assert.equal(capturedUrl, 'https://api.resend.com/emails')
  const headers = new Headers(capturedHeaders)
  assert.equal(headers.get('Authorization'), 'Bearer re_test_key')
  assert.equal(headers.get('Idempotency-Key'), 'test-message-key')
  assert.deepEqual(capturedBody?.to, ['reader@example.com'])
  assert.equal(capturedBody?.from, 'Book Blog <no-reply@mail.bukleb.ru>')

  await assert.rejects(
    sendEmailViaResend(
      { to: 'reader@example.com', subject: 'Verify', html: '', text: '' },
      null,
      fakeFetch,
    ),
    /not configured/,
  )
})
