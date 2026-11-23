import assert from 'node:assert/strict'
import test from 'node:test'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createPostWithDistributionConsent,
} from '../lib/distribution-consent-server'
import {
  DISTRIBUTION_CONSENT_CATEGORIES,
  DISTRIBUTION_CONSENT_VERSION,
} from '../lib/distribution-consent'

const validInput = {
  title: 'A new post title',
  content: 'This is a sufficiently long post body.',
  type: 'creative',
  bookId: null,
  newsCategory: 'news',
  deadlineAt: null,
  sourceUrl: null,
  distributionConsent: true,
}

const verifiedUserId = '11111111-1111-4111-8111-111111111111'
const consentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const postId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function fakeSupabase(options: {
  limit?: { ok: boolean; reason?: string } | null
  limitError?: unknown
  consentId?: string | null
  consentError?: unknown
  post?: { id: string; status: string } | null
  postError?: { code: string; message: string } | null
} = {}) {
  const calls: { name: string; args: unknown }[] = []
  let insertedPost: Record<string, unknown> | null = null

  const client = {
    rpc: async (name: string, args: unknown) => {
      calls.push({ name, args })
      if (name === 'check_and_log_action') {
        return { data: options.limit === undefined ? { ok: true } : options.limit, error: options.limitError ?? null }
      }
      if (name === 'record_my_distribution_consent') {
        return { data: options.consentId === undefined ? consentId : options.consentId, error: options.consentError ?? null }
      }
      throw new Error(`Unexpected RPC: ${name}`)
    },
    from: (table: string) => {
      assert.equal(table, 'posts')
      return {
        insert: (row: Record<string, unknown>) => {
          insertedPost = row
          return {
            select: () => ({
              single: async () => ({
                data: options.post === undefined ? { id: postId, status: 'pending' } : options.post,
                error: options.postError ?? null,
              }),
            }),
          }
        },
      }
    },
  } as unknown as SupabaseClient

  return {
    client,
    calls,
    get insertedPost() {
      return insertedPost
    },
  }
}

test('missing checkbox consent returns 422 before any RPC or INSERT', async () => {
  const fake = fakeSupabase()
  const result = await createPostWithDistributionConsent(
    fake.client,
    verifiedUserId,
    { ...validInput, distributionConsent: false },
  )

  assert.equal(result.status, 422)
  assert.equal(fake.calls.length, 0)
  assert.equal(fake.insertedPost, null)
})

test('verified server user is used and consent is recorded before INSERT', async () => {
  const fake = fakeSupabase()
  const forgedUserId: string = '22222222-2222-4222-8222-222222222222'
  const forgedPayload = { ...validInput, user_id: forgedUserId }
  const result = await createPostWithDistributionConsent(
    fake.client,
    verifiedUserId,
    forgedPayload as Parameters<typeof createPostWithDistributionConsent>[2],
  )

  assert.equal(result.status, 201)
  assert.deepEqual(fake.calls.map(call => call.name), [
    'check_and_log_action',
    'record_my_distribution_consent',
  ])

  const consentCall = fake.calls[1]
  assert.ok(consentCall)
  assert.deepEqual(consentCall.args, {
    p_scope: 'publication',
    p_data_categories: [...DISTRIBUTION_CONSENT_CATEGORIES],
    p_document_version: DISTRIBUTION_CONSENT_VERSION,
  })

  assert.equal(fake.insertedPost?.user_id, verifiedUserId)
  assert.notEqual(String(fake.insertedPost?.user_id), forgedUserId)
  assert.equal(fake.insertedPost?.title, validInput.title)
  assert.equal(fake.insertedPost?.type, 'creative')
  assert.deepEqual(result.body, { post: { id: postId, status: 'pending' } })
})

test('rate limit failure creates neither consent nor post', async () => {
  const fake = fakeSupabase({ limit: { ok: false, reason: 'hour_limit' } })
  const result = await createPostWithDistributionConsent(
    fake.client,
    verifiedUserId,
    validInput,
  )

  assert.equal(result.status, 429)
  assert.deepEqual(fake.calls.map(call => call.name), ['check_and_log_action'])
  assert.equal(fake.insertedPost, null)
})

test('consent RPC failure prevents the post INSERT', async () => {
  const fake = fakeSupabase({ consentError: { message: 'database error' } })
  const result = await createPostWithDistributionConsent(
    fake.client,
    verifiedUserId,
    validInput,
  )

  assert.equal(result.status, 503)
  assert.deepEqual(fake.calls.map(call => call.name), [
    'check_and_log_action',
    'record_my_distribution_consent',
  ])
  assert.equal(fake.insertedPost, null)
})

test('invalid post input is rejected before consent is recorded', async () => {
  const fake = fakeSupabase()
  const result = await createPostWithDistributionConsent(
    fake.client,
    verifiedUserId,
    { ...validInput, title: 'x' },
  )

  assert.equal(result.status, 422)
  assert.equal(fake.calls.length, 0)
  assert.equal(fake.insertedPost, null)
})

test('database rejection is returned without claiming a post was created', async () => {
  const fake = fakeSupabase({
    post: null,
    postError: { code: '42501', message: 'publication guard rejected the row' },
  })
  const result = await createPostWithDistributionConsent(
    fake.client,
    verifiedUserId,
    validInput,
  )

  assert.equal(result.status, 422)
  assert.deepEqual(result.body, {
    error: 'Публикация отклонена проверкой прав или согласия.',
  })
  assert.equal(fake.insertedPost?.user_id, verifiedUserId)
})
