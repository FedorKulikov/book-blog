import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const apiUrl = requiredEnv('API_URL')
const anonKey = requiredEnv('ANON_KEY')
const serviceRoleKey = requiredEnv('SERVICE_ROLE_KEY')
const dbUrl = requiredEnv('DB_URL')

const localHostnames = new Set(['127.0.0.1', 'localhost'])
assert.ok(localHostnames.has(new URL(apiUrl).hostname), 'Refusing to run against a non-local Supabase API')
assert.ok(
  [...localHostnames].some(host => dbUrl.includes(host)),
  'Refusing to run against a non-local PostgreSQL database',
)

const admin = createClient(apiUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
})

type TestUser = {
  id: string
  email: string
  client: SupabaseClient
}

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

function checkError(action: string, error: { message: string } | null): void {
  if (error) throw new Error(`${action}: ${error.message}`)
}

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function queryDatabase(query: string): string {
  return execFileSync(
    'psql',
    [dbUrl, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', query],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim()
}

async function createTestUser(label: string): Promise<TestUser> {
  const email = `account-deletion-${label}-${randomUUID()}@example.test`
  const password = `CiOnly-${randomUUID()}-Aa9!`

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  checkError(`create test user ${label}`, error)
  if (!data.user) throw new Error(`Auth did not return the created user ${label}`)

  const client = createClient(apiUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  })
  const { error: signInError } = await client.auth.signInWithPassword({ email, password })
  checkError(`sign in test user ${label}`, signInError)

  const { error: profileError } = await admin
    .from('profiles')
    .insert({ id: data.user.id, username: label })
  checkError(`create profile ${label}`, profileError)

  return { id: data.user.id, email, client }
}

async function createConversation(user1Id: string, user2Id: string): Promise<string> {
  const { data, error } = await admin
    .from('conversations')
    .insert({ user1_id: user1Id, user2_id: user2Id })
    .select('id')
    .single()
  checkError('create test conversation', error)
  if (!data?.id) throw new Error('Conversation insert returned no id')
  return data.id as string
}

async function upload(
  client: SupabaseClient,
  path: string,
  body: string,
  contentType: string,
): Promise<void> {
  const { error } = await client.storage
    .from('chat-media')
    .upload(path, Buffer.from(body), { contentType, upsert: false })
  checkError(`upload fixture ${path}`, error)
}

async function expectDownload(
  client: SupabaseClient,
  path: string,
  shouldSucceed: boolean,
  context: string,
): Promise<void> {
  const { data, error } = await client.storage.from('chat-media').download(path)
  if (shouldSucceed) {
    checkError(`${context}: expected Storage download to succeed`, error)
    assert.ok(data, `${context}: Storage returned no file data`)
  } else {
    assert.ok(error, `${context}: expected Storage RLS to deny the download`)
    assert.equal(data, null, `${context}: denied download unexpectedly returned file data`)
  }
}

function storageOwner(path: string): string {
  return queryDatabase(
    `select coalesce(owner_id::text, '<null>') from storage.objects where bucket_id = 'chat-media' and name = ${sqlLiteral(path)}`,
  )
}

function storageObjectCount(path: string): number {
  return Number(
    queryDatabase(
      `select count(*) from storage.objects where bucket_id = 'chat-media' and name = ${sqlLiteral(path)}`,
    ),
  )
}

async function createMessage(input: {
  client: SupabaseClient
  conversationId: string
  senderId: string
  senderLabel: string
  text?: string
  imageUrl?: string
  audioUrl?: string
}): Promise<string> {
  const { data, error } = await input.client
    .from('messages')
    .insert({
      conversation_id: input.conversationId,
      sender_id: input.senderId,
      sender_label: input.senderLabel,
      text: input.text ?? null,
      image_url: input.imageUrl ?? null,
      audio_url: input.audioUrl ?? null,
    })
    .select('id')
    .single()
  checkError('insert test message', error)
  if (!data?.id) throw new Error('Message insert returned no id')
  return data.id as string
}

async function deleteAuthUser(userId: string, label: string): Promise<void> {
  const { error } = await admin.auth.admin.deleteUser(userId)
  checkError(`delete test user ${label}`, error)
}

async function testDefaultPreservation(): Promise<{
  counterpart: TestUser
  outsider: TestUser
}> {
  console.log('[account-deletion-storage] testing default preserve/anonymize mode')

  const author = await createTestUser('preserve-author')
  const counterpart = await createTestUser('preserve-counterpart')
  const outsider = await createTestUser('unrelated-outsider')
  const conversationId = await createConversation(author.id, counterpart.id)

  const originalPhoto = `${author.id}/fixture-photo.png`
  const originalAudio = `${author.id}/fixture-voice.webm`
  await upload(author.client, originalPhoto, 'synthetic png fixture', 'image/png')
  await upload(author.client, originalAudio, 'synthetic audio fixture', 'audio/webm')

  assert.equal(storageOwner(originalPhoto), author.id, 'user-uploaded photo should be owned by the author')
  assert.equal(storageOwner(originalAudio), author.id, 'user-uploaded audio should be owned by the author')

  const messageId = await createMessage({
    client: author.client,
    conversationId,
    senderId: author.id,
    senderLabel: 'Preserve Author',
    text: 'A message that must remain visible to the counterpart',
    imageUrl: originalPhoto,
    audioUrl: originalAudio,
  })

  await expectDownload(author.client, originalPhoto, true, 'author can read their own photo')
  await expectDownload(counterpart.client, originalPhoto, true, 'counterpart can read the photo')
  await expectDownload(counterpart.client, originalAudio, true, 'counterpart can read the audio')
  await expectDownload(outsider.client, originalPhoto, false, 'unrelated user cannot read original media')

  const neutralFolder = `retained/${randomUUID()}`
  const retainedPhoto = `${neutralFolder}/photo.png`
  const retainedAudio = `${neutralFolder}/voice.webm`
  assert.ok(!retainedPhoto.includes(author.id), 'neutral photo path must not expose the deleted account UUID')
  assert.ok(!retainedAudio.includes(author.id), 'neutral audio path must not expose the deleted account UUID')

  const { error: copyPhotoError } = await admin.storage
    .from('chat-media')
    .copy(originalPhoto, retainedPhoto)
  checkError('service-role copy of photo', copyPhotoError)

  const { error: copyAudioError } = await admin.storage
    .from('chat-media')
    .copy(originalAudio, retainedAudio)
  checkError('service-role copy of audio', copyAudioError)

  assert.equal(storageOwner(retainedPhoto), '<null>', 'service-role copied photo must have no user owner_id')
  assert.equal(storageOwner(retainedAudio), '<null>', 'service-role copied audio must have no user owner_id')

  const { error: messageUpdateError } = await admin
    .from('messages')
    .update({
      sender_id: null,
      sender_label: 'Удалённый пользователь',
      image_url: retainedPhoto,
      audio_url: retainedAudio,
    })
    .eq('id', messageId)
  checkError('re-home message references and anonymize sender', messageUpdateError)

  const { error: conversationUpdateError } = await admin
    .from('conversations')
    .update({ user1_id: null })
    .eq('id', conversationId)
  checkError('detach deleted account from conversation', conversationUpdateError)

  // The replacement must be accessible before the original user-owned copies are removed.
  await expectDownload(counterpart.client, retainedPhoto, true, 'counterpart can read retained photo')
  await expectDownload(counterpart.client, retainedAudio, true, 'counterpart can read retained audio')
  await expectDownload(outsider.client, retainedPhoto, false, 'outsider cannot read retained photo')

  const { error: removeOriginalsError } = await admin.storage
    .from('chat-media')
    .remove([originalPhoto, originalAudio])
  checkError('remove original user-owned media through Storage API', removeOriginalsError)
  assert.equal(storageObjectCount(originalPhoto), 0, 'original photo should be removed')
  assert.equal(storageObjectCount(originalAudio), 0, 'original audio should be removed')

  await deleteAuthUser(author.id, 'preserve-author')

  const { data: remainingProfile, error: profileLookupError } = await admin
    .from('profiles')
    .select('id')
    .eq('id', author.id)
    .maybeSingle()
  checkError('verify deleted profile is gone', profileLookupError)
  assert.equal(remainingProfile, null, 'Auth user deletion should cascade to the profile')

  await expectDownload(counterpart.client, retainedPhoto, true, 'counterpart retains photo after account deletion')
  await expectDownload(counterpart.client, retainedAudio, true, 'counterpart retains audio after account deletion')
  await expectDownload(outsider.client, retainedPhoto, false, 'outsider remains unable to read retained media')
  await expectDownload(author.client, retainedPhoto, false, 'deleted author is no longer a conversation participant')

  const { data: preservedMessages, error: preservedMessagesError } = await counterpart.client
    .from('messages')
    .select('id, sender_id, sender_label, image_url, audio_url')
    .eq('conversation_id', conversationId)
  checkError('counterpart reads preserved conversation history', preservedMessagesError)
  assert.equal(preservedMessages?.length, 1, 'preserved conversation should contain the original message')
  assert.equal(preservedMessages?.[0]?.sender_id, null, 'deleted sender id should be detached')
  assert.equal(preservedMessages?.[0]?.sender_label, 'Удалённый пользователь', 'message should show the neutral sender label')
  assert.equal(preservedMessages?.[0]?.image_url, retainedPhoto, 'message should point to the retained photo')
  assert.equal(preservedMessages?.[0]?.audio_url, retainedAudio, 'message should point to the retained audio')

  console.log('[account-deletion-storage] default preservation mode passed')
  return { counterpart, outsider }
}

async function testOptionalOwnMessageRemoval(counterpart: TestUser, outsider: TestUser): Promise<void> {
  console.log('[account-deletion-storage] testing optional removal of only the deleting user's messages')

  const deletingUser = await createTestUser('remove-own-author')
  const conversationId = await createConversation(deletingUser.id, counterpart.id)

  const counterpartMessageId = await createMessage({
    client: counterpart.client,
    conversationId,
    senderId: counterpart.id,
    senderLabel: 'Preserved Counterpart',
    text: 'This message belongs to the other participant and must remain',
  })

  const ownPhoto = `${deletingUser.id}/own-photo.png`
  const ownAudio = `${deletingUser.id}/own-voice.webm`
  await upload(deletingUser.client, ownPhoto, 'synthetic own png fixture', 'image/png')
  await upload(deletingUser.client, ownAudio, 'synthetic own audio fixture', 'audio/webm')

  const ownMessageId = await createMessage({
    client: deletingUser.client,
    conversationId,
    senderId: deletingUser.id,
    senderLabel: 'Removing User',
    text: 'This message belongs to the deleting account',
    imageUrl: ownPhoto,
    audioUrl: ownAudio,
  })

  await expectDownload(counterpart.client, ownPhoto, true, 'counterpart can read the other user's photo before removal')
  await expectDownload(counterpart.client, ownAudio, true, 'counterpart can read the other user's audio before removal')

  const { error: removeOwnMediaError } = await admin.storage
    .from('chat-media')
    .remove([ownPhoto, ownAudio])
  checkError('remove deleting user attachments through Storage API', removeOwnMediaError)

  const { error: deleteOwnMessagesError } = await admin
    .from('messages')
    .delete()
    .eq('conversation_id', conversationId)
    .eq('sender_id', deletingUser.id)
  checkError('delete only messages authored by the deleting user', deleteOwnMessagesError)

  assert.equal(storageObjectCount(ownPhoto), 0, 'deleting user's photo should be removed')
  assert.equal(storageObjectCount(ownAudio), 0, 'deleting user's audio should be removed')

  await deleteAuthUser(deletingUser.id, 'remove-own-author')

  const { data: remainingMessages, error: remainingMessagesError } = await counterpart.client
    .from('messages')
    .select('id, sender_id, text, image_url, audio_url')
    .eq('conversation_id', conversationId)
  checkError('counterpart reads remaining messages', remainingMessagesError)
  assert.equal(remainingMessages?.length, 1, 'counterpart message must remain')
  assert.equal(remainingMessages?.[0]?.id, counterpartMessageId, 'the surviving message must be the counterpart-authored one')
  assert.equal(remainingMessages?.[0]?.sender_id, counterpart.id, 'counterpart author identity must remain')
  assert.equal(remainingMessages?.[0]?.text, 'This message belongs to the other participant and must remain', 'counterpart message text must remain')

  await expectDownload(counterpart.client, ownPhoto, false, 'removed user's photo no longer exists')
  await expectDownload(counterpart.client, ownAudio, false, 'removed user's audio no longer exists')
  await expectDownload(outsider.client, ownPhoto, false, 'outsider cannot read removed media')

  const { data: conversation, error: conversationError } = await counterpart.client
    .from('conversations')
    .select('id, user1_id, user2_id')
    .eq('id', conversationId)
    .single()
  checkError('counterpart conversation remains after own-message removal', conversationError)
  assert.equal(conversation?.user1_id, null, 'deleted participant should be detached')
  assert.equal(conversation?.user2_id, counterpart.id, 'other participant should remain')

  console.log('[account-deletion-storage] optional own-message removal mode passed')
}

async function main(): Promise<void> {
  const bucketIsPrivate = queryDatabase(
    "select public::text from storage.buckets where id = 'chat-media'",
  )
  assert.equal(bucketIsPrivate, 'false', 'chat-media bucket must be private')

  const { counterpart, outsider } = await testDefaultPreservation()
  await testOptionalOwnMessageRemoval(counterpart, outsider)

  console.log('[account-deletion-storage] all real Auth + Storage integration checks passed')
}

main().catch(error => {
  console.error('[account-deletion-storage] integration test failed:', error)
  process.exitCode = 1
})
