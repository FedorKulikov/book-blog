import type { SupabaseClient } from '@supabase/supabase-js'
import { smokeAccountEmailLikeSql, smokeAccountEmailMatches } from './smoke-account-config'

export type DataSmokeUser = {
  id: string
  email: string
}

type AdminClient = SupabaseClient<any>

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

type StorageRow = { bucket_id: string; name: string }

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
}

const DATA_SMOKE_EMAIL = /^data-smoke-[^@\s]+@example\.com$/i
const PAGE_SIZE = 1000

function assertDataSmokeUsers(users: DataSmokeUser[]): void {
  for (const user of users) {
    if (!smokeAccountEmailMatches(user.email)) {
      throw new Error(`refusing to clean non-data-smoke account: ${user.email}`)
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(user.id)) {
      throw new Error('refusing to clean account with invalid Auth user id')
    }
  }
}

function uuidArray(ids: string[]): string {
  return ids.length
    ? `ARRAY[${ids.map(id => `'${id}'::uuid`).join(',')}]::uuid[]`
    : 'ARRAY[]::uuid[]'
}

function textArray(ids: string[]): string {
  return ids.length
    ? `ARRAY[${ids.map(id => `'${id}'`).join(',')}]::text[]`
    : 'ARRAY[]::text[]'
}

