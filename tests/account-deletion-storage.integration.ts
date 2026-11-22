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
  console.log(`[account-deletion-storage] testing optional removal of only the deleting user's messages`)

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

  await expectDownload(counterpart.client, ownPhoto, true, `counterpart can read the other user's photo before removal`)
  await expectDownload(counterpart.client, ownAudio, true, `counterpart can read the other user's audio before removal`)

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

  assert.equal(storageObjectCount(ownPhoto), 0, `deleting user's photo should be removed`)
  assert.equal(storageObjectCount(ownAudio), 0, `deleting user's audio should be removed`)

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

  await expectDownload(counterpart.client, ownPhoto, false, `removed user's photo no longer exists`)
  await expectDownload(counterpart.client, ownAudio, false, `removed user's audio no longer exists`)
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


async function createSignedUrl(client: SupabaseClient, path: string, context: string): Promise<string> {
  const { data, error } = await client.storage.from('chat-media').createSignedUrl(path, 60)
  checkError(context, error)
  if (!data?.signedUrl) throw new Error(context + ': Supabase returned no signed URL')
  return new URL(data.signedUrl, apiUrl).toString()
}

async function expectSignedUrl(url: string, shouldSucceed: boolean, context: string): Promise<void> {
  const response = await fetch(url)
  assert.equal(
    response.ok,
    shouldSucceed,
    context + ': expected HTTP ' + (shouldSucceed ? 'success' : 'failure') + ', received ' + response.status,
  )
  await response.body?.cancel()
}

async function ensureCopiedIfMissing(source: string, destination: string, context: string): Promise<boolean> {
  const existingCount = storageObjectCount(destination)
  assert.ok(existingCount === 0 || existingCount === 1, context + ': destination path is not unique')
  if (existingCount === 1) return false

  const { error } = await admin.storage.from('chat-media').copy(source, destination)
  checkError(context, error)
  assert.equal(storageObjectCount(destination), 1, context + ': expected exactly one retained copy')
  return true
}

async function removeExistingObjects(paths: string[], context: string): Promise<void> {
  const existingPaths = paths.filter(path => storageObjectCount(path) > 0)
  if (existingPaths.length === 0) return

  const { error } = await admin.storage.from('chat-media').remove(existingPaths)
  checkError(context, error)
  for (const path of existingPaths) {
    assert.equal(storageObjectCount(path), 0, context + ': object should be absent after Storage API removal')
  }
}

