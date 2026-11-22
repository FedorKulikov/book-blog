import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getChatMediaObjectPath } from './chat-media-path'

export type ChatDeletionMode = 'preserve' | 'delete_own_messages'

export type AccountDeletionBlocker = {
  code: string
  label: string
  count: number
}

const BLOCKER_SOURCES = [
  { table: 'posts', column: 'user_id', code: 'posts', label: 'Публикации' },
  { table: 'comments', column: 'user_id', code: 'comments', label: 'Комментарии' },
  { table: 'tickets', column: 'user_id', code: 'tickets', label: 'Обращения в поддержку' },
  { table: 'ticket_messages', column: 'sender_id', code: 'ticket_messages', label: 'Сообщения поддержки' },
  { table: 'reports', column: 'reporter_id', code: 'reports', label: 'Жалобы и модерация' },
  { table: 'action_log', column: 'user_id', code: 'action_log', label: 'Журнал действий' },
  { table: 'notifications', column: 'actor_id', code: 'notifications_as_actor', label: 'Уведомления других пользователей' },
] as const

const STORAGE_REFERENCE_SOURCES = [
  { table: 'post_images', column: 'url', code: 'post_image_references', label: 'Изображения в публикациях других пользователей' },
  { table: 'books', column: 'cover_url', code: 'book_cover_references', label: 'Обложки книг' },
  { table: 'external_news', column: 'cover_url', code: 'external_news_cover_references', label: 'Обложки внешних новостей' },
] as const

type MessageMediaReference = {
  id: string
  conversation_id: string
  sender_id: string | null
  image_url: string | null
  audio_url: string | null
}

type StorageEntry = {
  name: string
  id?: string | null
  metadata?: unknown
}

const ACCOUNT_DELETION_PAGE_SIZE = 500
const ACCOUNT_DELETION_MAX_MESSAGE_ROWS = 100_000

/**
 * Returns aggregate blockers only. No user content or message text is read.
 * Any query error fails closed: account deletion must not proceed on an
 * incomplete retention preflight.
 */
export async function inspectAccountDeletionBlockers(
  admin: SupabaseClient,
  userId: string,
): Promise<AccountDeletionBlocker[]> {
  const blockers: AccountDeletionBlocker[] = []

  for (const source of BLOCKER_SOURCES) {
    const query = admin
      .from(source.table)
      .select('*', { count: 'exact', head: true })
    const { count, error } =
      source.code === 'notifications_as_actor'
        ? await query.eq(source.column, userId).neq('user_id', userId)
        : await query.eq(source.column, userId)

    if (error || count === null) {
      throw new Error(`account deletion preflight failed for ${source.code}`)
    }

    if (count > 0) {
      blockers.push({
        code: source.code,
        label: source.label,
        count,
      })
    }
  }

  const { count: avatarReferences, error: avatarError } = await admin
    .from('profiles')
    .select('*', { count: 'exact', head: true })
    .neq('id', userId)
    .or(`avatar_url.ilike.${userId}/%,avatar_url.ilike.%/${userId}/%`)

  if (avatarError || avatarReferences === null) {
    throw new Error('account deletion avatar-reference preflight failed')
  }
  if (avatarReferences > 0) {
    blockers.push({
      code: 'other_profile_avatar_references',
      label: 'Аватары других пользователей, использующие файлы аккаунта',
      count: avatarReferences,
    })
  }

  // A UID-prefixed post image may have been reused by another author's post
  // or an external-news card. Preserve those public references rather than
  // deleting a shared object merely because its Storage path starts with UID.
  for (const source of STORAGE_REFERENCE_SOURCES) {
    const { count, error } = await admin
      .from(source.table)
      .select('*', { count: 'exact', head: true })
      .or(`${source.column}.ilike.${userId}/%,${source.column}.ilike.%/${userId}/%`)

    if (error || count === null) {
      throw new Error(`account deletion Storage-reference preflight failed for ${source.code}`)
    }

    if (count > 0) {
      blockers.push({ code: source.code, label: source.label, count })
    }
  }

  return blockers
}

