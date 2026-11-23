import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SMOKE_ACCOUNT_PREFIX } from './lib/smoke-account-config'
import {
  DISTRIBUTION_CONSENT_CATEGORIES,
  DISTRIBUTION_CONSENT_VERSION,
  PROFILE_PUBLIC_CONSENT_CATEGORIES,
  PROFILE_PUBLIC_CONSENT_VERSION,
} from '../lib/distribution-consent'

const URL = process.env.SUPABASE_URL ?? ''
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const SECRET = process.env.SUPABASE_SECRET_KEY ?? ''

for (const [name, value] of Object.entries({ SUPABASE_URL: URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON, SUPABASE_SECRET_KEY: SECRET })) {
  if (!value) throw new Error(`missing environment variable: ${name}`)
}

if (new URL(URL).hostname === 'tbqjyaxbymntdqzldrjz.supabase.co') {
  throw new Error(
    'production consent-write smoke is disabled: do not create consent records for synthetic users; ' +
    'use the isolated PostgreSQL consent regression tests instead',
  )
}

function apiKeyOnlyFetch(key: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers)
    if (headers.get('authorization') === `Bearer ${key}`) headers.delete('authorization')
    return fetch(input, { ...init, headers })
  }
}

const admin = createClient(URL, SECRET, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: apiKeyOnlyFetch(SECRET) },
})
type Client = SupabaseClient<any>
type TestUser = { id: string; email: string; username: string }

const stamp = Date.now().toString(36)
const password = 'DataSmoke!Pass2026'
const users: TestUser[] = []
const clients: Client[] = []
const storageObjects: { bucket: string; path: string }[] = []
let postId: string | null = null
let bookId: string | null = null
let commentId: string | null = null
let imageId: string | null = null
let conversationId: string | null = null
let notificationId: string | null = null
let passed = 0
let failed = 0