// This test exercises a recoverable operation sequence against the real local
// Supabase APIs. It does not call or claim to test a production deletion route.
async function testRecoverableRehomeAndSignedUrls(counterpart: TestUser, outsider: TestUser): Promise<void> {
  console.log('[account-deletion-storage] testing partial failure, retry, and signed URL behavior')

  const author = await createTestUser('retry-author')
  const conversationId = await createConversation(author.id, counterpart.id)
  const originalPhoto = author.id + '/retry-photo.png'
  const originalAudio = author.id + '/retry-voice.webm'

  await upload(author.client, originalPhoto, 'synthetic retry photo', 'image/png')
  const messageId = await createMessage({
    client: author.client,
    conversationId,
    senderId: author.id,
    senderLabel: 'Retry Author',
    text: 'Message retained after a recoverable cleanup failure',
    imageUrl: originalPhoto,
    audioUrl: originalAudio,
  })

  const oldPhotoSignedUrl = await createSignedUrl(author.client, originalPhoto, 'sign original user photo')
  await expectSignedUrl(oldPhotoSignedUrl, true, 'signed URL works while the original object exists')

  const retainedPhoto = 'retained/' + messageId + '/photo.png'
  const retainedAudio = 'retained/' + messageId + '/voice.webm'
  assert.ok(!retainedPhoto.includes(author.id), 'retained photo path must not contain the user UUID')
  assert.ok(!retainedAudio.includes(author.id), 'retained audio path must not contain the user UUID')

  await ensureCopiedIfMissing(originalPhoto, retainedPhoto, 'copy photo before the injected failure')

  // Fault injection: the message references an audio object which is absent.
  // The photo copy succeeds first; copying audio must fail without removing
  // the original photo, changing the message, or deleting the Auth account.
  let missingAudioCopyFailed = false
  try {
    await ensureCopiedIfMissing(originalAudio, retainedAudio, 'copy missing audio should fail')
  } catch {
    missingAudioCopyFailed = true
  }

  assert.equal(missingAudioCopyFailed, true, 'copying an absent source object must fail')
  assert.equal(storageObjectCount(retainedPhoto), 1, 'successful photo copy must survive the partial failure')
  assert.equal(storageObjectCount(retainedAudio), 0, 'absent audio must not produce a retained object')
  assert.equal(storageObjectCount(originalPhoto), 1, 'original photo must remain after partial copy failure')

  const { data: beforeDbRetry, error: beforeDbRetryError } = await admin
    .from('messages')
    .select('sender_id, sender_label, image_url, audio_url')
    .eq('id', messageId)
    .single()
  checkError('read message after partial copy failure', beforeDbRetryError)
  assert.equal(beforeDbRetry?.sender_id, author.id, 'sender must remain linked until all copies are staged')
  assert.equal(beforeDbRetry?.image_url, originalPhoto, 'message path must remain unchanged after partial copy failure')
  assert.equal(beforeDbRetry?.audio_url, originalAudio, 'missing source path must remain unchanged after partial copy failure')

  // Restore the missing test object, then retry. The existing photo copy must
  // be reused rather than copied a second time.
  await upload(author.client, originalAudio, 'synthetic retry voice', 'audio/webm')
  const photoCopiedAgain = await ensureCopiedIfMissing(originalPhoto, retainedPhoto, 'retry photo copy')
  const audioCopiedOnRetry = await ensureCopiedIfMissing(originalAudio, retainedAudio, 'retry audio copy')
  assert.equal(photoCopiedAgain, false, 'retry must reuse the already-staged photo')
  assert.equal(audioCopiedOnRetry, true, 'retry must stage the previously missing audio')
  assert.equal(storageObjectCount(retainedPhoto), 1, 'retry must not duplicate the retained photo')
  assert.equal(storageObjectCount(retainedAudio), 1, 'retry must create exactly one retained audio object')
  assert.equal(storageOwner(retainedPhoto), '<null>', 'retained photo must not be owned by the deleted user')
  assert.equal(storageOwner(retainedAudio), '<null>', 'retained audio must not be owned by the deleted user')

  // Fault injection at the DB stage: NOT NULL violation after the copies exist.
  // The transaction must leave the original message references intact and the
  // user-owned originals must not be removed before a valid DB update.
  const { error: injectedDatabaseFailure } = await admin
    .from('messages')
    .update({
      sender_id: null,
      sender_label: null,
      image_url: retainedPhoto,
      audio_url: retainedAudio,
    })
    .eq('id', messageId)
  assert.ok(injectedDatabaseFailure, 'invalid anonymization update must fail at the database constraint')

  const { data: afterDbFailure, error: afterDbFailureError } = await admin
    .from('messages')
    .select('sender_id, sender_label, image_url, audio_url')
    .eq('id', messageId)
    .single()
  checkError('verify message after injected DB failure', afterDbFailureError)
  assert.equal(afterDbFailure?.sender_id, author.id, 'failed DB update must not detach the sender')
  assert.equal(afterDbFailure?.image_url, originalPhoto, 'failed DB update must not change the photo path')
  assert.equal(afterDbFailure?.audio_url, originalAudio, 'failed DB update must not change the audio path')
  assert.equal(storageObjectCount(originalPhoto), 1, 'source photo must remain until DB references are switched')
  assert.equal(storageObjectCount(originalAudio), 1, 'source audio must remain until DB references are switched')

  const { error: validUpdateError } = await admin
    .from('messages')
    .update({
      sender_id: null,
      sender_label: 'Удалённый пользователь',
      image_url: retainedPhoto,
      audio_url: retainedAudio,
    })
    .eq('id', messageId)
  checkError('retry message update after DB recovers', validUpdateError)

  const { error: conversationUpdateError } = await admin
    .from('conversations')
    .update({ user1_id: null })
    .eq('id', conversationId)
  checkError('detach deleted participant after successful message update', conversationUpdateError)

  await expectDownload(counterpart.client, retainedPhoto, true, 'counterpart can read retained photo after retry')
  await expectDownload(counterpart.client, retainedAudio, true, 'counterpart can read retained audio after retry')
  await expectDownload(outsider.client, retainedPhoto, false, 'outsider cannot read retained photo after retry')
  const retainedPhotoSignedUrl = await createSignedUrl(
    counterpart.client,
    retainedPhoto,
    'counterpart signs retained photo',
  )
  await expectSignedUrl(retainedPhotoSignedUrl, true, 'counterpart signed URL serves retained photo')

  await removeExistingObjects([originalPhoto, originalAudio], 'remove user-owned source objects after DB commit')
  await removeExistingObjects([originalPhoto, originalAudio], 'repeat source cleanup safely')
  assert.equal(storageObjectCount(originalPhoto), 0, 'original photo must be absent after cleanup')
  assert.equal(storageObjectCount(originalAudio), 0, 'original audio must be absent after cleanup')
  await expectSignedUrl(oldPhotoSignedUrl, false, 'old signed URL must stop serving the removed original object')

  // Replaying the post-commit cleanup must be a no-op: no duplicate retained
  // copies, no resurrected original objects, and no second deletion operation.
  const photoCopiedOnReplay = await ensureCopiedIfMissing(originalPhoto, retainedPhoto, 'replay photo stage')
  const audioCopiedOnReplay = await ensureCopiedIfMissing(originalAudio, retainedAudio, 'replay audio stage')
  assert.equal(photoCopiedOnReplay, false, 'replay must not recreate an existing retained photo')
  assert.equal(audioCopiedOnReplay, false, 'replay must not recreate an existing retained audio')
  await removeExistingObjects([originalPhoto, originalAudio], 'replay completed source cleanup')
  assert.equal(storageObjectCount(retainedPhoto), 1, 'replay must not duplicate retained photo')
  assert.equal(storageObjectCount(retainedAudio), 1, 'replay must not duplicate retained audio')

  await deleteAuthUser(author.id, 'retry-author')
  const { data: deletedProfile, error: deletedProfileError } = await admin
    .from('profiles')
    .select('id')
    .eq('id', author.id)
    .maybeSingle()
  checkError('verify retry author profile was deleted', deletedProfileError)
  assert.equal(deletedProfile, null, 'Auth user deletion must remove the detached profile')

  await expectDownload(counterpart.client, retainedPhoto, true, 'counterpart still reads retained photo after Auth deletion')
  await expectDownload(counterpart.client, retainedAudio, true, 'counterpart still reads retained audio after Auth deletion')
  await expectDownload(author.client, retainedPhoto, false, 'deleted author can no longer read retained photo')
  await expectSignedUrl(retainedPhotoSignedUrl, true, 'counterpart signed URL remains valid for its token lifetime')
  await expectSignedUrl(oldPhotoSignedUrl, false, 'old signed URL remains unusable after account deletion')

  const { data: finalMessages, error: finalMessagesError } = await counterpart.client
    .from('messages')
    .select('id, sender_id, sender_label, image_url, audio_url')
    .eq('conversation_id', conversationId)
  checkError('read recovered conversation after account deletion', finalMessagesError)
  assert.equal(finalMessages?.length, 1, 'recovered conversation must retain one message')
  assert.equal(finalMessages?.[0]?.sender_id, null, 'deleted sender ID must remain detached')
  assert.equal(finalMessages?.[0]?.sender_label, 'Удалённый пользователь', 'recovered sender must be anonymized')
  assert.equal(finalMessages?.[0]?.image_url, retainedPhoto, 'recovered message must reference retained photo')
  assert.equal(finalMessages?.[0]?.audio_url, retainedAudio, 'recovered message must reference retained audio')

  console.log('[account-deletion-storage] partial failure, retry, and signed URL checks passed')
}