async function listFolderFiles(
  admin: SupabaseClient,
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const files: string[] = []
  const queue: Array<{ folder: string; depth: number }> = [{ folder: prefix, depth: 0 }]
  const visited = new Set<string>()

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) continue
    if (current.depth > 8) throw new Error('Storage folder nesting limit exceeded')
    if (visited.has(current.folder)) continue
    visited.add(current.folder)

    for (let offset = 0; offset < 10000; offset += 500) {
      const { data, error } = await admin.storage.from(bucket).list(current.folder, {
        limit: 500,
        offset,
      })
      if (error) throw new Error(`could not list account-owned ${bucket} objects`)

      const entries = (data ?? []) as StorageEntry[]
      for (const entry of entries) {
        if (!entry.name) continue
        const objectPath = `${current.folder}/${entry.name}`

        if (entry.id) {
          files.push(objectPath)
          if (files.length > 10000) {
            throw new Error('Account Storage object limit exceeded')
          }
        } else {
          queue.push({ folder: objectPath, depth: current.depth + 1 })
        }
      }

      if (entries.length < 500) break
      if (offset >= 9500) throw new Error('Storage folder listing limit exceeded')
    }
  }

  return files
}

async function objectExists(
  admin: SupabaseClient,
  bucket: string,
  objectPath: string,
): Promise<boolean> {
  const separator = objectPath.lastIndexOf('/')
  const folder = separator >= 0 ? objectPath.slice(0, separator) : ''
  const fileName = separator >= 0 ? objectPath.slice(separator + 1) : objectPath
  const { data, error } = await admin.storage.from(bucket).list(folder, {
    limit: 100,
    search: fileName,
  })

  if (error) throw new Error(`could not verify retained ${bucket} object`)
  return (data ?? []).some((entry) => entry.name === fileName && Boolean(entry.id))
}

async function copyChatMediaIfMissing(
  admin: SupabaseClient,
  sourcePath: string,
  conversationId: string,
): Promise<string> {
  const extension = sourcePath.split('.').pop() ?? ''
  const safeExtension = /^[a-z0-9]{1,8}$/i.test(extension)
    ? extension.toLowerCase()
    : 'bin'
  const digest = createHash('sha256').update(sourcePath).digest('hex').slice(0, 32)
  const destinationPath = `retained/${conversationId}/${digest}.${safeExtension}`

  if (!(await objectExists(admin, 'chat-media', destinationPath))) {
    const { error } = await admin.storage
      .from('chat-media')
      .copy(sourcePath, destinationPath)

    // Two retries may race. A failed copy is acceptable only when another
    // request has already produced the deterministic destination object.
    if (error && !(await objectExists(admin, 'chat-media', destinationPath))) {
      throw new Error('could not copy a chat attachment to neutral Storage')
    }
  }

  if (!(await objectExists(admin, 'chat-media', destinationPath))) {
    throw new Error('retained chat attachment could not be verified')
  }

  return destinationPath
}

async function readAllOwnedMediaMessageReferences(
  admin: SupabaseClient,
  userId: string,
): Promise<MessageMediaReference[]> {
  const userPathPrefix = `${userId}/%`
  const userPathInUrl = `%/${userId}/%`
  const rows: MessageMediaReference[] = []

  for (
    let offset = 0;
    offset < ACCOUNT_DELETION_MAX_MESSAGE_ROWS;
    offset += ACCOUNT_DELETION_PAGE_SIZE
  ) {
    const { data, error } = await admin
      .from('messages')
      .select('id, conversation_id, sender_id, image_url, audio_url')
      .or(`image_url.ilike.${userPathPrefix},audio_url.ilike.${userPathPrefix},image_url.ilike.${userPathInUrl},audio_url.ilike.${userPathInUrl}`)
      .order('id', { ascending: true })
      .range(offset, offset + ACCOUNT_DELETION_PAGE_SIZE - 1)

    if (error) throw new Error('could not inspect chat-media references')

    const page = (data ?? []) as MessageMediaReference[]
    rows.push(...page)

    if (page.length < ACCOUNT_DELETION_PAGE_SIZE) return rows
  }

  throw new Error('chat-media reference count exceeds the safe account deletion limit')
}

