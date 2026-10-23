'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Bell } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'

type Notification = {
  id: string
  user_id: string
  type?: string | null
  post_id?: string | null
  comment_id?: string | null
  actor_id?: string | null
  from_user_id?: string | null
  is_read?: boolean | null
  created_at: string
}

type Profile = {
  id: string
  username: string
  avatar_url: string | null
}

type NotificationItem = Notification & {
  actor_username?: string | null
  actor_avatar?: string | null
}

// Payload Realtime-события INSERT (таблица notifications)
type NotificationInsertPayload = {
  new: Notification
}

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (!Number.isFinite(diff) || diff < 60) return 'только что'
  const m = Math.floor(diff / 60)
  if (m < 60) return `${m} мин назад`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} ч назад`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d} дн назад`
  return new Date(iso).toLocaleDateString('ru-RU')
}

function actorIdOf(n: Notification): string | null {
  return n.actor_id ?? n.from_user_id ?? null
}

function notifText(n: NotificationItem): string {
  const who = n.actor_username || 'Кто-то'
  const t = (n.type || '').toLowerCase()
  if (t.includes('comment')) return `${who} ответил на ваш комментарий`
  if (t.includes('like')) return `${who} оценил ваш пост`
  if (t.includes('follow')) return `${who} подписался на вас`
  if (t.includes('message')) return `${who} отправил вам сообщение`
  return `${who} отправил вам уведомление`
}

function notifHref(n: NotificationItem): string {
  const t = (n.type || '').toLowerCase()
  if (n.post_id) return `/post/${n.post_id}`
  if (t.includes('message')) return '/messages'
  if (n.actor_username) return `/profile/${n.actor_username}`
  return '#'
}

