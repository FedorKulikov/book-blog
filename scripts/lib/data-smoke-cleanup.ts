import type { SupabaseClient } from '@supabase/supabase-js'
import { smokeAccountEmailMatches } from './smoke-account-config'

export type DataSmokeUser = {
  id: string
  email: string
}

type AdminClient = SupabaseClient<any>
type CountMap = Map<string, number>
type IdRow = { id: string }
type PostRow = { id: string; user_id: string; book_id: string | null }
type BookRow = { id: string; created_by: string | null }
type ReportRow = { id: string; reporter_id: string; post_id: string | null; comment_id?: string | null }
type NotificationRow = {
  id: string
  user_id: string
  actor_id: string
  post_id: string | null
  comment_id: string | null
  message_id: string | null
}
type ConversationRow = { id: string; user1_id: string; user2_id: string }
type MessageRow = { id: string; sender_id: string; conversation_id: string }
type CommentRow = { id: string; user_id: string; post_id: string }
type LikeRow = { user_id: string; post_id: string }
type BookmarkRow = { id: string; user_id: string; post_id: string }
type FollowRow = { follower_id: string; following_id: string }
type TicketRow = { id: string; user_id: string }
type TicketMessageRow = { id: string; sender_id: string; ticket_id: string }
type PostImageRow = { id: string; post_id: string }
type ExternalNewsRow = { id: string; created_by: string | null }
type ConsentInventoryRow = {
  user_id: string
  total_count: number | string
  active_count: number | string
  revoked_count: number | string
}
type StorageRow = { bucket: string; path: string }

type InventoryRow = {
  id: string
  email: string
  profiles: number
  posts: number
  books: number
  reports: number
  notifications: number
  consents: number
  active_consents: number
  revoked_consents: number
  storage_objects: number
  external_news: number
  conversations: number
  messages: number
  comments: number
  likes: number
  bookmarks: number
  follows: number
  tickets: number
  ticket_messages: number
  post_images: number
}

export type CleanupResiduals = {
  smoke_users_remaining: number
  consent_rows_remaining: number
  active_consents_remaining: number
  profiles_remaining: number
  posts_remaining: number
  books_remaining: number
  reports_remaining: number
  notifications_remaining: number
  storage_objects_remaining: number
  external_news_remaining: number
  conversations_remaining: number
  messages_remaining: number
  comments_remaining: number
  likes_remaining: number
  bookmarks_remaining: number
  follows_remaining: number
  tickets_remaining: number
  ticket_messages_remaining: number
  post_images_remaining: number
}

const PAGE_SIZE = 1000
const MAX_STORAGE_DEPTH = 16

function assertUserId(id: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('refusing to clean account with invalid Auth user id')
  }
}

function assertSmokeUsers(users: DataSmokeUser[]): void {
  for (const user of users) {
    if (!smokeAccountEmailMatches(user.email)) {
      throw new Error('refusing to clean non-smoke account: ' + user.email)
    }
    assertUserId(user.id)
  }
}

function uniqueRows<T extends { id: string }>(rows: T[]): T[] {
  return [...new Map(rows.map(row => [row.id, row])).values()]
}

function increment(map: CountMap, id: string | null | undefined): void {
  if (!id) return
  map.set(id, (map.get(id) ?? 0) + 1)
}

async function fetchAllRows<T>(
  queryForRange: (from: number, to: number) => PromiseLike<any>,
  label: string,
): Promise<T[]> {
  const rows: T[] = []
  let offset = 0

  while (true) {
    const result = await queryForRange(offset, offset + PAGE_SIZE - 1)
    const data = result.data as T[] | null
    const error = result.error as { code?: string; message?: string } | null
    if (error) {
      throw new Error('PostgREST read failed for ' + label + ' (' + (error.code ?? 'unknown') + ')')
    }
    const page = data ?? []
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
    offset += page.length
  }

  return rows
}

