import { createClient } from '@supabase/supabase-js'

const SUPA_URL = process.env.SUPABASE_URL ?? ''
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY ?? ''

for (const [name, value] of Object.entries({
  SUPABASE_URL: SUPA_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON,
  SUPABASE_SECRET_KEY: SECRET_KEY,
})) {
  if (!value) throw new Error(`missing environment variable: ${name}`)
}

function apikeyOnlyFetch(key: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers)
    if (headers.get('authorization') === `Bearer ${key}`) {
      headers.delete('authorization')
    }
    return fetch(input, { ...init, headers })
  }
}

const admin = createClient(SUPA_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: apikeyOnlyFetch(SECRET_KEY) },
})

const stamp = Date.now().toString(36)
const password = 'ChatSmoke!Pass2026'
type TestUser = { id: string; email: string; username: string }
type Client = ReturnType<typeof createClient>

let passed = 0
let failed = 0
let conversationId: string | null = null
let messageId: string | null = null
const users: TestUser[] = []
const clients: Client[] = []

function check(name: string, ok: boolean, detail = '') {
  if (ok) passed++
  else failed++
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` :: ${detail}` : ''}`)
}

function safeError(error: { code?: string; status?: number } | null) {
  return error ? `code=${error.code ?? 'unknown'} status=${error.status ?? 'unknown'}` : 'no error'
}

async function createTestUser(prefix: string): Promise<TestUser> {
  const email = `chat-smoke-${prefix}-${stamp}@example.com`
  const username = `chat_smoke_${prefix}_${stamp}`
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username },
  })
  if (error || !data.user?.id) {
    throw new Error(`could not create temporary ${prefix} user (${error?.status ?? 'unknown'})`)
  }
  const user = { id: data.user.id, email, username }
  users.push(user)

  const { data: profile } = await admin
    .from('profiles')
    .select('id')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile) {
    const { error: profileError } = await admin
      .from('profiles')
      .insert({ id: user.id, username })
    if (profileError) throw new Error(`could not create temporary profile (${profileError.code})`)
  }
  return user
}

async function signedInClient(user: TestUser): Promise<Client> {
  const client = createClient(SUPA_URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await client.auth.signInWithPassword({
    email: user.email,
    password,
  })
  if (error || !data.session) {
    throw new Error(`could not sign in temporary test user (${error?.status ?? 'unknown'})`)
  }
  clients.push(client)
  return client
}

async function main() {
  try {
    const [alice, bob] = await Promise.all([
      createTestUser('a'),
      createTestUser('b'),
    ])
    const [aliceClient, bobClient] = await Promise.all([
      signedInClient(alice),
      signedInClient(bob),
    ])

    const conversation = await aliceClient.rpc('get_or_create_conversation', {
      other_user_id: bob.id,
    })
    if (conversation.error || !conversation.data) {
      throw new Error(`could not create temporary conversation (${conversation.error?.code ?? 'unknown'})`)
    }
    conversationId = conversation.data as string

    const inserted = await aliceClient
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_id: alice.id,
        text: `temporary access-control smoke test ${stamp}`,
      })
      .select('id')
      .single()
    if (inserted.error || !inserted.data?.id) {
      throw new Error(`could not insert temporary message (${inserted.error?.code ?? 'unknown'})`)
    }
    messageId = inserted.data.id

    const originalText = `temporary access-control smoke test ${stamp}`

    // Recipient can mark an incoming message read.
    const readTimestamp = new Date().toISOString()
    const markRead = await bobClient
      .from('messages')
      .update({ read_at: readTimestamp })
      .eq('id', messageId)
      .is('read_at', null)
      .select('id, read_at')
      .single()
    check(
      'recipient can mark incoming message as read',
      !markRead.error && Boolean(markRead.data?.read_at),
      safeError(markRead.error),
    )

    // Participant cannot alter message content or identity fields.
    const editText = await bobClient
      .from('messages')
      .update({ text: 'unauthorized edit' })
      .eq('id', messageId)
    check('participant cannot edit another message text', Boolean(editText.error), safeError(editText.error))

    const editSender = await bobClient
      .from('messages')
      .update({ sender_id: bob.id })
      .eq('id', messageId)
    check('participant cannot replace message sender', Boolean(editSender.error), safeError(editSender.error))

    const unchanged = await bobClient
      .from('messages')
      .select('text, sender_id, read_at')
      .eq('id', messageId)
      .single()
    check(
      'message content and sender remain unchanged',
      !unchanged.error && unchanged.data?.text === originalText && unchanged.data?.sender_id === alice.id,
      safeError(unchanged.error),
    )

    // A recipient may set read_at once, but cannot rewrite or clear it.
    const rewriteRead = await bobClient
      .from('messages')
      .update({ read_at: new Date(Date.now() + 60_000).toISOString() })
      .eq('id', messageId)
    check('recipient cannot rewrite an existing read timestamp', Boolean(rewriteRead.error), safeError(rewriteRead.error))

    const senderRead = await aliceClient
      .from('messages')
      .update({ read_at: null })
      .eq('id', messageId)
    check('sender cannot clear/change read status', Boolean(senderRead.error), safeError(senderRead.error))

    // Anonymous role has no UPDATE privilege, even for read_at.
    const anonymous = createClient(SUPA_URL, ANON, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const anonUpdate = await anonymous
      .from('messages')
      .update({ read_at: new Date().toISOString() })
      .eq('id', messageId)
    check('anonymous role cannot update message read status', Boolean(anonUpdate.error), safeError(anonUpdate.error))

    // Mute: a participant may change their own flag only.
    const conv = await bobClient
      .from('conversations')
      .select('id, user1_id, user2_id, muted_by_user1, muted_by_user2')
      .eq('id', conversationId)
      .single()
    if (conv.error || !conv.data) {
      throw new Error(`could not read temporary conversation (${conv.error?.code ?? 'unknown'})`)
    }

    const ownMute = conv.data.user1_id === bob.id ? 'muted_by_user1' : 'muted_by_user2'
    const otherMute = ownMute === 'muted_by_user1' ? 'muted_by_user2' : 'muted_by_user1'
    const nextOwnMute = !Boolean(conv.data[ownMute])
    const changeOwnMute = await bobClient
      .from('conversations')
      .update({ [ownMute]: nextOwnMute })
      .eq('id', conversationId)
      .select('id')
      .single()
    check('participant can change their own mute flag', !changeOwnMute.error, safeError(changeOwnMute.error))

    const changeOtherMute = await bobClient
      .from('conversations')
      .update({ [otherMute]: !Boolean(conv.data[otherMute]) })
      .eq('id', conversationId)
    check('participant cannot change the other user mute flag', Boolean(changeOtherMute.error), safeError(changeOtherMute.error))

    const changeParticipants = await bobClient
      .from('conversations')
      .update({ user2_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' })
      .eq('id', conversationId)
    check('participant cannot change conversation membership', Boolean(changeParticipants.error), safeError(changeParticipants.error))

    const verifyConversation = await bobClient
      .from('conversations')
      .select('user1_id, user2_id')
      .eq('id', conversationId)
      .single()
    check(
      'conversation participants remain unchanged',
      !verifyConversation.error &&
        verifyConversation.data?.user1_id === conv.data.user1_id &&
        verifyConversation.data?.user2_id === conv.data.user2_id,
      safeError(verifyConversation.error),
    )
  } finally {
    // Sign out before deleting temporary users. No existing user or row is touched.
    for (const client of clients) {
      await client.auth.signOut().catch(() => undefined)
    }

    if (conversationId) {
      await admin.from('messages').delete().eq('conversation_id', conversationId)
      await admin.from('conversations').delete().eq('id', conversationId)
    }
    for (const user of users) {
      await admin.auth.admin.deleteUser(user.id).catch(() => undefined)
    }
  }

  console.log(`\nChat security checks: ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(2)
}

main().catch((error) => {
  console.error('Chat security smoke test failed:', error instanceof Error ? error.message : 'unknown error')
  process.exit(1)
})
