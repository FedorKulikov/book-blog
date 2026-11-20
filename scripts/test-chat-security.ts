import { createClient, type SupabaseClient } from '@supabase/supabase-js'

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
type Client = SupabaseClient<any>

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

    // These helpers must work as ordinary authenticated calls, with RLS applied.
    const staffCheck = await aliceClient.rpc('is_staff')
    check('is_staff works as invoker for a regular account', !staffCheck.error && staffCheck.data === false, safeError(staffCheck.error))

    const baseUnread = await bobClient.rpc('count_unread_messages')
    check('count_unread_messages works under recipient RLS', !baseUnread.error && typeof baseUnread.data === 'number', safeError(baseUnread.error))

    const actionName = `chat-smoke-${stamp}`
    const firstRateCheck = await aliceClient.rpc('check_and_log_action', {
      action_input: actionName,
      max_per_hour: 10,
      max_per_minute: 1,
    })
    check('check_and_log_action inserts own rate-limit row under RLS', !firstRateCheck.error && firstRateCheck.data?.ok === true, safeError(firstRateCheck.error))

    const secondRateCheck = await aliceClient.rpc('check_and_log_action', {
      action_input: actionName,
      max_per_hour: 10,
      max_per_minute: 1,
    })
    check('check_and_log_action reads own rows and enforces the limit', !secondRateCheck.error && secondRateCheck.data?.ok === false && secondRateCheck.data?.reason === 'minute_limit', safeError(secondRateCheck.error))

    const ticket = await aliceClient.rpc('create_ticket', {
      p_subject: `Temporary smoke ticket ${stamp}`,
      p_category: 'other',
      p_message: 'Temporary ticket created by the chat security smoke test.',
    })
    check('create_ticket writes through authenticated RLS', !ticket.error && Boolean(ticket.data), safeError(ticket.error))

    if (ticket.data) {
      const ticketRow = await aliceClient
        .from('tickets')
        .select('id, user_id')
        .eq('id', ticket.data)
        .single()
      check('ticket is visible only to its owner under RLS', !ticketRow.error && ticketRow.data?.user_id === alice.id, safeError(ticketRow.error))

      const ticketMessages = await aliceClient
        .from('ticket_messages')
        .select('id, sender_id, is_staff_reply')
        .eq('ticket_id', ticket.data)
      check(
        'initial ticket message is inserted under participant RLS',
        !ticketMessages.error && ticketMessages.data?.length === 1 &&
          ticketMessages.data[0]?.sender_id === alice.id &&
          ticketMessages.data[0]?.is_staff_reply === false,
        safeError(ticketMessages.error),
      )
    }

    const conversation = await aliceClient.rpc('get_or_create_conversation', {
      other_user_id: bob.id,
    })
    if (conversation.error || !conversation.data) {
      throw new Error(`could not create temporary conversation (${conversation.error?.code ?? 'unknown'})`)
    }
    const testConversationId = conversation.data as string
    conversationId = testConversationId

    const inserted = await aliceClient
      .from('messages')
      .insert({
        conversation_id: testConversationId,
        sender_id: alice.id,
        text: `temporary access-control smoke test ${stamp}`,
      })
      .select('id')
      .single()
    if (inserted.error || !inserted.data?.id) {
      throw new Error(`could not insert temporary message (${inserted.error?.code ?? 'unknown'})`)
    }
    const testMessageId = inserted.data.id
    messageId = testMessageId

    const originalText = `temporary access-control smoke test ${stamp}`

    const unreadWithMessage = await bobClient.rpc('count_unread_messages')
    check(
      'count_unread_messages sees the recipient own unread row',
      !unreadWithMessage.error && unreadWithMessage.data === (baseUnread.data ?? 0) + 1,
      safeError(unreadWithMessage.error),
    )

    // Recipient can mark an incoming message read.
    const readTimestamp = new Date().toISOString()
    const markRead = await bobClient
      .from('messages')
      .update({ read_at: readTimestamp })
      .eq('id', testMessageId)
      .is('read_at', null)
      .select('id, read_at')
      .single()
    check(
      'recipient can mark incoming message as read',
      !markRead.error && Boolean(markRead.data?.read_at),
      safeError(markRead.error),
    )

    const unreadAfterRead = await bobClient.rpc('count_unread_messages')
    check(
      'count_unread_messages stops counting after read_at is set',
      !unreadAfterRead.error && unreadAfterRead.data === (baseUnread.data ?? 0),
      safeError(unreadAfterRead.error),
    )

    // Blocking helpers operate under the caller's RLS visibility.
    const block = await aliceClient.from('user_blocks').insert({
      blocker_id: alice.id,
      blocked_id: bob.id,
    })
    check('authenticated user can create own block row', !block.error, safeError(block.error))

    const isBlocking = await aliceClient.rpc('is_blocking', { other_user_id: bob.id })
    check('is_blocking reads own block rows under RLS', !isBlocking.error && isBlocking.data === true, safeError(isBlocking.error))

    const isBlockedByOther = await bobClient.rpc('is_blocked_by_other', { other_user_id: alice.id })
    check('is_blocked_by_other reads own blocked row under RLS', !isBlockedByOther.error && isBlockedByOther.data === true, safeError(isBlockedByOther.error))

    // Participant cannot alter message content or identity fields.
    const editText = await bobClient
      .from('messages')
      .update({ text: 'unauthorized edit' })
      .eq('id', testMessageId)
    check('participant cannot edit another message text', Boolean(editText.error), safeError(editText.error))

    const editSender = await bobClient
      .from('messages')
      .update({ sender_id: bob.id })
      .eq('id', testMessageId)
    check('participant cannot replace message sender', Boolean(editSender.error), safeError(editSender.error))

    const unchanged = await bobClient
      .from('messages')
      .select('text, sender_id, read_at')
      .eq('id', testMessageId)
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
      .eq('id', testMessageId)
    check('recipient cannot rewrite an existing read timestamp', Boolean(rewriteRead.error), safeError(rewriteRead.error))

    const senderRead = await aliceClient
      .from('messages')
      .update({ read_at: null })
      .eq('id', testMessageId)
    check('sender cannot clear/change read status', Boolean(senderRead.error), safeError(senderRead.error))

    // Anonymous role has no UPDATE privilege, even for read_at.
    const anonymous = createClient(SUPA_URL, ANON, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const anonUpdate = await anonymous
      .from('messages')
      .update({ read_at: new Date().toISOString() })
      .eq('id', testMessageId)
    check('anonymous role cannot update message read status', Boolean(anonUpdate.error), safeError(anonUpdate.error))

    // RPCs that require an account must not be executable as anon.
    const anonCheckRate = await anonymous.rpc('check_and_log_action', {
      action_input: 'chat-smoke',
      max_per_hour: 10,
      max_per_minute: 1,
    })
    check('anon cannot execute check_and_log_action', Boolean(anonCheckRate.error), safeError(anonCheckRate.error))

    const anonUnread = await anonymous.rpc('count_unread_messages')
    check('anon cannot execute count_unread_messages', Boolean(anonUnread.error), safeError(anonUnread.error))

    const anonTicket = await anonymous.rpc('create_ticket', {
      p_subject: 'smoke',
      p_category: 'other',
      p_message: 'temporary anonymous permission probe',
    })
    check('anon cannot execute create_ticket', Boolean(anonTicket.error), safeError(anonTicket.error))

    const anonConversation = await anonymous.rpc('get_or_create_conversation', {
      other_user_id: bob.id,
    })
    check('anon cannot execute get_or_create_conversation', Boolean(anonConversation.error), safeError(anonConversation.error))

    const anonBlockedByOther = await anonymous.rpc('is_blocked_by_other', {
      other_user_id: bob.id,
    })
    check('anon cannot execute is_blocked_by_other', Boolean(anonBlockedByOther.error), safeError(anonBlockedByOther.error))

    const anonBlocking = await anonymous.rpc('is_blocking', {
      other_user_id: bob.id,
    })
    check('anon cannot execute is_blocking', Boolean(anonBlocking.error), safeError(anonBlocking.error))

    const anonStaff = await anonymous.rpc('is_staff')
    check('anon cannot execute is_staff', Boolean(anonStaff.error), safeError(anonStaff.error))

    // These two RPCs intentionally remain public for view counters. Use
    // a non-existent UUID so the calls cannot change a real book or post.
    const noRealRecord = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
    const anonBookView = await anonymous.rpc('increment_book_views', {
      book_id_input: noRealRecord,
    })
    check('anon retains public book view counter', !anonBookView.error, safeError(anonBookView.error))

    const anonPostView = await anonymous.rpc('increment_post_views', {
      post_id_input: noRealRecord,
    })
    check('anon retains public post view counter', !anonPostView.error, safeError(anonPostView.error))

    // Mute: a participant may change their own flag only.
    const conv = await bobClient
      .from('conversations')
      .select('id, user1_id, user2_id, muted_by_user1, muted_by_user2')
      .eq('id', testConversationId)
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
      .eq('id', testConversationId)
      .select('id')
      .single()
    check('participant can change their own mute flag', !changeOwnMute.error, safeError(changeOwnMute.error))

    const changeOtherMute = await bobClient
      .from('conversations')
      .update({ [otherMute]: !Boolean(conv.data[otherMute]) })
      .eq('id', testConversationId)
    check('participant cannot change the other user mute flag', Boolean(changeOtherMute.error), safeError(changeOtherMute.error))

    const changeParticipants = await bobClient
      .from('conversations')
      .update({ user2_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' })
      .eq('id', testConversationId)
    check('participant cannot change conversation membership', Boolean(changeParticipants.error), safeError(changeParticipants.error))

    const verifyConversation = await bobClient
      .from('conversations')
      .select('user1_id, user2_id')
      .eq('id', testConversationId)
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

    for (const user of users) {
      await admin.from('action_log').delete().eq('user_id', user.id)
      await admin.from('tickets').delete().eq('user_id', user.id)
      await admin.from('user_blocks').delete().eq('blocker_id', user.id)
      await admin.from('user_blocks').delete().eq('blocked_id', user.id)
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
