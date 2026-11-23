import assert from 'node:assert/strict'
import test from 'node:test'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  updateProfileWithConsent,
  type UpdateProfileInput,
} from '../lib/profile-consent-server'

const userId = '11111111-1111-4111-8111-111111111111'
const supabaseUrl = 'https://tbqjyaxbymntdqzldrjz.supabase.co'

const currentProfile = {
  username: 'profile_a',
  bio: 'Current public bio',
  avatar_url: null,
  notifications_muted: false,
}

const baseInput: UpdateProfileInput = {
  username: 'profile_a',
  bio: 'Current public bio',
  avatarUrl: null,
  notificationsMuted: false,
}

function fakeSupabase(options: {
  consentRows?: unknown
  consentError?: unknown
  updateError?: { code?: string } | null
  profile?: typeof currentProfile
  profileError?: unknown
} = {}) {
  const rpcCalls: string[] = []
  const updates: Record<string, unknown>[] = []

  const client = {
    rpc: async (name: string) => {
      rpcCalls.push(name)
      if (name === 'my_distribution_consents') {
        return {
          data: options.consentRows ?? [],
          error: options.consentError ?? null,
        }
      }
      throw new Error(`Unexpected RPC: ${name}`)
    },
    from: (table: string) => {
      assert.equal(table, 'profiles')
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: options.profile ?? currentProfile,
              error: options.profileError ?? null,
            }),
          }),
        }),
        update: (values: Record<string, unknown>) => {
          updates.push(values)
          return {
            eq: async () => ({ error: options.updateError ?? null }),
          }
        },
      }
    },
  } as unknown as SupabaseClient

  return { client, rpcCalls, updates }
}

test('public profile changes return 422 without a profile_public grant', async () => {
  const fake = fakeSupabase()
  const result = await updateProfileWithConsent(
    fake.client,
    userId,
    { ...baseInput, bio: 'Changed public bio' },
    supabaseUrl,
  )

  assert.equal(result.status, 422)
  assert.match('error' in result.body ? result.body.error : '', /согласие/i)
  assert.equal(fake.rpcCalls.length, 1)
  assert.equal(fake.updates.length, 0)
})

test('publication consent alone does not authorize public profile changes', async () => {
  const fake = fakeSupabase({
    consentRows: [{
      scope: 'publication',
      document_version: '1.1',
      data_categories: ['publication_title'],
      granted_at: '2026-11-23T00:00:00.000Z',
      revoked_at: null,
    }],
  })
  const result = await updateProfileWithConsent(
    fake.client,
    userId,
    { ...baseInput, username: 'profile_a_new' },
    supabaseUrl,
  )

  assert.equal(result.status, 422)
  assert.equal(fake.updates.length, 0)
})

test('private notification preference saves without checking profile consent', async () => {
  const fake = fakeSupabase()
  const result = await updateProfileWithConsent(
    fake.client,
    userId,
    { ...baseInput, notificationsMuted: true },
    supabaseUrl,
  )

  assert.deepEqual(result, { status: 200, body: { ok: true } })
  assert.deepEqual(fake.rpcCalls, [])
  assert.deepEqual(fake.updates, [{ notifications_muted: true }])
})

test('public profile change succeeds with the owner active profile_public grant', async () => {
  const fake = fakeSupabase({
    consentRows: [{
      scope: 'profile_public',
      document_version: '1.1',
      data_categories: ['profile_username', 'profile_avatar', 'profile_bio', 'profile_joined_at'],
      granted_at: '2026-11-23T00:00:00.000Z',
      revoked_at: null,
    }],
  })
  const result = await updateProfileWithConsent(
    fake.client,
    userId,
    { ...baseInput, username: 'profile_a_new', bio: 'New public bio' },
    supabaseUrl,
  )

  assert.deepEqual(result, { status: 200, body: { ok: true } })
  assert.deepEqual(fake.rpcCalls, ['my_distribution_consents'])
  assert.deepEqual(fake.updates, [{
    username: 'profile_a_new',
    bio: 'New public bio',
  }])
})

test('consent lookup error fails closed before public profile update', async () => {
  const fake = fakeSupabase({ consentError: { code: 'XX000' } })
  const result = await updateProfileWithConsent(
    fake.client,
    userId,
    { ...baseInput, bio: 'Changed public bio' },
    supabaseUrl,
  )

  assert.equal(result.status, 503)
  assert.equal(fake.updates.length, 0)
})

test('avatar URL from a different host or user folder is rejected', async () => {
  const fake = fakeSupabase({
    consentRows: [{
      scope: 'profile_public',
      document_version: '1.1',
      data_categories: ['profile_avatar'],
      granted_at: '2026-11-23T00:00:00.000Z',
      revoked_at: null,
    }],
  })
  const result = await updateProfileWithConsent(
    fake.client,
    userId,
    {
      ...baseInput,
      avatarUrl: 'https://attacker.example/public/avatar.jpg',
    },
    supabaseUrl,
  )

  assert.equal(result.status, 422)
  assert.equal(fake.updates.length, 0)
  assert.equal(fake.rpcCalls.length, 0)
})

test('username conflict returns a validation error', async () => {
  const fake = fakeSupabase({
    consentRows: [{
      scope: 'profile_public',
      document_version: '1.1',
      data_categories: ['profile_username'],
      granted_at: '2026-11-23T00:00:00.000Z',
      revoked_at: null,
    }],
    updateError: { code: '23505' },
  })
  const result = await updateProfileWithConsent(
    fake.client,
    userId,
    { ...baseInput, username: 'taken_name' },
    supabaseUrl,
  )

  assert.equal(result.status, 422)
  assert.match('error' in result.body ? result.body.error : '', /занято/i)
})