async function rehomeRemainingReferences(
  admin: SupabaseClient,
  userId: string,
  mode: ChatDeletionMode,
): Promise<void> {
  const rows = await readAllOwnedMediaMessageReferences(admin, userId)
  const ownedSources = new Map<string, { conversationId: string; sourcePath: string }>()
  const referenceKey = (conversationId: string, sourcePath: string) =>
    `${conversationId}\\u0000${sourcePath}`

  for (const row of rows) {
    // In the explicitly destructive mode, the deleting user's own messages
    // are removed below. Other users' messages referencing the same owned
    // object are still preserved and re-homed.
    if (mode === 'delete_own_messages' && row.sender_id === userId) continue

    for (const value of [row.image_url, row.audio_url]) {
      const path = getChatMediaObjectPath(value)
      if (path?.startsWith(`${userId}/`)) {
        const key = referenceKey(row.conversation_id, path)
        ownedSources.set(key, { conversationId: row.conversation_id, sourcePath: path })
      }
    }
  }

  if (ownedSources.size === 0) return

  // A retained object belongs to exactly one conversation. If the same source
  // was reused in separate chats, copy it separately into each chat namespace.
  const retainedBySource = new Map<string, string>()
  for (const [key, source] of ownedSources) {
    retainedBySource.set(
      key,
      await copyChatMediaIfMissing(admin, source.sourcePath, source.conversationId),
    )
  }

  // Group identical attachment rewrites to avoid one HTTP round-trip per
  // message in large histories. Update every row before removing any source.
  // If one chunk fails, originals remain and retries reuse deterministic copies.
  const updateGroups = new Map<string, { patch: Record<string, string>; ids: string[] }>()

  for (const row of rows) {
    if (mode === 'delete_own_messages' && row.sender_id === userId) continue

    const imagePath = getChatMediaObjectPath(row.image_url)
    const audioPath = getChatMediaObjectPath(row.audio_url)
    const patch: Record<string, string> = {}

    const imageKey = imagePath ? referenceKey(row.conversation_id, imagePath) : null
    const audioKey = audioPath ? referenceKey(row.conversation_id, audioPath) : null

    if (imageKey && retainedBySource.has(imageKey)) {
      patch.image_url = retainedBySource.get(imageKey) as string
    }
    if (audioKey && retainedBySource.has(audioKey)) {
      patch.audio_url = retainedBySource.get(audioKey) as string
    }
    if (Object.keys(patch).length === 0) continue

    const key = JSON.stringify(patch)
    const group = updateGroups.get(key) ?? { patch, ids: [] }
    group.ids.push(row.id)
    updateGroups.set(key, group)
  }

  for (const { patch, ids } of updateGroups.values()) {
    for (let offset = 0; offset < ids.length; offset += ACCOUNT_DELETION_PAGE_SIZE) {
      const chunk = ids.slice(offset, offset + ACCOUNT_DELETION_PAGE_SIZE)
      const { data: updated, error: updateError } = await admin
        .from('messages')
        .update(patch)
        .in('id', chunk)
        .select('id')

      if (updateError || updated?.length !== chunk.length) {
        throw new Error(
          `could not update a message batch to its retained chat-media path (${updateError?.code ?? 'unknown'})`,
        )
      }
    }
  }
}

