// app/profile/[username]/getProfile.ts
// Данные публичного профиля: page.tsx и generateMetadata получают их
// из одного вызова благодаря cache().
import { cache } from 'react'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { PostCardData } from '@/app/components/PostCard'
import { POSTS_SELECT } from '@/app/posts/postsQuery'

export type ProfileRow = {
  id: string
  username: string | null
  avatar_url: string | null
  bio: string | null
  role: string | null
  created_at: string
}

export type ProfilePageData = {
  // username гарантированно есть: профиль искали именно по нему
  profile: ProfileRow & { username: string }
  posts: PostCardData[]
  stats: { posts: number; likes: number; comments: number }
}

export const getProfile = cache(
  async (username: string): Promise<ProfilePageData | null> => {
    const supabase = await createSupabaseServerClient()

    const { data: profileData, error } = await supabase
      .from('profiles')
      .select('id, username, avatar_url, bio, role, created_at')
      .eq('username', username)
      .maybeSingle()

    if (error) {
      console.error('[getProfile] profiles select failed:', error.message)
      return null
    }
    if (!profileData) return null

    const row = profileData as unknown as ProfileRow
    const profile: ProfileRow & { username: string } = {
      ...row,
      username: row.username ?? username,
    }

    // Куки текущего запроса: владелец профиля увидит и свои посты на модерации
    const { data: { user } } = await supabase.auth.getUser()

    let postsQuery = supabase
      .from('posts')
      .select(POSTS_SELECT)
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false })

    postsQuery =
      user && user.id === profile.id
        ? postsQuery.or(`status.eq.approved,user_id.eq.${profile.id}`)
        : postsQuery.eq('status', 'approved')

    const { data: postsData, error: postsError } = await postsQuery

    if (postsError) {
      console.error('[getProfile] posts select failed:', postsError.message)
    }

    const posts = (postsData ?? []) as unknown as PostCardData[]
    const postIds = posts.map(p => p.id)

    let likes = 0
    let comments = 0

    if (postIds.length > 0) {
      const { count: likesCount } = await supabase
        .from('likes')
        .select('*', { count: 'exact', head: true })
        .in('post_id', postIds)
      likes = likesCount ?? 0

      const { count: commentsCount } = await supabase
        .from('comments')
        .select('*', { count: 'exact', head: true })
        .in('post_id', postIds)
      comments = commentsCount ?? 0
    }

    return {
      profile,
      posts,
      stats: { posts: posts.length, likes, comments },
    }
  },
)