function check(name: string, ok: boolean, detail = '') {
  if (ok) passed++
  else failed++
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` :: ${detail}` : ''}`)
}

function safeError(error: { code?: string; status?: number } | null) {
  return error ? `code=${error.code ?? 'unknown'} status=${error.status ?? 'unknown'}` : 'no error'
}

async function createUser(label: string): Promise<TestUser> {
  const email = `${SMOKE_ACCOUNT_PREFIX.data}${label}-${stamp}@example.com`
  const username = `data_smoke_${label}_${stamp}`
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username },
  })
  if (error || !data.user?.id) {
    throw new Error(`could not create temporary ${label} user (${error?.status ?? 'unknown'})`)
  }
  const user = { id: data.user.id, email, username }
  users.push(user)

  const { data: profile } = await admin.from('profiles').select('id').eq('id', user.id).maybeSingle()
  if (!profile) {
    const { error: profileError } = await admin.from('profiles').insert({ id: user.id, username })
    if (profileError) throw new Error(`could not create temporary profile (${profileError.code})`)
  }
  return user
}

async function signedIn(user: TestUser): Promise<Client> {
  const client = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await client.auth.signInWithPassword({ email: user.email, password })
  if (error || !data.session) throw new Error(`could not sign in temporary user (${error?.status ?? 'unknown'})`)
  clients.push(client)
  return client
}

async function main() {
  try {
    const [alice, bob] = await Promise.all([createUser('a'), createUser('b')])
    const [client, otherClient] = await Promise.all([signedIn(alice), signedIn(bob)])
    const anonymous = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })

    // Storage paths used by the UI are namespaced by the authenticated user's UUID.
    // Probe all buckets with real JWTs; clean any unexpected successful writes.
    const probeBlob = new Blob([`storage-smoke-${stamp}`], { type: 'image/png' })
    async function uploadProbe(
      target: Client,
      bucket: 'avatars' | 'post-images' | 'chat-media',
      path: string,
      upsert = false,
    ) {
      const { error } = await target.storage.from(bucket).upload(path, probeBlob, {
        contentType: 'image/png',
        upsert,
      })
      if (!error) storageObjects.push({ bucket, path })
      return error
    }

    const avatarPath = `${alice.id}/storage-smoke-${stamp}.png`
    const avatarWithoutConsent = await uploadProbe(client, 'avatars', avatarPath)
    check(
      'profile owner cannot upload a public avatar without profile_public consent',
      Boolean(avatarWithoutConsent),
      safeError(avatarWithoutConsent),
    )

    const bobAvatarWithoutConsent = await uploadProbe(
      otherClient,
      'avatars',
      `${bob.id}/avatar-without-profile-consent-${stamp}.png`,
    )
    check(
      'second user cannot upload a public avatar without their own profile_public consent',
      Boolean(bobAvatarWithoutConsent),
      safeError(bobAvatarWithoutConsent),
    )

    const postImageUpload = await uploadProbe(client, 'post-images', `${alice.id}/storage-smoke-${stamp}.png`)
    check('owner can upload a post image in their own folder', !postImageUpload, safeError(postImageUpload))

    const chatMediaUpload = await uploadProbe(client, 'chat-media', `${alice.id}/storage-smoke-${stamp}.png`)
    check('owner can upload chat media in their own folder', !chatMediaUpload, safeError(chatMediaUpload))

    for (const bucket of ['avatars', 'post-images', 'chat-media'] as const) {
      const error = await uploadProbe(client, bucket, `${bob.id}/foreign-folder-probe-${stamp}.png`)
      check(`authenticated user cannot upload into another user's ${bucket} folder`, Boolean(error), safeError(error))
    }

    for (const bucket of ['avatars', 'post-images', 'chat-media'] as const) {
      const error = await uploadProbe(anonymous, bucket, `${alice.id}/anonymous-probe-${stamp}.png`)
      check(`anonymous user cannot upload into ${bucket}`, Boolean(error), safeError(error))
    }

    const follow = await client.from('follows').insert({
      follower_id: alice.id,
      following_id: bob.id,
    }).select('follower_id, following_id').single()
    check('user can follow another profile', !follow.error && follow.data?.following_id === bob.id, safeError(follow.error))
    if (follow.data) {
      const otherDeleteFollow = await otherClient.from('follows')
        .delete().eq('follower_id', alice.id).eq('following_id', bob.id).select('follower_id')
      check('followed user cannot remove someone else’s follow', !otherDeleteFollow.error && (otherDeleteFollow.data?.length ?? 0) === 0, safeError(otherDeleteFollow.error))
      const ownerUnfollow = await client.from('follows')
        .delete().eq('follower_id', alice.id).eq('following_id', bob.id).select('follower_id')
      check('follower can unfollow normally', !ownerUnfollow.error && ownerUnfollow.data?.length === 1, safeError(ownerUnfollow.error))
    }

    // Consolidated public-read policy remains public, while user-owned
    // rows and writes still require an authenticated owner.
    const anonymousBooks = await anonymous.from('books').select('id').limit(1)
    check('anonymous visitors can still read public books', !anonymousBooks.error && (anonymousBooks.data?.length ?? 0) === 1, safeError(anonymousBooks.error))

    // Anonymous visitors retain public reads but no client-side writes.
    const anonPost = await anonymous.from('posts').insert({ user_id: alice.id, title: 'anon write probe', type: 'creative' })
    check('anon cannot insert posts', Boolean(anonPost.error), safeError(anonPost.error))
    const anonProfile = await anonymous.from('profiles').update({ bio: 'unauthorized' }).eq('id', alice.id)
    check('anon cannot update profiles', Boolean(anonProfile.error), safeError(anonProfile.error))

    // Stage 3 live production smoke: a public profile update and avatar upload
    // must fail until the owner grants profile_public consent.
    const editedUsername = `data_edit_${stamp}`

    const alicePublicFieldWithoutConsent = await client.from('profiles')
      .update({ bio: `blocked-without-profile-consent-${stamp}` })
      .eq('id', alice.id)
      .select('id')
    check(
      'profile owner cannot change a public field without profile_public consent',
      alicePublicFieldWithoutConsent.error?.code === '42501',
      safeError(alicePublicFieldWithoutConsent.error),
    )

    const bobPublicFieldWithoutConsent = await otherClient.from('profiles')
      .update({ bio: `bob-blocked-without-profile-consent-${stamp}` })
      .eq('id', bob.id)
      .select('id')
    check(
      'second user cannot change their own public profile field without consent',
      bobPublicFieldWithoutConsent.error?.code === '42501',
      safeError(bobPublicFieldWithoutConsent.error),
    )

    // notifications_muted is private: it remains writable without profile consent,
    // but its value is read only through the auth.uid()-scoped RPC.
    const privateProfileEdit = await client.from('profiles')
      .update({ notifications_muted: true })
      .eq('id', alice.id)
    const privateNotificationSetting = await client.rpc('my_profile_notification_settings')
    check(
      'private notification preference can be saved and read by its owner without profile consent',
      !privateProfileEdit.error &&
        !privateNotificationSetting.error &&
        privateNotificationSetting.data === true,
      safeError(privateProfileEdit.error ?? privateNotificationSetting.error),
    )

    const profileConsent = await client.rpc('record_my_distribution_consent', {
      p_scope: 'profile_public',
      p_data_categories: [...PROFILE_PUBLIC_CONSENT_CATEGORIES],
      p_document_version: PROFILE_PUBLIC_CONSENT_VERSION,
    })
    check(
      'author can record profile_public consent through the user-scoped RPC',
      !profileConsent.error && Boolean(profileConsent.data),
      safeError(profileConsent.error),
    )

    const aliceProfileConsents = await client.rpc('my_distribution_consents')
    const aliceProfileGrant = (aliceProfileConsents.data ?? []).find((row: {
      scope: string
      document_version: string
      data_categories: string[]
      revoked_at: string | null
    }) => row.scope === 'profile_public' &&
      row.document_version === PROFILE_PUBLIC_CONSENT_VERSION &&
      row.revoked_at === null &&
      JSON.stringify(row.data_categories) === JSON.stringify([...PROFILE_PUBLIC_CONSENT_CATEGORIES]))
    check(
      'profile_public consent is persisted and visible in the owner own consent history',
      !aliceProfileConsents.error && Boolean(aliceProfileGrant),
      safeError(aliceProfileConsents.error),
    )

    const bobProfileConsents = await otherClient.rpc('my_distribution_consents')
    check(
      'another user cannot read profile_public consent history',
      !bobProfileConsents.error &&
        !(bobProfileConsents.data ?? []).some((row: { scope: string }) => row.scope === 'profile_public'),
      safeError(bobProfileConsents.error),
    )

    const bobRevokeProfile = await otherClient.rpc('revoke_my_distribution_consent', {
      p_scope: 'profile_public',
    })
    const aliceProfileConsentsAfterBobRevoke = await client.rpc('my_distribution_consents')
    const aliceProfileStillActive = (aliceProfileConsentsAfterBobRevoke.data ?? []).some((row: {
      scope: string
      document_version: string
      revoked_at: string | null
    }) => row.scope === 'profile_public' &&
      row.document_version === PROFILE_PUBLIC_CONSENT_VERSION &&
      row.revoked_at === null)
    check(
      'another user cannot revoke profile_public consent',
      !bobRevokeProfile.error &&
        !aliceProfileConsentsAfterBobRevoke.error &&
        aliceProfileStillActive,
      safeError(bobRevokeProfile.error ?? aliceProfileConsentsAfterBobRevoke.error),
    )

    // Avatar uploads are public, so the Storage policy must enforce the same consent.
    const avatarUpload = await uploadProbe(client, 'avatars', avatarPath)
    check('owner can upload a public avatar after profile_public consent', !avatarUpload, safeError(avatarUpload))
    if (!avatarUpload) {
      const avatarReplace = await uploadProbe(client, 'avatars', avatarPath, true)
      check('owner can replace their public avatar after profile_public consent', !avatarReplace, safeError(avatarReplace))
    }

    const avatarUrl = client.storage.from('avatars').getPublicUrl(avatarPath).data.publicUrl
    const profileEdit = await client.from('profiles').update({
      username: editedUsername,
      bio: `smoke-${stamp}`,
      avatar_url: avatarUrl,
    }).eq('id', alice.id).select('username, bio, avatar_url').single()
    const privateSettingAfterPublicEdit = await client.rpc('my_profile_notification_settings')
    check(
      'owner can save public profile fields and avatar after profile_public consent',
      !profileEdit.error &&
        profileEdit.data?.username === editedUsername &&
        profileEdit.data?.bio === `smoke-${stamp}` &&
        profileEdit.data?.avatar_url === avatarUrl &&
        !privateSettingAfterPublicEdit.error &&
        privateSettingAfterPublicEdit.data === true,
      safeError(profileEdit.error ?? privateSettingAfterPublicEdit.error),
    )

    const otherProfileEdit = await otherClient.from('profiles')
      .update({ bio: 'unauthorized profile change' }).eq('id', alice.id).select('id')
    check('another user cannot edit an owned profile', !otherProfileEdit.error && (otherProfileEdit.data?.length ?? 0) === 0, safeError(otherProfileEdit.error))

    const profileConsentRevoke = await client.rpc('revoke_my_distribution_consent', {
      p_scope: 'profile_public',
    })
    const publicFieldAfterRevoke = await client.from('profiles')
      .update({ bio: `blocked-after-profile-revoke-${stamp}` })
      .eq('id', alice.id)
      .select('id')
    check(
      'profile owner cannot change public fields after profile consent revocation',
      !profileConsentRevoke.error && publicFieldAfterRevoke.error?.code === '42501',
      safeError(publicFieldAfterRevoke.error ?? profileConsentRevoke.error),
    )

    const avatarAfterRevoke = await uploadProbe(
      client,
      'avatars',
      `${alice.id}/avatar-after-profile-revoke-${stamp}.png`,
    )
    check(
      'avatar Storage policy blocks uploads after profile consent revocation',
      Boolean(avatarAfterRevoke),
      safeError(avatarAfterRevoke),
    )

    const roleEscalation = await client.from('profiles').update({ role: 'admin' }).eq('id', alice.id)
    const roleAfter = await client.from('profiles').select('role').eq('id', alice.id).single()
    check('ordinary user cannot promote their own profile', !roleAfter.error && roleAfter.data?.role === 'user', safeError(roleEscalation.error))

    const banEscalation = await client.from('profiles').update({ is_banned: true }).eq('id', alice.id)
    const banAfter = await client.from('profiles').select('is_banned').eq('id', alice.id).single()
    check(
      'ordinary user cannot ban themselves through the profile API',
      !banAfter.error && banAfter.data?.is_banned === false,
      safeError(banEscalation.error),
    )

    const profileTimestamp = await client.from('profiles').update({ created_at: '2099-01-01T00:00:00.000Z' }).eq('id', alice.id)
    check('profile created_at cannot be forged', Boolean(profileTimestamp.error), safeError(profileTimestamp.error))

    // Book ownership is enforced by RLS, and counters/timestamps are DB-owned.
    const forgedBook = await client.from('books').insert({
      title: `forged-${stamp}`, created_by: bob.id,
    })
    check('book cannot be created under another user id', Boolean(forgedBook.error), safeError(forgedBook.error))

    const forgedBookFields = await client.from('books').insert({
      title: `bad-fields-${stamp}`, created_by: alice.id, views_count: 999,
      created_at: '2099-01-01T00:00:00.000Z',
    })
    check('book views and created_at cannot be supplied by client', Boolean(forgedBookFields.error), safeError(forgedBookFields.error))

    const book = await client.from('books').insert({
      title: `Data security smoke ${stamp}`, author: 'Temporary test fixture',
      description: 'Automatically cleaned up by the smoke test.', created_by: alice.id,
    }).select('id, created_at, views_count').single()
    check(
      'normal book creation works with DB-owned timestamp and counter',
      !book.error && Boolean(book.data?.id) && book.data?.views_count === 0 &&
        Math.abs(Date.now() - Date.parse(book.data?.created_at ?? '')) < 120_000,
      safeError(book.error),
    )
    if (book.data?.id) bookId = book.data.id

    if (bookId) {
      const otherEditBook = await otherClient.from('books')
        .update({ title: `unauthorized-${stamp}` }).eq('id', bookId).select('id')
      check('another user cannot edit an owned book', !otherEditBook.error && (otherEditBook.data?.length ?? 0) === 0, safeError(otherEditBook.error))

      const ownerEditBook = await client.from('books')
        .update({ title: `Data security smoke edited ${stamp}` }).eq('id', bookId).select('id')
      check('book owner can still edit their own book', !ownerEditBook.error && ownerEditBook.data?.length === 1, safeError(ownerEditBook.error))
    }

    // Post INSERT trigger must own status; client cannot forge timestamps/views.
    const forgedPost = await client.from('posts').insert({
      user_id: alice.id, title: `forged-post-${stamp}`, type: 'creative',
      status: 'approved', created_at: '2099-01-01T00:00:00.000Z',
    })
    check('post status and created_at cannot be supplied on INSERT', Boolean(forgedPost.error), safeError(forgedPost.error))

    // Production rollout smoke: a second authenticated user has no grant and
    // must not create a post or read Alice's consent history.
    const bobConsentsBefore = await otherClient.rpc('my_distribution_consents')
    check(
      'new authenticated user starts with no distribution consent rows',
      !bobConsentsBefore.error && (bobConsentsBefore.data?.length ?? 0) === 0,
      safeError(bobConsentsBefore.error),
    )

    const bobWithoutConsent = await otherClient.from('posts').insert({
      user_id: bob.id,
      title: `post-without-consent-${stamp}`,
      content: 'This post must be rejected by the production database guard.',
      type: 'creative',
    }).select('id').single()
    check(
      'another authenticated user cannot create a post without their own consent',
      Boolean(bobWithoutConsent.error),
      safeError(bobWithoutConsent.error),
    )
    if (bobWithoutConsent.data?.id) {
      await admin.from('posts').delete().eq('id', bobWithoutConsent.data.id)
    }

    const publicationConsent = await client.rpc('record_my_distribution_consent', {
      p_scope: 'publication',
      p_data_categories: [...DISTRIBUTION_CONSENT_CATEGORIES],
      p_document_version: DISTRIBUTION_CONSENT_VERSION,
    })
    check('author can record their own publication consent', !publicationConsent.error && Boolean(publicationConsent.data), safeError(publicationConsent.error))

    const aliceConsents = await client.rpc('my_distribution_consents')
    const ownPublicationConsent = (aliceConsents.data ?? []).find((row: {
      scope: string
      document_version: string
      data_categories: string[]
      revoked_at: string | null
    }) => row.scope === 'publication' &&
      row.document_version === DISTRIBUTION_CONSENT_VERSION &&
      row.revoked_at === null &&
      JSON.stringify(row.data_categories) === JSON.stringify([...DISTRIBUTION_CONSENT_CATEGORIES]))
    check(
      'publication consent is stored and visible in author own consent history',
      !aliceConsents.error && Boolean(ownPublicationConsent),
      safeError(aliceConsents.error),
    )

    const bobConsentsAfterAliceGrant = await otherClient.rpc('my_distribution_consents')
    check(
      'another user cannot read the author own consent history',
      !bobConsentsAfterAliceGrant.error && (bobConsentsAfterAliceGrant.data?.length ?? 0) === 0,
      safeError(bobConsentsAfterAliceGrant.error),
    )

    const bobRevokeAlice = await otherClient.rpc('revoke_my_distribution_consent', {
      p_scope: 'publication',
    })
    const aliceConsentsAfterBobRevoke = await client.rpc('my_distribution_consents')
    const aliceConsentStillActive = (aliceConsentsAfterBobRevoke.data ?? []).some((row: {
      scope: string
      document_version: string
      revoked_at: string | null
    }) => row.scope === 'publication' &&
      row.document_version === DISTRIBUTION_CONSENT_VERSION &&
      row.revoked_at === null)
    check(
      'another user cannot revoke the author own consent',
      !bobRevokeAlice.error && !aliceConsentsAfterBobRevoke.error && aliceConsentStillActive,
      safeError(bobRevokeAlice.error ?? aliceConsentsAfterBobRevoke.error),
    )

    const post = await client.from('posts').insert({
      user_id: alice.id, title: `Data security smoke ${stamp}`,
      content: 'Temporary post fixture.', type: 'creative',
    }).select('id, status, created_at, views_count').single()
    check(
      'normal post creation still runs moderation trigger',
      !post.error && Boolean(post.data?.id) && post.data?.status === 'pending' &&
        post.data?.views_count === 0 &&
        Math.abs(Date.now() - Date.parse(post.data?.created_at ?? '')) < 120_000,
      safeError(post.error),
    )
    if (post.data?.id) postId = post.data.id

    if (postId) {
      // Likes are intentionally allowed only on published posts.
      const publishedPost = await anonymous.from('posts')
        .select('id').eq('status', 'approved').limit(1).maybeSingle()
      check('a public approved post is available for like flow', !publishedPost.error && Boolean(publishedPost.data?.id), safeError(publishedPost.error))
      if (publishedPost.data?.id) {
        const like = await client.from('likes').insert({
          post_id: publishedPost.data.id,
          user_id: alice.id,
        }).select('user_id, post_id').single()
        check('owner can like an approved public post', !like.error && like.data?.user_id === alice.id, safeError(like.error))
        if (like.data) {
          const otherDeleteLike = await otherClient.from('likes')
            .delete().eq('post_id', publishedPost.data.id).eq('user_id', alice.id).select('user_id')
          check('another user cannot remove an owned like', !otherDeleteLike.error && (otherDeleteLike.data?.length ?? 0) === 0, safeError(otherDeleteLike.error))
          const ownerDeleteLike = await client.from('likes')
            .delete().eq('post_id', publishedPost.data.id).eq('user_id', alice.id).select('user_id')
          check('owner can remove their own like', !ownerDeleteLike.error && ownerDeleteLike.data?.length === 1, safeError(ownerDeleteLike.error))
        }
      }

      const bookmark = await client.from('bookmarks').insert({
        user_id: alice.id,
        post_id: postId,
      }).select('user_id, post_id').single()
      check('owner can bookmark a post', !bookmark.error && bookmark.data?.user_id === alice.id, safeError(bookmark.error))
      if (bookmark.data) {
        const otherDeleteBookmark = await otherClient.from('bookmarks')
          .delete().eq('post_id', postId).eq('user_id', alice.id).select('user_id')
        check('another user cannot remove an owned bookmark', !otherDeleteBookmark.error && (otherDeleteBookmark.data?.length ?? 0) === 0, safeError(otherDeleteBookmark.error))
        const ownerDeleteBookmark = await client.from('bookmarks')
          .delete().eq('post_id', postId).eq('user_id', alice.id).select('user_id')
        check('owner can remove their own bookmark', !ownerDeleteBookmark.error && ownerDeleteBookmark.data?.length === 1, safeError(ownerDeleteBookmark.error))
      }

      const bobPrivatePost = await otherClient.from('posts').select('id').eq('id', postId)
      check('other user cannot read an owner pending post', !bobPrivatePost.error && (bobPrivatePost.data?.length ?? 0) === 0, safeError(bobPrivatePost.error))

      const anonPrivatePost = await anonymous.from('posts').select('id').eq('id', postId)
      check('anonymous visitor cannot read a pending post', !anonPrivatePost.error && (anonPrivatePost.data?.length ?? 0) === 0, safeError(anonPrivatePost.error))

      const ownerEditPost = await client.from('posts')
        .update({ title: `Data security smoke edited ${stamp}` }).eq('id', postId).select('id')
      check('post owner can still edit their own post', !ownerEditPost.error && ownerEditPost.data?.length === 1, safeError(ownerEditPost.error))

      const otherEditPost = await otherClient.from('posts')
        .update({ title: 'unauthorized edit' }).eq('id', postId).select('id')
      check('another user cannot edit an owner pending post', !otherEditPost.error && (otherEditPost.data?.length ?? 0) === 0, safeError(otherEditPost.error))

      const otherDeletePost = await otherClient.from('posts')
        .delete().eq('id', postId).select('id')
      check('another user cannot delete an owner pending post', !otherDeletePost.error && (otherDeletePost.data?.length ?? 0) === 0, safeError(otherDeletePost.error))

      const forgedPostUpdate = await client.from('posts')
        .update({ created_at: '2099-01-01T00:00:00.000Z' }).eq('id', postId)
      check('post created_at cannot be rewritten', Boolean(forgedPostUpdate.error), safeError(forgedPostUpdate.error))

      const forgedViews = await client.from('posts').update({ views_count: 999 }).eq('id', postId)
      check('post view counter cannot be inflated directly', Boolean(forgedViews.error), safeError(forgedViews.error))

      const forgedComment = await client.from('comments').insert({
        post_id: postId, user_id: alice.id, text: 'timestamp probe',
        created_at: '2099-01-01T00:00:00.000Z',
      })
      check('comment created_at cannot bypass rate-limit window', Boolean(forgedComment.error), safeError(forgedComment.error))

      const comment = await client.from('comments').insert({
        post_id: postId, user_id: alice.id, text: 'Temporary comment fixture.',
      }).select('id, created_at').single()
      check(
        'normal comment creation works with DB timestamp',
        !comment.error && Boolean(comment.data?.id) &&
          Math.abs(Date.now() - Date.parse(comment.data?.created_at ?? '')) < 120_000,
        safeError(comment.error),
      )
      if (comment.data?.id) commentId = comment.data.id

      if (commentId) {
        const anonComment = await anonymous.from('comments').select('id').eq('id', commentId)
        check('anonymous visitors can still read public comments', !anonComment.error && anonComment.data?.length === 1, safeError(anonComment.error))

        const otherDeleteComment = await otherClient.from('comments')
          .delete().eq('id', commentId).select('id')
        check('another user cannot delete an owned comment', !otherDeleteComment.error && (otherDeleteComment.data?.length ?? 0) === 0, safeError(otherDeleteComment.error))

        const ownerDeleteComment = await client.from('comments')
          .delete().eq('id', commentId).select('id')
        check('comment owner can still delete their own comment', !ownerDeleteComment.error && ownerDeleteComment.data?.length === 1, safeError(ownerDeleteComment.error))
        if (!ownerDeleteComment.error && ownerDeleteComment.data?.length === 1) commentId = null
      }

      const image = await client.from('post_images').insert({
        post_id: postId,
        url: 'https://example.com/data-smoke-image.jpg',
        sort_order: 0,
      }).select('id').single()
      check('post owner can attach an image row', !image.error && Boolean(image.data?.id), safeError(image.error))
      if (image.data?.id) imageId = image.data.id

      if (imageId) {
        const otherDeleteImage = await otherClient.from('post_images')
          .delete().eq('id', imageId).select('id')
        check('another user cannot delete an owned post image', !otherDeleteImage.error && (otherDeleteImage.data?.length ?? 0) === 0, safeError(otherDeleteImage.error))

        const ownerDeleteImage = await client.from('post_images')
          .delete().eq('id', imageId).select('id')
        check('post owner can still delete their own image', !ownerDeleteImage.error && ownerDeleteImage.data?.length === 1, safeError(ownerDeleteImage.error))
        if (!ownerDeleteImage.error && ownerDeleteImage.data?.length === 1) imageId = null
      }

      const forgedLike = await client.from('likes').insert({
        post_id: postId, user_id: alice.id, created_at: '2099-01-01T00:00:00.000Z',
      })
      check('like created_at cannot bypass rate-limit window', Boolean(forgedLike.error), safeError(forgedLike.error))

      const forgedReport = await client.from('reports').insert({
        reporter_id: alice.id, post_id: postId, reason: 'status probe', status: 'resolved',
      })
      check('report cannot be created already resolved', Boolean(forgedReport.error), safeError(forgedReport.error))

      const reportReason = `Temporary report fixture ${stamp}.`
      const report = await client.from('reports').insert({
        reporter_id: alice.id, post_id: postId, reason: reportReason,
      })
      const reportCheck = await admin.from('reports').select('status')
        .eq('reporter_id', alice.id).eq('post_id', postId).eq('reason', reportReason).single()
      check(
        'normal report submission works and starts open',
        !report.error && !reportCheck.error && reportCheck.data?.status === 'open',
        safeError(report.error ?? reportCheck.error),
      )
    }

    // Notifications can only be marked read, not impersonated or made unread again.
    const notification = await admin.from('notifications').insert({
      user_id: alice.id, actor_id: bob.id, type: 'data_smoke',
    }).select('id').single()
    if (notification.data?.id) notificationId = notification.data.id
    check('service-side notification fixture created', !notification.error && Boolean(notification.data?.id), safeError(notification.error))

    if (notification.data?.id) {
      const markRead = await client.from('notifications').update({ is_read: true }).eq('id', notification.data.id)
      check('owner can mark notification read', !markRead.error, safeError(markRead.error))

      const changeActor = await client.from('notifications').update({ actor_id: alice.id }).eq('id', notification.data.id)
      check('owner cannot rewrite notification actor', Boolean(changeActor.error), safeError(changeActor.error))

      const markUnread = await client.from('notifications').update({ is_read: false }).eq('id', notification.data.id)
      check('read notification cannot be reset to unread', Boolean(markUnread.error), safeError(markUnread.error))
    }

    // The RPC is still the supported path to create conversations. Timestamps
    // and read state are not client-settable when sending a message.
    const conv = await client.rpc('get_or_create_conversation', { other_user_id: bob.id })
    if (!conv.error && conv.data) {
      conversationId = conv.data as string
      const forgedMessage = await client.from('messages').insert({
        conversation_id: conversationId, sender_id: alice.id,
        text: 'timestamp probe', created_at: '2099-01-01T00:00:00.000Z',
        read_at: '2099-01-01T00:00:00.000Z',
      })
      check('message timestamps/read state cannot be forged on INSERT', Boolean(forgedMessage.error), safeError(forgedMessage.error))
    } else {
      check('get_or_create_conversation remains callable', false, safeError(conv.error))
    }

    const forgedTicket = await client.from('tickets').insert({
      user_id: alice.id, subject: 'status probe', category: 'other', status: 'closed',
    })
    check('ticket cannot be created already closed', Boolean(forgedTicket.error), safeError(forgedTicket.error))

    // Ticket creation through the authenticated RPC remains a valid user flow.
    const ticket = await client.rpc('create_ticket', {
      p_subject: `Temporary support smoke ${stamp}`,
      p_category: 'other',
      p_message: 'Temporary test fixture.',
    })
    check('create_ticket RPC still works with column-scoped INSERT', !ticket.error && Boolean(ticket.data), safeError(ticket.error))
  } finally {
    const cleanupFailures: string[] = []
    const recordDelete = async (
      label: string,
      operation: Promise<{ error: { code?: string; status?: number } | null }>,
    ) => {
      const { error } = await operation
      if (error) cleanupFailures.push(`${label} (${error.code ?? error.status ?? 'unknown'})`)
    }

    // Auth deletion cascades the profile and its complete consent history,
    // including revoked rows. Do not create extra revocation records here.
    for (const client of clients) {
      const { error } = await client.auth.signOut()
      if (error) cleanupFailures.push(`sign out temporary session (${error.status ?? 'unknown'})`)
    }

    const objectsByBucket = new Map<string, string[]>()
    for (const object of storageObjects) {
      const paths = objectsByBucket.get(object.bucket) ?? []
      if (!paths.includes(object.path)) paths.push(object.path)
      objectsByBucket.set(object.bucket, paths)
    }
    for (const [bucket, paths] of objectsByBucket) {
      for (let offset = 0; offset < paths.length; offset += 100) {
        const { error } = await admin.storage.from(bucket).remove(paths.slice(offset, offset + 100))
        if (error) cleanupFailures.push(`remove Storage objects from ${bucket} (${error.message})`)
      }
    }

    for (const user of users) {
      await recordDelete('remove test books', admin.from('books').delete().eq('created_by', user.id))
      await recordDelete('remove test-authored external news', admin.from('external_news').delete().eq('created_by', user.id))
    }

    for (const user of users) {
      const { error } = await admin.auth.admin.deleteUser(user.id)
      if (error) cleanupFailures.push(`delete ${user.email} Auth account (status=${error.status ?? 'unknown'})`)
    }

    const userIds = users.map(user => user.id)
    if (userIds.length > 0) {
      const [profiles, posts, books, notifications, reports] = await Promise.all([
        admin.from('profiles').select('id').in('id', userIds),
        admin.from('posts').select('id').in('user_id', userIds),
        admin.from('books').select('id').in('created_by', userIds),
        admin.from('notifications').select('id').or(`user_id.in.(${userIds.join(',')}),actor_id.in.(${userIds.join(',')})`),
        admin.from('reports').select('id').in('reporter_id', userIds),
      ])
      for (const [label, result] of [
        ['profiles', profiles],
        ['posts', posts],
        ['books', books],
        ['notifications', notifications],
        ['reports', reports],
      ] as const) {
        if (result.error || (result.data?.length ?? 0) > 0) {
          cleanupFailures.push(`verify zero ${label} (${result.error?.code ?? result.data?.length ?? 'unknown'})`)
        }
      }
    }

    if (cleanupFailures.length > 0) {
      console.error(`CLEANUP FAIL — ${cleanupFailures.join('; ')}`)
      failed++
      throw new Error(`client data-integrity cleanup failed for ${cleanupFailures.length} operation(s)`)
    }
    console.log(`CLEANUP PASS — deleted ${users.length} temporary data-smoke accounts; consent history cascaded with Auth users`)
  }

  console.log(`\nClient data-integrity checks: ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(2)
}

main().catch((error) => {
  console.error('Client data-integrity smoke failed:', error instanceof Error ? error.message : 'unknown error')
  process.exit(1)
})