async function selectByIds<T>(
  admin: AdminClient,
  table: string,
  columns: string,
  column: string,
  ids: string[],
  label?: string,
): Promise<T[]> {
  if (ids.length === 0) return []
  return fetchAllRows<T>(
    (from, to) => admin.from(table).select(columns).in(column, ids).range(from, to),
    label ?? table,
  )
}

async function selectByEitherId<T>(
  admin: AdminClient,
  table: string,
  columns: string,
  firstColumn: string,
  secondColumn: string,
  ids: string[],
  label?: string,
): Promise<T[]> {
  if (ids.length === 0) return []
  const inList = '(' + ids.join(',') + ')'
  const expression = firstColumn + '.in.' + inList + ',' + secondColumn + '.in.' + inList
  return fetchAllRows<T>(
    (from, to) => admin.from(table).select(columns).or(expression).range(from, to),
    label ?? table,
  )
}

async function listStorageObjectsForSmokeUsers(
  admin: AdminClient,
  users: DataSmokeUser[],
): Promise<Map<string, StorageRow[]>> {
  const byUser = new Map<string, StorageRow[]>()
  if (users.length === 0) return byUser

  const userIds = new Set(users.map(user => user.id))
  const { data: buckets, error: bucketError } = await admin.storage.listBuckets()
  if (bucketError) {
    throw new Error('Storage bucket listing failed (' + bucketError.message + ')')
  }

  for (const bucket of buckets ?? []) {
    const walk = async (folder: string, ownerId: string | null, depth: number): Promise<void> => {
      if (depth > MAX_STORAGE_DEPTH) {
        throw new Error('Storage cleanup stopped: folder nesting exceeds safety limit')
      }

      let offset = 0
      while (true) {
        const { data, error } = await admin.storage.from(bucket.name).list(folder, {
          limit: PAGE_SIZE,
          offset,
        })
        if (error) {
          throw new Error('Storage listing failed for bucket ' + bucket.name + ' (' + error.message + ')')
        }

        const entries = data ?? []
        for (const entry of entries) {
          if (!entry.name || entry.name === '.' || entry.name === '..' || entry.name.includes('/')) {
            throw new Error('Storage listing returned an unsafe path component')
          }

          if (depth === 0) {
            if (entry.id == null && userIds.has(entry.name)) {
              await walk(entry.name, entry.name, 1)
            }
            continue
          }

          const objectPath = folder + '/' + entry.name
          if (entry.id == null) {
            await walk(objectPath, ownerId, depth + 1)
          } else if (ownerId && objectPath.startsWith(ownerId + '/')) {
            const objects = byUser.get(ownerId) ?? []
            objects.push({ bucket: bucket.name, path: objectPath })
            byUser.set(ownerId, objects)
          }
        }

        if (entries.length < PAGE_SIZE) break
        offset += entries.length
      }
    }

    await walk('', null, 0)
  }

  return byUser
}

async function getConsentInventory(
  admin: AdminClient,
  userIds: string[],
): Promise<Map<string, { total: number; active: number; revoked: number }>> {
  const result = new Map<string, { total: number; active: number; revoked: number }>()
  if (userIds.length === 0) return result

  const { data, error } = await admin.rpc('ops_smoke_consent_inventory', {
    p_user_ids: userIds,
  })
  if (error) {
    throw new Error('PostgREST smoke consent inventory RPC failed (' + (error.code ?? 'unknown') + ')')
  }

  for (const row of (data ?? []) as ConsentInventoryRow[]) {
    result.set(row.user_id, {
      total: Number(row.total_count),
      active: Number(row.active_count),
      revoked: Number(row.revoked_count),
    })
  }
  return result
}

export async function listDataSmokeUsers(admin: AdminClient): Promise<DataSmokeUser[]> {
  const users: DataSmokeUser[] = []
  let page = 1

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: PAGE_SIZE,
    })
    if (error) {
      throw new Error('Auth Admin user listing failed (' + (error.status ?? 'unknown') + ')')
    }

    for (const user of data.users) {
      if (user.email && smokeAccountEmailMatches(user.email)) {
        users.push({ id: user.id, email: user.email })
      }
    }

    if (data.users.length < PAGE_SIZE) break
    const nextPage = data.nextPage ? Number(data.nextPage) : page + 1
    if (!Number.isInteger(nextPage) || nextPage <= page) {
      throw new Error('Auth Admin pagination returned an invalid next page')
    }
    page = nextPage
  }

  return users.sort((a, b) => a.email.localeCompare(b.email))
}

