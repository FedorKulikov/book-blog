import type { SupabaseClient } from '@supabase/supabase-js'

export type PublicationAuthorDetails = {
  username: string | null
  avatar_url: string | null
  can_read_profile: boolean
}

type PublicationAuthorRow = {
  post_id: string
  user_id: string
  username: string | null
  avatar_url: string | null
  can_read_profile: boolean
}

type PublicationPost = {
  id: string
  profiles?: unknown
}

/**
 * Post RLS can allow a publication while profiles RLS correctly hides the
 * author's full profile row. Fetch only the two author fields covered by the
 * publication consent, plus a boolean controlling profile-page navigation.
 */
export async function attachPublicationAuthorDetails<T extends PublicationPost>(
  supabase: SupabaseClient,
  posts: T[],
): Promise<Array<Omit<T, 'profiles'> & { profiles: PublicationAuthorDetails | null }>> {
  if (posts.length === 0) return []

  const postIds = [...new Set(posts.map(post => post.id))]
  const { data, error } = await supabase.rpc('get_publication_author_details', {
    p_post_ids: postIds,
  })

  if (error || !Array.isArray(data)) {
    console.error('[publication-author-details] author lookup failed:', error?.message ?? 'empty RPC result')
    return posts.map(({ profiles: _profiles, ...post }) => ({
      ...post,
      profiles: null,
    })) as Array<Omit<T, 'profiles'> & { profiles: PublicationAuthorDetails | null }>
  }

  const authorsByPostId = new Map<string, PublicationAuthorDetails>()
  for (const row of data as PublicationAuthorRow[]) {
    authorsByPostId.set(row.post_id, {
      username: row.username,
      avatar_url: row.avatar_url,
      can_read_profile: row.can_read_profile,
    })
  }

  return posts.map(({ profiles: _profiles, ...post }) => ({
    ...post,
    profiles: authorsByPostId.get(post.id) ?? null,
  })) as Array<Omit<T, 'profiles'> & { profiles: PublicationAuthorDetails | null }>
}