export default function NotificationBell() {
  const [user, setUser] = useState<User | null>(null)
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [open, setOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)

  const wrapRef = useRef<HTMLDivElement | null>(null)
  // Ref для open: Realtime-канал не пересоздаётся при каждом toggle меню,
  // а обработчик всегда видит актуальное значение open через openRef.current.
  const openRef = useRef(false)
  // Актуальный uid — чтобы после await не записать state после logout/sмены юзера.
  const userIdRef = useRef<string | null>(null)
  const pathname = usePathname()

  // Точный счётчик непрочитанных — независимо от лимита 10 в списке.
  const fetchUnreadCount = useCallback(async () => {
    const uid = userIdRef.current
    if (!uid) return

    const { count, error } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', uid)
      .eq('is_read', false)

    // Пользователь мог разлогиниться / смениться во время запроса
    if (userIdRef.current !== uid) return

    if (error) {
      // На ошибке НЕ обнуляем счётчик — оставляем прежнее значение
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[bell] unread count', error)
      }
      return
    }
    // PostgREST может вернуть count === null — игнорируем
    if (typeof count === 'number') setUnreadCount(count)
  }, [])

  // Список уведомлений (до 10) + дозапрос профилей инициаторов
  const fetchNotifications = useCallback(async (userId: string) => {
    const uid = userId

    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .limit(10)

    if (userIdRef.current !== uid) return

    if (error) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[bell] notifications', error)
      }
      return
    }

    const rows = (data as Notification[] | null) ?? []

    // Безопасный .in(): без пустого массива и без дублей
    const rawIds = rows
      .map(n => n.actor_id ?? n.from_user_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
    const actorIds = Array.from(new Set(rawIds))

    let profilesById: Record<string, Profile> = {}
    if (actorIds.length > 0) {
      const { data: profileRows, error: profilesError } = await supabase
        .from('profiles')
        .select('id, username, avatar_url')
        .in('id', actorIds)

      if (userIdRef.current !== uid) return

      if (profilesError) {
        // Список всё равно рендерится — просто без аватаров/имён
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[bell] profiles', profilesError)
        }
      } else if (profileRows) {
        profilesById = Object.fromEntries(
          profileRows.map((p: Profile) => [p.id, p])
        )
      }
    }

    setNotifications(
      rows.map(r => {
        const aid = actorIdOf(r)
        const p = aid ? profilesById[aid] : undefined
        return {
          ...r,
          actor_username: p?.username ?? null,
          actor_avatar: p?.avatar_url ?? null,
        }
      })
    )
  }, [])

  // Пометить одно уведомление прочитанным + пересинхронизировать счётчик
  const markOneRead = useCallback(
    async (id: string) => {
      const uid = userIdRef.current
      if (!uid) return

      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('id', id)
        .eq('user_id', uid)

      if (userIdRef.current !== uid) return

      if (error) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[bell] markOneRead', error)
        }
      }

      setNotifications(prev =>
        prev.map(x => (x.id === id ? { ...x, is_read: true } : x))
      )
      // Пересинхронизация вместо ручного декремента — без дрейфа
      fetchUnreadCount()
    },
    [fetchUnreadCount]
  )

  // Текущий пользователь: загрузка списка и счётчика параллельно
  useEffect(() => {
    let cancelled = false

    supabase.auth.getUser().then(({ data: { user: u } }) => {
      if (cancelled) return
      userIdRef.current = u?.id ?? null
      setUser(u)
      if (u) {
        fetchNotifications(u.id)
        fetchUnreadCount()
      } else {
        setNotifications([])
        setUnreadCount(0)
      }
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return
      const u = session?.user ?? null

      userIdRef.current = u?.id ?? null
      setUser(u)
      if (u) {
        fetchNotifications(u.id)
        fetchUnreadCount()
      } else {
        setNotifications([])
        setUnreadCount(0)
      }
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [fetchNotifications, fetchUnreadCount])

  // Realtime: INSERT без перезагрузки; защита от дублей и утечек
  useEffect(() => {
    if (!user?.id) return
    const uid = user.id

    // Уникальное имя канала при каждом монтировании — защита от ошибки
    // «cannot add postgres_changes callbacks ... after subscribe()» в React Strict Mode
    // (двойной вызов useEffect: первый канал отписывается, но подписка уже создана).
    const channel = supabase
      .channel(`notifications:${uid}:${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${uid}`,
        },
        (payload: NotificationInsertPayload) => {
          const n = payload.new

          setNotifications(prev => {
            // Защита от дублей при reconnect/повторной доставке
            if (prev.some(x => x.id === n.id)) return prev
            return [n, ...prev].slice(0, 10)
          })

          if (n.is_read === false) {
            if (openRef.current) {
              // Пользователь смотрит меню — сразу помечаем прочитанным
              markOneRead(n.id)
            } else {
              // Functional updater — не теряем апдейты при батчинге
              setUnreadCount(c => c + 1)
            }
          }
        }
      )
      .subscribe()

    return () => {
      // Обязательный cleanup: снимаем канал при unmount / смене user.id
      supabase.removeChannel(channel)
    }
  }, [user?.id, markOneRead])

  // Догоняющий refetch при возврате фокуса вкладки (события за обрыв теряются)
  useEffect(() => {
    const onFocus = () => {
      const uid = userIdRef.current
      if (!uid) return
      fetchNotifications(uid)
      fetchUnreadCount()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [fetchNotifications, fetchUnreadCount])

  // Закрытие дропдауна: клик вне / смена страницы.
  // openRef обновляем синхронно: Realtime-INSERT в том же тике должен видеть
  // актуальное значение, не дожидаясь useEffect.
  useEffect(() => {
    setOpen(false)
    openRef.current = false
  }, [pathname])

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
        openRef.current = false
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  async function markAllRead() {
    const uid = userIdRef.current
    if (!uid || unreadCount === 0) return

    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', uid)
      .eq('is_read', false)

    if (userIdRef.current !== uid) return

    if (error) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[bell] markAllRead', error)
      }
      return
    }

    setUnreadCount(0)
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
  }

  async function handleOpen() {
    const next = !open
    setOpen(next)
    openRef.current = next // синхронно, не ждём эффект
    if (next) {
      // При открытии меню помечаем все как прочитанные
      await markAllRead()
    }
  }

  async function handleItemClick(n: NotificationItem) {
    if (userIdRef.current && !n.is_read) {
      await markOneRead(n.id)
    }
    setOpen(false)
    openRef.current = false
  }

  // Колокольчик только для авторизованных
  if (!user) return null

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={handleOpen}
        aria-label={
          unreadCount > 0
            ? `Уведомления (${unreadCount} непрочитанных)`
            : 'Уведомления'
        }
        className="relative text-cream hover:text-cream-warm transition-colors"
      >
        <Bell size={20} strokeWidth={1.8} />
        {unreadCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold flex items-center justify-center leading-none">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 max-h-96 overflow-y-auto bg-cream text-brown-dark rounded-xl shadow-xl border border-emerald-dark/10 z-50">
          <div className="px-4 py-3 border-b border-emerald-dark/10 flex items-center justify-between">
            <span className="font-playfair font-bold text-sm">Уведомления</span>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="text-[11px] text-wine hover:underline"
              >
                Прочитать все
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-brown/60">
              Уведомлений пока нет
            </div>
          ) : (
            <ul>
              {notifications.map(n => {
                const href = notifHref(n)
                const inner = (
                  <div
                    className={`flex items-start gap-3 px-4 py-3 border-b border-emerald-dark/5 last:border-0 transition-colors ${
                      n.is_read ? 'opacity-70' : 'bg-cream-warm/30'
                    } hover:bg-cream-warm/60`}
                  >
                    <div className="shrink-0 w-9 h-9 rounded-full overflow-hidden bg-emerald-mid/20 flex items-center justify-center text-emerald-dark text-sm font-semibold">
                      {n.actor_avatar ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={n.actor_avatar}
                          alt={n.actor_username || ''}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        (n.actor_username || 'U').slice(0, 1).toUpperCase()
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm leading-snug">{notifText(n)}</p>
                      <p className="text-[11px] text-brown/50 mt-0.5">
                        {timeAgo(n.created_at)}
                      </p>
                    </div>
                    {!n.is_read && (
                      <span className="shrink-0 mt-1.5 w-2 h-2 rounded-full bg-wine" />
                    )}
                  </div>
                )

                return (
                  <li key={n.id}>
                    {href !== '#' ? (
                      <Link href={href} onClick={() => handleItemClick(n)}>
                        {inner}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        className="w-full text-left"
                        onClick={() => handleItemClick(n)}
                      >
                        {inner}
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