async function managementReadOnlyQuery<T>(
  projectRef: string,
  accessToken: string,
  query: string,
): Promise<T[]> {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query/read-only`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ query }),
    },
  )
  const body = await response.text()
  if (!response.ok) {
    throw new Error(`Supabase read-only SQL verification failed (HTTP ${response.status})`)
  }

  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch {
    throw new Error('Supabase read-only SQL verification returned invalid JSON')
  }

  if (Array.isArray(payload)) return payload as T[]
  if (payload && typeof payload === 'object') {
    const record = payload as { rows?: unknown; result?: unknown; data?: unknown }
    if (Array.isArray(record.rows)) return record.rows as T[]
    if (Array.isArray(record.result)) return record.result as T[]
    if (Array.isArray(record.data)) return record.data as T[]
  }
  throw new Error('Supabase read-only SQL verification returned an unexpected response')
}

export async function listDataSmokeUsers(admin: AdminClient): Promise<DataSmokeUser[]> {
  const users: DataSmokeUser[] = []
  let page = 1

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: PAGE_SIZE,
    })
    if (error) throw new Error(`could not list Auth users (${error.status ?? 'unknown'})`)

    for (const user of data.users) {
      if (user.email && smokeAccountEmailMatches(user.email)) {
        users.push({ id: user.id, email: user.email })
      }
    }

    if (!data.nextPage) break
    const nextPage = Number(data.nextPage)
    if (!Number.isInteger(nextPage) || nextPage <= page) {
      throw new Error('Auth user pagination returned an invalid next page')
    }
    page = nextPage
  }

  return users.sort((a, b) => a.email.localeCompare(b.email))
}

export async function getDataSmokeInventory(
  projectRef: string,
  accessToken: string,
  users: DataSmokeUser[],
): Promise<InventoryRow[]> {
  assertDataSmokeUsers(users)
  const ids = uuidArray(users.map(user => user.id))
  return managementReadOnlyQuery<InventoryRow>(projectRef, accessToken, `
    select
      u.id::text as id,
      u.email,
      (select count(*)::int from public.profiles p where p.id = u.id) as profiles,
      (select count(*)::int from public.posts p where p.user_id = u.id) as posts,
      (select count(*)::int from public.books b where b.created_by = u.id) as books,
      (select count(*)::int from public.reports r
        where r.reporter_id = u.id
           or r.post_id in (select p.id from public.posts p where p.user_id = u.id)) as reports,
      (select count(*)::int from public.notifications n
        where n.user_id = u.id or n.actor_id = u.id) as notifications,
      (select count(*)::int from private.personal_data_consents c where c.user_id = u.id) as consents,
      (select count(*)::int from private.personal_data_consents c
        where c.user_id = u.id and c.revoked_at is null) as active_consents,
      (select count(*)::int from private.personal_data_consents c
        where c.user_id = u.id and c.revoked_at is not null) as revoked_consents,
      (select count(*)::int from storage.objects o where o.owner_id = u.id::text) as storage_objects,
      (select count(*)::int from public.external_news e where e.created_by = u.id) as external_news,
      (select count(*)::int from public.conversations c where c.user1_id = u.id or c.user2_id = u.id) as conversations,
      (select count(*)::int from public.messages m where m.sender_id = u.id) as messages,
      (select count(*)::int from public.comments c where c.user_id = u.id) as comments,
      (select count(*)::int from public.likes l where l.user_id = u.id) as likes,
      (select count(*)::int from public.bookmarks b where b.user_id = u.id) as bookmarks,
      (select count(*)::int from public.follows f where f.follower_id = u.id or f.following_id = u.id) as follows,
      (select count(*)::int from public.tickets t where t.user_id = u.id) as tickets,
      (select count(*)::int from public.ticket_messages tm where tm.sender_id = u.id) as ticket_messages,
      (select count(*)::int from public.post_images i
        where i.post_id in (select p.id from public.posts p where p.user_id = u.id)) as post_images
    from auth.users u
    where u.id = any(${ids})
    order by u.email;
  `)
}

export async function assertNoForeignContentWouldBeCascadeDeleted(
  projectRef: string,
  accessToken: string,
): Promise<void> {
  const rows = await managementReadOnlyQuery<{
    mixed_conversations: number
    foreign_comments: number
    foreign_likes: number
    foreign_bookmarks: number
    foreign_reports: number
    foreign_notifications: number
    foreign_ticket_messages: number
  }>(projectRef, accessToken, `
    with smoke_users as (
      select id from auth.users
       where ${smokeAccountEmailLikeSql('lower(email)')}
    ),
    smoke_posts as (
      select p.id from public.posts p join smoke_users u on u.id = p.user_id
    ),
    smoke_tickets as (
      select t.id from public.tickets t join smoke_users u on u.id = t.user_id
    )
    select
      (select count(*)::int from public.conversations c
        where (c.user1_id in (select id from smoke_users) and c.user2_id not in (select id from smoke_users))
           or (c.user2_id in (select id from smoke_users) and c.user1_id not in (select id from smoke_users))) as mixed_conversations,
      (select count(*)::int from public.comments c
        where c.post_id in (select id from smoke_posts)
          and c.user_id not in (select id from smoke_users)) as foreign_comments,
      (select count(*)::int from public.likes l
        where l.post_id in (select id from smoke_posts)
          and l.user_id not in (select id from smoke_users)) as foreign_likes,
      (select count(*)::int from public.bookmarks b
        where b.post_id in (select id from smoke_posts)
          and b.user_id not in (select id from smoke_users)) as foreign_bookmarks,
      (select count(*)::int from public.reports r
        where r.post_id in (select id from smoke_posts)
          and r.reporter_id not in (select id from smoke_users)) as foreign_reports,
      (select count(*)::int from public.notifications n
        where n.post_id in (select id from smoke_posts)
          and n.user_id not in (select id from smoke_users)) as foreign_notifications,
      (select count(*)::int from public.ticket_messages tm
        where tm.ticket_id in (select id from smoke_tickets)
          and tm.sender_id not in (select id from smoke_users)) as foreign_ticket_messages;
  `)
  if (rows.length !== 1) {
    throw new Error('Could not verify cross-account cleanup safety')
  }
  const risks = rows[0]
  const riskTotal = Object.values(risks).reduce((sum, count) => sum + count, 0)
  if (riskTotal > 0) {
    throw new Error(`cleanup blocked: non-data-smoke content would be cascade-deleted (${JSON.stringify(risks)})`)
  }
}

export async function cleanupSmokeUsers(
  admin: AdminClient,
  projectRef: string,
  accessToken: string,
  users: DataSmokeUser[],
): Promise<CleanupResiduals> {
  assertDataSmokeUsers(users)
  const ids = users.map(user => user.id)
  const idsSql = uuidArray(ids)
  const idsTextSql = textArray(ids)

  if (ids.length === 0) {
    return verifySmokeCleanup(projectRef, accessToken, ids)
  }

  await assertNoForeignContentWouldBeCascadeDeleted(projectRef, accessToken)

  // Storage objects must be removed through the Storage API before Auth deletion.
  const storageRows = await managementReadOnlyQuery<StorageRow>(
    projectRef,
    accessToken,
    `select bucket_id, name
       from storage.objects
      where owner_id = any(${idsTextSql})
      order by bucket_id, name;`,
  )
  const byBucket = new Map<string, string[]>()
  for (const object of storageRows) {
    if (!object.bucket_id || !object.name) {
      throw new Error('Storage inventory returned an incomplete object reference')
    }
    const paths = byBucket.get(object.bucket_id) ?? []
    paths.push(object.name)
    byBucket.set(object.bucket_id, paths)
  }

  for (const [bucket, paths] of byBucket) {
    for (let offset = 0; offset < paths.length; offset += 100) {
      const batch = paths.slice(offset, offset + 100)
      const { error } = await admin.storage.from(bucket).remove(batch)
      if (error) throw new Error(`Storage cleanup failed for ${bucket} (${error.message})`)
    }
  }

  // These relations use ON DELETE SET NULL rather than CASCADE from profiles.
  const books = await admin.from('books').delete().in('created_by', ids)
  if (books.error) throw new Error(`book cleanup failed (${books.error.code ?? 'unknown'})`)

  const externalNews = await admin.from('external_news').delete().in('created_by', ids)
  if (externalNews.error) {
    throw new Error(`external news cleanup failed (${externalNews.error.code ?? 'unknown'})`)
  }

  // Auth deletion cascades profiles, posts, reports, notifications, and consent
  // history (including revoked rows). Never revoke/insert consent on behalf of users.
  for (const user of users) {
    const { error } = await admin.auth.admin.deleteUser(user.id)
    if (error) {
      throw new Error(`Auth deletion failed for ${user.email} (${error.status ?? 'unknown'})`)
    }
  }

  return verifySmokeCleanup(projectRef, accessToken, ids)
}

export async function verifySmokeCleanup(
  projectRef: string,
  accessToken: string,
  deletedUserIds: string[],
): Promise<CleanupResiduals> {
  assertDataSmokeUsers(deletedUserIds.map(id => ({ id, email: `data-smoke-verified-${id}@example.com` })))
  const ids = uuidArray(deletedUserIds)
  const textIds = textArray(deletedUserIds)
  const rows = await managementReadOnlyQuery<CleanupResiduals>(projectRef, accessToken, `
    select
      (select count(*)::int from auth.users u
        where ${smokeAccountEmailLikeSql('lower(u.email)')}) as smoke_users_remaining,
      (select count(*)::int from private.personal_data_consents c
        where c.user_id = any(${ids})) as consent_rows_remaining,
      (select count(*)::int from private.personal_data_consents c
        where c.user_id = any(${ids}) and c.revoked_at is null) as active_consents_remaining,
      (select count(*)::int from public.profiles p where p.id = any(${ids})) as profiles_remaining,
      (select count(*)::int from public.posts p where p.user_id = any(${ids})) as posts_remaining,
      (select count(*)::int from public.books b where b.created_by = any(${ids})) as books_remaining,
      (select count(*)::int from public.reports r
        where r.reporter_id = any(${ids})
           or r.post_id in (select p.id from public.posts p where p.user_id = any(${ids}))) as reports_remaining,
      (select count(*)::int from public.notifications n
        where n.user_id = any(${ids}) or n.actor_id = any(${ids})) as notifications_remaining,
      (select count(*)::int from storage.objects o
        where o.owner_id = any(${textIds})) as storage_objects_remaining,
      (select count(*)::int from public.external_news e where e.created_by = any(${ids})) as external_news_remaining;
  `)
  if (rows.length !== 1) {
    throw new Error('Cleanup verification did not return exactly one residual-count row')
  }
  return rows[0]
}