async function deleteOwnMessagesAndEmptyConversations(
  admin: SupabaseClient,
  userId: string,
): Promise<void> {
  const conversationIds = new Set<string>()
  let totalRows = 0

  for (
    let offset = 0;
    offset < ACCOUNT_DELETION_MAX_MESSAGE_ROWS;
    offset += ACCOUNT_DELETION_PAGE_SIZE
  ) {
    const { data, error } = await admin
      .from('messages')
      .select('conversation_id')
      .eq('sender_id', userId)
      .order('conversation_id', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + ACCOUNT_DELETION_PAGE_SIZE - 1)

    if (error) throw new Error('could not list messages selected for deletion')

    const page = data ?? []
    totalRows += page.length
    for (const row of page) {
      conversationIds.add(row.conversation_id as string)
    }

    if (page.length < ACCOUNT_DELETION_PAGE_SIZE) break
  }

  if (totalRows >= ACCOUNT_DELETION_MAX_MESSAGE_ROWS) {
    throw new Error('account message count exceeds the safe account deletion limit')
  }

  const { error: deleteError } = await admin
    .from('messages')
    .delete()
    .eq('sender_id', userId)

  if (deleteError) throw new Error('could not delete the selected account messages')

  for (const conversationId of conversationIds) {
    const { count, error: countError } = await admin
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('conversation_id', conversationId)

    if (countError || count === null) {
      throw new Error('could not verify whether a conversation became empty')
    }

    if (count === 0) {
      const { error: deleteConversationError } = await admin
        .from('conversations')
        .delete()
        .eq('id', conversationId)

      if (deleteConversationError) {
        throw new Error('could not remove an empty conversation')
      }
    }
  }
}

async function removeObjects(
  admin: SupabaseClient,
  bucket: string,
  paths: string[],
): Promise<void> {
  for (let index = 0; index < paths.length; index += 1000) {
    const chunk = paths.slice(index, index + 1000)
    if (chunk.length === 0) continue

    const { error } = await admin.storage.from(bucket).remove(chunk)
    if (error) {
      throw new Error(`could not remove account-owned objects from ${bucket}`)
    }
  }
}

/**
 * Idempotent server-side account cleanup. The caller must have authenticated
 * the current user, checked recent auth_time, and opened the deletion lock.
 *
 * Storage is always changed through the Storage API (never storage.objects SQL).
 * Auth deletion happens last, after the preflight and all known UID-prefixed
 * objects have been cleaned. Unknown/unowned legacy paths are never bulk-deleted.
 */
export async function executeAccountDeletion(
  admin: SupabaseClient,
  userId: string,
  mode: ChatDeletionMode,
): Promise<void> {
  if (mode === 'delete_own_messages') {
    await rehomeRemainingReferences(admin, userId, mode)
    await deleteOwnMessagesAndEmptyConversations(admin, userId)
  } else {
    await rehomeRemainingReferences(admin, userId, mode)
  }

  // All chat references to user-owned files have already moved or the
  // deleting user's own messages have been removed. Orphaned UID-prefixed
  // chat objects can now be safely removed.
  for (const bucket of ['chat-media', 'avatars', 'post-images']) {
    const files = await listFolderFiles(admin, bucket, userId)
    await removeObjects(admin, bucket, files)
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(userId)
  if (deleteError) {
    throw new Error('Supabase Auth refused account deletion after Storage cleanup')
  }
}

/**
 * Acquires a durable, server-only lock before retention preflight. Existing
 * locks are intentionally reusable after an interrupted partial attempt.
 */
export async function beginAccountDeletion(
  admin: SupabaseClient,
  userId: string,
  mode: ChatDeletionMode,
): Promise<ChatDeletionMode | null> {
  // A migration may have just introduced this RPC. PostgREST schema-cache
  // notifications are asynchronous, so retry only the specific stale-cache
  // response; permission and database errors must fail immediately.
  let lastError: { code?: string } | null = null

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data, error } = await admin.rpc('begin_account_deletion', {
      p_user_id: userId,
      p_chat_mode: mode,
    })

    if (!error) {
      return data === 'preserve' || data === 'delete_own_messages' ? data : null
    }

    lastError = error
    if (error.code !== 'PGRST202' || attempt === 4) break
    await new Promise((resolve) => setTimeout(resolve, 200))
  }

  throw new Error(
    `could not lock account for deletion (${lastError?.code ?? 'unknown database error'})`,
  )
}

export async function endAccountDeletion(
  admin: SupabaseClient,
  userId: string,
): Promise<void> {
  const { error } = await admin.rpc('end_account_deletion', {
    p_user_id: userId,
  })
  if (error) throw new Error('could not release account deletion lock')
}