export async function getDataSmokeInventory(
  admin: AdminClient,
  users: DataSmokeUser[],
): Promise<InventoryRow[]> {
  assertSmokeUsers(users)
  if (users.length === 0) return []

  const ids = users.map(user => user.id)
  const [
    profiles,
    posts,
    books,
    reportsByReporter,
    notificationsByRecipient,
    notificationsByActor,
    externalNews,
    conversations,
    messages,
    comments,
    likes,
    bookmarks,
    followsByFollower,
    followsByFollowing,
    tickets,
    ticketMessagesBySender,
    consents,
    storageByUser,
  ] = await Promise.all([
    selectByIds<IdRow>(admin, 'profiles', 'id', 'id', ids),
    selectByIds<PostRow>(admin, 'posts', 'id,user_id,book_id', 'user_id', ids),
    selectByIds<BookRow>(admin, 'books', 'id,created_by', 'created_by', ids),
    selectByIds<ReportRow>(admin, 'reports', 'id,reporter_id,post_id,comment_id', 'reporter_id', ids),
    selectByIds<NotificationRow>(admin, 'notifications', 'id,user_id,actor_id,post_id,comment_id,message_id', 'user_id', ids),
    selectByIds<NotificationRow>(admin, 'notifications', 'id,user_id,actor_id,post_id,comment_id,message_id', 'actor_id', ids),
    selectByIds<ExternalNewsRow>(admin, 'external_news', 'id,created_by', 'created_by', ids),
    selectByEitherId<ConversationRow>(admin, 'conversations', 'id,user1_id,user2_id', 'user1_id', 'user2_id', ids),
    selectByIds<MessageRow>(admin, 'messages', 'id,sender_id,conversation_id', 'sender_id', ids),
    selectByIds<CommentRow>(admin, 'comments', 'id,user_id,post_id', 'user_id', ids),
    selectByIds<LikeRow>(admin, 'likes', 'user_id,post_id', 'user_id', ids),
    selectByIds<BookmarkRow>(admin, 'bookmarks', 'id,user_id,post_id', 'user_id', ids),
    selectByIds<FollowRow>(admin, 'follows', 'follower_id,following_id', 'follower_id', ids),
    selectByIds<FollowRow>(admin, 'follows', 'follower_id,following_id', 'following_id', ids),
    selectByIds<TicketRow>(admin, 'tickets', 'id,user_id', 'user_id', ids),
    selectByIds<TicketMessageRow>(admin, 'ticket_messages', 'id,sender_id,ticket_id', 'sender_id', ids),
    getConsentInventory(admin, ids),
    listStorageObjectsForSmokeUsers(admin, users),
  ])

  const postIds = posts.map(row => row.id)
  const ticketIds = tickets.map(row => row.id)
  const [reportsByPost, ticketMessagesByTicket, postImages] = await Promise.all([
    selectByIds<ReportRow>(admin, 'reports', 'id,reporter_id,post_id,comment_id', 'post_id', postIds),
    selectByIds<TicketMessageRow>(admin, 'ticket_messages', 'id,sender_id,ticket_id', 'ticket_id', ticketIds),
    selectByIds<PostImageRow>(admin, 'post_images', 'id,post_id', 'post_id', postIds),
  ])

  const reportRows = uniqueRows([...reportsByReporter, ...reportsByPost])
  const notificationRows = uniqueRows([...notificationsByRecipient, ...notificationsByActor])
  const followRows = [...new Map([...followsByFollower, ...followsByFollowing].map(row => [row.follower_id + ':' + row.following_id, row])).values()]
  const ticketMessageRows = uniqueRows([...ticketMessagesBySender, ...ticketMessagesByTicket])
  const postOwnerById = new Map(posts.map(post => [post.id, post.user_id]))
  const rows: InventoryRow[] = []

  for (const user of users) {
    const ownedPostIds = new Set(posts.filter(post => post.user_id === user.id).map(post => post.id))
    const ownedTicketIds = new Set(tickets.filter(ticket => ticket.user_id === user.id).map(ticket => ticket.id))
    const consent = consents.get(user.id) ?? { total: 0, active: 0, revoked: 0 }
    rows.push({
      id: user.id,
      email: user.email,
      profiles: profiles.filter(row => row.id === user.id).length,
      posts: posts.filter(row => row.user_id === user.id).length,
      books: books.filter(row => row.created_by === user.id).length,
      reports: reportRows.filter(row =>
        row.reporter_id === user.id || (row.post_id != null && postOwnerById.get(row.post_id) === user.id),
      ).length,
      notifications: notificationRows.filter(row => row.user_id === user.id || row.actor_id === user.id).length,
      consents: consent.total,
      active_consents: consent.active,
      revoked_consents: consent.revoked,
      storage_objects: storageByUser.get(user.id)?.length ?? 0,
      external_news: externalNews.filter(row => row.created_by === user.id).length,
      conversations: conversations.filter(row => row.user1_id === user.id || row.user2_id === user.id).length,
      messages: messages.filter(row => row.sender_id === user.id).length,
      comments: comments.filter(row => row.user_id === user.id).length,
      likes: likes.filter(row => row.user_id === user.id).length,
      bookmarks: bookmarks.filter(row => row.user_id === user.id).length,
      follows: followRows.filter(row => row.follower_id === user.id || row.following_id === user.id).length,
      tickets: tickets.filter(row => row.user_id === user.id).length,
      ticket_messages: ticketMessageRows.filter(row =>
        row.sender_id === user.id || ownedTicketIds.has(row.ticket_id),
      ).length,
      post_images: postImages.filter(row => ownedPostIds.has(row.post_id)).length,
    })
  }

  return rows
}