async function testEmptyConversationCleanup(counterpart: TestUser): Promise<void> {
  console.log('[account-deletion-storage] testing cleanup of an empty conversation')

  const deletingUser = await createTestUser('empty-conversation-author')
  const conversationId = await createConversation(deletingUser.id, counterpart.id)
  const ownPhoto = deletingUser.id + '/only-message.png'
  await upload(deletingUser.client, ownPhoto, 'synthetic last-message photo', 'image/png')

  const ownMessageId = await createMessage({
    client: deletingUser.client,
    conversationId,
    senderId: deletingUser.id,
    senderLabel: 'Empty Conversation Author',
    text: 'The only message in this conversation',
    imageUrl: ownPhoto,
  })

  await removeExistingObjects([ownPhoto], 'remove attachment of the only message')
  const { data: removedMessages, error: removedMessagesError } = await admin
    .from('messages')
    .delete()
    .eq('conversation_id', conversationId)
    .eq('sender_id', deletingUser.id)
    .select('id')
  checkError('delete only message authored by deleting user', removedMessagesError)
  assert.equal(removedMessages?.length, 1, 'the deleting user own message must be removed')
  assert.equal(removedMessages?.[0]?.id, ownMessageId, 'the removed message must be the deleting user message')

  const { count: remainingCount, error: remainingCountError } = await admin
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId)
  checkError('count messages after optional own-message deletion', remainingCountError)
  assert.equal(remainingCount, 0, 'conversation must be empty before it is removed')

  const { data: removedConversations, error: removedConversationsError } = await admin
    .from('conversations')
    .delete()
    .eq('id', conversationId)
    .select('id')
  checkError('remove conversation after its final message is gone', removedConversationsError)
  assert.equal(removedConversations?.length, 1, 'empty conversation should be removed exactly once')
  assert.equal(storageObjectCount(ownPhoto), 0, 'attachment of the removed final message must be absent')

  await deleteAuthUser(deletingUser.id, 'empty-conversation-author')
  const { data: counterpartConversation, error: counterpartConversationError } = await counterpart.client
    .from('conversations')
    .select('id')
    .eq('id', conversationId)
    .maybeSingle()
  checkError('verify counterpart no longer sees an empty conversation', counterpartConversationError)
  assert.equal(counterpartConversation, null, 'counterpart must not retain an empty conversation row')

  console.log('[account-deletion-storage] empty conversation cleanup passed')
}

async function main(): Promise<void> {
  const bucketIsPrivate = queryDatabase(
    "select public::text from storage.buckets where id = 'chat-media'",
  )
  assert.equal(bucketIsPrivate, 'false', 'chat-media bucket must be private')

  const { counterpart, outsider } = await testDefaultPreservation()
  await testOptionalOwnMessageRemoval(counterpart, outsider)
  await testRecoverableRehomeAndSignedUrls(counterpart, outsider)
  await testEmptyConversationCleanup(counterpart)

  console.log('[account-deletion-storage] all real Auth + Storage integration checks passed')
}

main().catch(error => {
  console.error('[account-deletion-storage] integration test failed:', error)
  process.exitCode = 1
})
