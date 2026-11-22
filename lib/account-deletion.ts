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
  sender_id: string | null
  image_url: string | null
  audio_url: string | null
}

type StorageEntry = {
  name: string
  id?: string | null
  metadata?: unknown
}

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
    const { count, error } = await admin
      .from(source.table)
      .select('*', { count: 'exact', head: true })
      .eq(source.column, userId)

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
): Promise<string> {
  const extension = sourcePath.split('.').pop() ?? ''
  const safeExtension = /^[a-z0-9]{1,8}$/i.test(extension)
    ? extension.toLowerCase()
    : 'bin'
  const digest = createHash('sha256').update(sourcePath).digest('hex').slice(0, 32)
  const destinationPath = `retained/${digest}.${safeExtension}`

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

async function rehomeRemainingReferences(
  admin: SupabaseClient,
  userId: string,
  mode: ChatDeletionMode,
): Promise<void> {
  const userPathPrefix = `${userId}/%`
  const userPathInUrl = `%/${userId}/%`
  const { data, error } = await admin
    .from('messages')
    .select('id, sender_id, image_url, audio_url')
    .or(`image_url.ilike.${userPathPrefix},audio_url.ilike.${userPathPrefix},image_url.ilike.${userPathInUrl},audio_url.ilike.${userPathInUrl}`)

  if (error) throw new Error('could not inspect chat-media references')

  const rows = (data ?? []) as MessageMediaReference[]
  const ownedSources = new Set<string>()

  for (const row of rows) {
    // In the explicitly destructive mode, the deleting user's own messages
    // are removed below. Other users' messages referencing the same owned
    // object are still preserved and re-homed.
    if (mode === 'delete_own_messages' && row.sender_id === userId) continue

    for (const value of [row.image_url, row.audio_url]) {
      const path = getChatMediaObjectPath(value)
      if (path?.startsWith(`${userId}/`)) ownedSources.add(path)
    }
  }

  if (ownedSources.size === 0) return

  const retainedBySource = new Map<string, string>()
  for (const sourcePath of ownedSources) {
    retainedBySource.set(
      sourcePath,
      await copyChatMediaIfMissing(admin, sourcePath),
    )
  }

  // Update every row before removing any original. If one update fails, the
  // originals remain and a retry reuses the deterministic staged copies.
  for (const row of rows) {
    if (mode === 'delete_own_messages' && row.sender_id === userId) continue

    const imagePath = getChatMediaObjectPath(row.image_url)
    const audioPath = getChatMediaObjectPath(row.audio_url)
    const patch: Record<string, string> = {}

    if (imagePath && retainedBySource.has(imagePath)) {
      patch.image_url = retainedBySource.get(imagePath) as string
    }
    if (audioPath && retainedBySource.has(audioPath)) {
      patch.audio_url = retainedBySource.get(audioPath) as string
    }
    if (Object.keys(patch).length === 0) continue

    const { data: updated, error: updateError } = await admin
      .from('messages')
      .update(patch)
      .eq('id', row.id)
      .select('id')

    if (updateError || updated?.length !== 1) {
      throw new Error('could not update a message to its retained chat-media path')
    }
  }
}

async function deleteOwnMessagesAndEmptyConversations(
  admin: SupabaseClient,
  userId: string,
): Promise<void> {
  const { data, error: readError } = await admin
    .from('messages')
    .select('id, conversation_id')
    .eq('sender_id', userId)

  if (readError) throw new Error('could not list messages selected for deletion')
  const conversationIds = Array.from(
    new Set((data ?? []).map((row) => row.conversation_id as string)),
  )

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
  const { data, error } = await admin.rpc('begin_account_deletion', {
    p_user_id: userId,
    p_chat_mode: mode,
  })
  if (error) throw new Error('could not lock account for deletion')
  return data === 'preserve' || data === 'delete_own_messages' ? data : null
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