export async function assertNoForeignContentWouldBeCascadeDeleted(
  admin: AdminClient,
  users: DataSmokeUser[],
): Promise<void> {
  assertSmokeUsers(users)
  if (users.length === 0) return

  const ids = users.map(user => user.id)
  const [
    smokePosts,
    smokeBooks,
    smokeTickets,
    smokeComments,
    smokeMessages,
    smokeConversations,
  ] = await Promise.all([
    selectByIds<PostRow>(admin, 'posts', 'id,user_id,book_id', 'user_id', ids),
    selectByIds<BookRow>(admin, 'books', 'id,created_by', 'created_by', ids),
    selectByIds<TicketRow>(admin, 'tickets', 'id,user_id', 'user_id', ids),
    selectByIds<CommentRow>(admin, 'comments', 'id,user_id,post_id', 'user_id', ids),
    selectByIds<MessageRow>(admin, 'messages', 'id,sender_id,conversation_id', 'sender_id', ids),
    selectByEitherId<ConversationRow>(admin, 'conversations', 'id,user1_id,user2_id', 'user1_id', 'user2_id', ids),
  ])

  const postIds = smokePosts.map(row => row.id)
  const bookIds = smokeBooks.map(row => row.id)
  const ticketIds = smokeTickets.map(row => row.id)
  const commentIds = smokeComments.map(row => row.id)
  const messageIds = smokeMessages.map(row => row.id)
  const conversationIds = smokeConversations.map(row => row.id)

  const [
    commentsOnPosts,
    likesOnPosts,
    bookmarksOnPosts,
    reportsOnPosts,
    reportsOnComments,
    notificationsOnPosts,
    notificationsOnComments,
    notificationsOnMessages,
    notificationsByActor,
    messagesInConversations,
    ticketMessages,
    ticketMessagesBySmokeSender,
    postsOnSmokeBooks,
  ] = await Promise.all([
    selectByIds<CommentRow>(admin, 'comments', 'id,user_id,post_id', 'post_id', postIds),
    selectByIds<LikeRow>(admin, 'likes', 'user_id,post_id', 'post_id', postIds),
    selectByIds<BookmarkRow>(admin, 'bookmarks', 'id,user_id,post_id', 'post_id', postIds),
    selectByIds<ReportRow>(admin, 'reports', 'id,reporter_id,post_id,comment_id', 'post_id', postIds),
    selectByIds<ReportRow>(admin, 'reports', 'id,reporter_id,post_id,comment_id', 'comment_id', commentIds),
    selectByIds<NotificationRow>(admin, 'notifications', 'id,user_id,actor_id,post_id,comment_id,message_id', 'post_id', postIds),
    selectByIds<NotificationRow>(admin, 'notifications', 'id,user_id,actor_id,post_id,comment_id,message_id', 'comment_id', commentIds),
    selectByIds<NotificationRow>(admin, 'notifications', 'id,user_id,actor_id,post_id,comment_id,message_id', 'message_id', messageIds),
    selectByIds<NotificationRow>(admin, 'notifications', 'id,user_id,actor_id,post_id,comment_id,message_id', 'actor_id', ids),
    selectByIds<MessageRow>(admin, 'messages', 'id,sender_id,conversation_id', 'conversation_id', conversationIds),
    selectByIds<TicketMessageRow>(admin, 'ticket_messages', 'id,sender_id,ticket_id', 'ticket_id', ticketIds),
    selectByIds<TicketMessageRow>(admin, 'ticket_messages', 'id,sender_id,ticket_id', 'sender_id', ids),
    selectByIds<PostRow>(admin, 'posts', 'id,user_id,book_id', 'book_id', bookIds),
  ])

  const smokeIdSet = new Set(ids)
  const smokeTicketIdSet = new Set(ticketIds)
  const mixedConversations = smokeConversations.filter(row =>
    (smokeIdSet.has(row.user1_id) && !smokeIdSet.has(row.user2_id)) ||
    (smokeIdSet.has(row.user2_id) && !smokeIdSet.has(row.user1_id)),
  ).length

  const risks = {
    mixed_conversations: mixedConversations,
    foreign_messages_in_smoke_conversations: messagesInConversations.filter(row => !smokeIdSet.has(row.sender_id)).length,
    foreign_comments_on_smoke_posts: commentsOnPosts.filter(row => !smokeIdSet.has(row.user_id)).length,
    foreign_likes_on_smoke_posts: likesOnPosts.filter(row => !smokeIdSet.has(row.user_id)).length,
    foreign_bookmarks_on_smoke_posts: bookmarksOnPosts.filter(row => !smokeIdSet.has(row.user_id)).length,
    foreign_reports_on_smoke_posts: reportsOnPosts.filter(row => !smokeIdSet.has(row.reporter_id)).length,
    foreign_reports_on_smoke_comments: reportsOnComments.filter(row => !smokeIdSet.has(row.reporter_id)).length,
    foreign_notifications_on_smoke_posts: notificationsOnPosts.filter(row => !smokeIdSet.has(row.user_id)).length,
    foreign_notifications_on_smoke_comments: notificationsOnComments.filter(row => !smokeIdSet.has(row.user_id)).length,
    foreign_notifications_on_smoke_messages: notificationsOnMessages.filter(row => !smokeIdSet.has(row.user_id)).length,
    foreign_recipients_of_smoke_actor_notifications: notificationsByActor.filter(row => !smokeIdSet.has(row.user_id)).length,
    foreign_ticket_messages: ticketMessages.filter(row => !smokeIdSet.has(row.sender_id)).length,
    smoke_authored_messages_in_foreign_tickets: ticketMessagesBySmokeSender.filter(row => !smokeTicketIdSet.has(row.ticket_id)).length,
    foreign_posts_referencing_smoke_books: postsOnSmokeBooks.filter(row => !smokeIdSet.has(row.user_id)).length,
  }

  const riskCount = Object.values(risks).reduce((sum, count) => sum + count, 0)
  if (riskCount > 0) {
    throw new Error('cleanup blocked: non-smoke content would be affected (' + JSON.stringify(risks) + ')')
  }
}

