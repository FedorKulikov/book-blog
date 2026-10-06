'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { humanizeError } from '@/lib/errors'
import FollowButton from './FollowButton'
import UnreadMessagesBadge from './UnreadMessagesBadge'
import {
  User,
  BookOpen,
  Mail,
  UserPlus,
  Shield,
  Calendar,
  ExternalLink,
  UserX,
  UserCheck,
} from './icons'

type Profile = {
  id: string
  username: string
  avatar_url: string | null
  bio: string | null
  created_at: string | null
  role: string | null
}

function PanelLink({
  href,
  Icon,
  label,
  count,
  badge = false,
  active,
}: {
  href: string
  Icon: typeof User
  label: string
  count?: number
  badge?: boolean
  active?: boolean
}) {
  const pathname = usePathname()
  const isActive = active ?? pathname === href
  const isExternal = href.startsWith('http')

  const content = (
    <>
      <Icon size={16} strokeWidth={1.8} className="text-emerald-mid flex-shrink-0" />
      <span className="flex-1 truncate">{label}</span>
      {typeof count === 'number' && (
        <span className="text-xs text-brown/50 flex-shrink-0">{count}</span>
      )}
      {badge && <UnreadMessagesBadge />}
    </>
  )

  const classes = `flex items-center gap-3 px-5 py-2.5 text-sm transition-colors ${
    isActive
      ? 'bg-cream-warm/60 text-emerald-dark font-medium'
      : 'text-brown-dark hover:bg-cream-warm/40'
  }`

  if (isExternal) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={classes}>
        {content}
      </a>
    )
  }

  return (
    <Link href={href} className={classes}>
      {content}
    </Link>
  )
}

export default function ChatUserPanel({
  userId,
  className = '',
}: {
  userId: string
  className?: string
}) {
  const router = useRouter()
  const pathname = usePathname()

  const [profile, setProfile] = useState<Profile | null>(null)
  const [postsCount, setPostsCount] = useState(0)
  const [followersCount, setFollowersCount] = useState(0)
  const [isBlocking, setIsBlocking] = useState(false)
  const [blockBusy, setBlockBusy] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('profiles')
        .select('id, username, avatar_url, bio, created_at, role')
        .eq('id', userId)
        .maybeSingle()

      setProfile((data as Profile | null) ?? null)

      const [{ count: posts }, { count: followers }, { data: blocking }] =
        await Promise.all([
          supabase
            .from('posts')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId)
            .eq('status', 'approved'),
          supabase
            .from('follows')
            .select('*', { count: 'exact', head: true })
            .eq('following_id', userId),
          supabase.rpc('is_blocking', { other_user_id: userId }),
        ])

      setPostsCount(posts ?? 0)
      setFollowersCount(followers ?? 0)
      setIsBlocking(!!blocking)
      setLoading(false)
    }
    load()
  }, [userId])

  async function toggleBlock() {
    if (!profile || blockBusy) return

    setBlockBusy(true)
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      setBlockBusy(false)
      return
    }

    if (isBlocking) {
      const { error } = await supabase
        .from('user_blocks')
        .delete()
        .eq('blocker_id', user.id)
        .eq('blocked_id', profile.id)
      setBlockBusy(false)

      if (error) {
        alert('Не удалось разблокировать: ' + humanizeError(error.message))
        return
      }
      setIsBlocking(false)
      return
    }

    const { error } = await supabase
      .from('user_blocks')
      .insert({ blocker_id: user.id, blocked_id: profile.id })
    setBlockBusy(false)

    if (error) {
      alert('Не удалось заблокировать: ' + humanizeError(error.message))
      return
    }
    setIsBlocking(true)
  }

  const wrapper = `flex flex-col h-full overflow-y-auto ${className}`

  if (loading) {
    return (
      <aside className={wrapper}>
        <p className="p-5 text-sm text-brown/60">Загрузка…</p>
      </aside>
    )
  }

  if (!profile) {
    return (
      <aside className={wrapper}>
        <p className="p-5 text-sm text-brown/60">Профиль не найден</p>
      </aside>
    )
  }

  const initial = (profile.username || '?')[0].toUpperCase()
  const joined = profile.created_at
    ? new Date(profile.created_at).toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : ''
  const profileHref = `/profile/${profile.username}`

  return (
    <aside className={wrapper}>
      {/* Блок профиля */}
      <div className="p-5 border-b border-emerald-dark/10">
        <div className="w-20 h-20 rounded-full bg-emerald-mid text-cream flex items-center justify-center text-2xl font-bold overflow-hidden">
          {profile.avatar_url ? (
            <img
              src={profile.avatar_url}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : (
            initial
          )}
        </div>

        <h3 className="font-playfair text-lg font-bold text-emerald-dark mt-3">
          {profile.username}
        </h3>
        <p className="text-xs text-brown/50">@{profile.username}</p>

        {profile.bio && (
          <p className="text-sm text-brown-dark/80 mt-3 leading-relaxed">
            {profile.bio}
          </p>
        )}

        {joined && (
          <p className="text-xs text-brown/40 mt-3 flex items-center gap-1">
            <Calendar size={11} strokeWidth={1.8} /> С нами с {joined}
          </p>
        )}
      </div>

      {/* Навигация по контенту собеседника */}
      <nav className="py-2">
        <PanelLink
          href={profileHref}
          Icon={User}
          label="Публикации"
          count={postsCount}
          active={pathname === profileHref}
        />
        <PanelLink
          href={profileHref}
          Icon={BookOpen}
          label="Мои книги"
          active={false}
        />
        <PanelLink href="/messages" Icon={Mail} label="Мои сообщения" badge />
        <PanelLink
          href={profileHref}
          Icon={UserPlus}
          label="Подписчики"
          count={followersCount}
          active={false}
        />
      </nav>

      {/* Кнопки действий */}
      <div className="px-5 py-4 border-t border-emerald-dark/10 space-y-2">
        <FollowButton userId={profile.id} />

        <button
          type="button"
          onClick={() => router.push(profileHref)}
          className="w-full bg-cream-warm border border-emerald-dark/15 text-brown-dark px-4 py-2 rounded-full text-sm hover:bg-cream transition-colors flex items-center justify-center gap-2"
        >
          <ExternalLink size={15} strokeWidth={1.8} />
          <span>Открыть профиль</span>
        </button>

        <button
          type="button"
          onClick={toggleBlock}
          disabled={blockBusy}
          className="w-full text-xs text-wine hover:underline disabled:opacity-50 flex items-center justify-center gap-1.5 py-1"
        >
          {isBlocking ? (
            <UserCheck size={13} strokeWidth={1.8} />
          ) : (
            <UserX size={13} strokeWidth={1.8} />
          )}
          <span>
            {isBlocking ? 'Разблокировать пользователя' : 'Заблокировать пользователя'}
          </span>
        </button>
      </div>

      {/* Блок безопасности */}
      <div className="px-5 py-4 mt-auto">
        <div className="bg-emerald-deep text-cream rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Shield size={14} strokeWidth={1.8} className="text-cream-warm" />
            <span className="text-xs font-medium">Безопасность</span>
          </div>
          <p className="text-[11px] text-cream/70 leading-relaxed">
            Мне важно, чтобы здесь было безопасно. Спасибо, что соблюдаете правила
            сообщества.
          </p>
        </div>
      </div>
    </aside>
  )
}