export async function cleanupSmokeUsers(
  admin: AdminClient,
  users: DataSmokeUser[],
): Promise<CleanupResiduals> {
  assertSmokeUsers(users)
  if (users.length === 0) return verifySmokeCleanup(admin, users)

  await assertNoForeignContentWouldBeCascadeDeleted(admin, users)

  const ids = users.map(user => user.id)
  const storageByUser = await listStorageObjectsForSmokeUsers(admin, users)
  const storageByBucket = new Map<string, string[]>()

  for (const objects of storageByUser.values()) {
    for (const object of objects) {
      const expectedPrefix = users.find(user => object.path.startsWith(user.id + '/'))?.id
      if (!expectedPrefix || !object.path.startsWith(expectedPrefix + '/')) {
        throw new Error('refusing to remove Storage object outside a smoke account prefix')
      }
      const paths = storageByBucket.get(object.bucket) ?? []
      paths.push(object.path)
      storageByBucket.set(object.bucket, paths)
    }
  }

  for (const [bucket, paths] of storageByBucket) {
    for (let offset = 0; offset < paths.length; offset += 100) {
      const { error } = await admin.storage.from(bucket).remove(paths.slice(offset, offset + 100))
      if (error) {
        throw new Error('Storage deletion failed for bucket ' + bucket + ' (' + error.message + ')')
      }
    }
  }

  const books = await admin.from('books').delete().in('created_by', ids)
  if (books.error) {
    throw new Error('book deletion failed (' + (books.error.code ?? 'unknown') + ')')
  }

  const externalNews = await admin.from('external_news').delete().in('created_by', ids)
  if (externalNews.error) {
    throw new Error('external news deletion failed (' + (externalNews.error.code ?? 'unknown') + ')')
  }

  // Auth deletion cascades profiles, posts, reports, notifications and the full
  // consent history (active and revoked). No consent is inserted or revoked here.
  for (const user of users) {
    const { data: current, error: lookupError } = await admin.auth.admin.getUserById(user.id)
    if (lookupError) {
      if (lookupError.status === 404) continue
      throw new Error('Auth lookup failed for ' + user.email + ' (status=' + (lookupError.status ?? 'unknown') + ')')
    }
    if (current.user.email?.toLowerCase() !== user.email.toLowerCase()) {
      throw new Error('Auth email changed for manifest ID ' + user.id + '; refusing deletion')
    }
    const { error } = await admin.auth.admin.deleteUser(user.id)
    if (error) {
      throw new Error('Auth deletion failed for ' + user.email + ' (status=' + (error.status ?? 'unknown') + ')')
    }
  }

  return verifySmokeCleanup(admin, users)
}

export async function verifySmokeCleanup(
  admin: AdminClient,
  deletedUsers: DataSmokeUser[],
): Promise<CleanupResiduals> {
  assertSmokeUsers(deletedUsers)
  const currentSmokeUsers = await listDataSmokeUsers(admin)
  const inventory = await getDataSmokeInventory(admin, deletedUsers)

  const sum = (field: keyof InventoryRow) =>
    inventory.reduce((total, row) => total + Number(row[field] ?? 0), 0)

  return {
    smoke_users_remaining: currentSmokeUsers.length,
    consent_rows_remaining: sum('consents'),
    active_consents_remaining: sum('active_consents'),
    profiles_remaining: sum('profiles'),
    posts_remaining: sum('posts'),
    books_remaining: sum('books'),
    reports_remaining: sum('reports'),
    notifications_remaining: sum('notifications'),
    storage_objects_remaining: sum('storage_objects'),
    external_news_remaining: sum('external_news'),
    conversations_remaining: sum('conversations'),
    messages_remaining: sum('messages'),
    comments_remaining: sum('comments'),
    likes_remaining: sum('likes'),
    bookmarks_remaining: sum('bookmarks'),
    follows_remaining: sum('follows'),
    tickets_remaining: sum('tickets'),
    ticket_messages_remaining: sum('ticket_messages'),
    post_images_remaining: sum('post_images'),
  }
}
