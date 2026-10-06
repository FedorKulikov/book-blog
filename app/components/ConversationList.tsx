'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import EmptyState from './EmptyState'
import { Mail, BellOff } from './icons'

type Profile = {
  id: string
  username: string
  avatar_url: string | null
}

type LastMessage = {
  conversation_id: string
  text: string | null
  image_url: string | null
  audio_url: string | null
  sender_id: string
  created_at: string
  read_at: string | null
}

type RawConversation = {
  id: string
  user1_id: string
  user2_id: string
  last_message_at: string | null
  muted_by_user1?: boolean | null
  muted_by_user2?: boolean | null
}

type Conversation = {
  id: string
  user1_id: string
  user2_id: string
  last_message_at: string | null
  otherUser: Profile | null
  lastMessage: LastMessage | null
  unreadCount: number
  isMuted: boolean
}

type Filter = 'all' | 'unread' | 'favorites'

function formatTimeAgo(value: string | null) {
  if (!value) return 'новый диалог'

  const date = new Date(value)
  const diffMin = Math.floor((Date.now() - date.getTime()) / 60000)

  if (diffMin < 1) return 'только что'
  if (diffMin < 60) return `${diffMin} мин`

  const hours = Math.floor(diffMin / 60)
  if (hours < 24) return `${hours} ч`

  const days = Math.floor(hours / 24)
  if (days === 1) return 'вчера'
  if (days < 7) return `${days} дн`

  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

function previewOf(message: LastMessage | null) {
  if (!message) return 'Нет сообщений'
  if (message.text) return message.text
  if (message.image_url) return '📷 Фото'
  if (message.audio_url) return '🎤 Голосовое'
  return 'Без текста'
}

const PILL_BASE = 'px-3 py-1 rounded-full text-xs transition-colors'
const PILL_ACTIVE = 'bg-wine text-white'
const PILL_IDLE = 'border border-emerald-dark/15 text-brown hover:bg-cream-warm/60'

export default function ConversationList({
  activeId = null,
  className = '',
}: {
  activeId?: string | null
  className?: string
}) {
  const router = useRouter()
  const [uid, setUid] = useState<string | null>(null)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('all')

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
        return
      }
      setUid(user.id)

      const filter = `user1_id.eq.${user.id},user2_id.eq.${user.id}`
      const baseSelect = 'id, user1_id, user2_id, last_message_at'

      // Пытаемся сразу получить флаги mute; если колонок ещё нет в БД — работаем без них
      const withMute = await supabase
        .from('conversations')
        .select(`${baseSelect}, muted_by_user1, muted_by_user2`)
        .or(filter)
        .order('last_message_at', { ascending: false, nullsFirst: true })

      let raw = (withMute.data as RawConversation[] | null) ?? null

      if (withMute.error) {
        console.warn('[ConversationList] mute-колонки недоступны:', withMute.error.message)
        const withoutMute = await supabase
          .from('conversations')
          .select(baseSelect)
          .or(filter)
          .order('last_message_at', { ascending: false, nullsFirst: true })
        raw = (withoutMute.data as RawConversation[] | null) ?? null
      }

      const list = raw ?? []

      if (list.length === 0) {
        setConversations([])
        setLoading(false)
        return
      }

      const convIds = list.map(c => c.id)
      const otherIds = Array.from(
        new Set(list.map(c => (c.user1_id === user.id ? c.user2_id : c.user1_id)))
      )

      const [{ data: profilesData }, { data: messagesData }] = await Promise.all([
        supabase.from('profiles').select('id, username, avatar_url').in('id', otherIds),
        supabase
          .from('messages')
          .select('conversation_id, text, image_url, audio_url, sender_id, created_at, read_at')
          .in('conversation_id', convIds)
          .order('created_at', { ascending: false }),
      ])

      const profileById = new Map(
        ((profilesData as Profile[] | null) ?? []).map(p => [p.id, p])
      )
      const lastByConv = new Map<string, LastMessage>()
      const unreadByConv = new Map<string, number>()

      for (const m of (messagesData as LastMessage[] | null) ?? []) {
        if (!lastByConv.has(m.conversation_id)) lastByConv.set(m.conversation_id, m)
        if (m.sender_id !== user.id && !m.read_at) {
          unreadByConv.set(m.conversation_id, (unreadByConv.get(m.conversation_id) ?? 0) + 1)
        }
      }

      setConversations(
        list.map(c => {
          const otherId = c.user1_id === user.id ? c.user2_id : c.user1_id
          return {
            id: c.id,
            user1_id: c.user1_id,
            user2_id: c.user2_id,
            last_message_at: c.last_message_at,
            otherUser: profileById.get(otherId) ?? null,
            lastMessage: lastByConv.get(c.id) ?? null,
            unreadCount: unreadByConv.get(c.id) ?? 0,
            isMuted: c.user1_id === user.id ? !!c.muted_by_user1 : !!c.muted_by_user2,
          }
        })
      )
      setLoading(false)
    }
    load()
  }, [router])

  const totalUnread = conversations.reduce((sum, c) => sum + c.unreadCount, 0)

  const visible =
    filter === 'unread'
      ? conversations.filter(c => c.unreadCount > 0)
      : filter === 'favorites'
      ? []
      : conversations

  return (
    <div className={`flex flex-col min-h-0 h-full ${className}`}>
      {/* Шапка списка */}
      <div className="px-4 pt-4 pb-3 border-b border-emerald-dark/10 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Mail size={16} strokeWidth={1.8} className="text-emerald-mid" />
          <h2 className="font-playfair text-lg font-bold text-emerald-dark">
            Сообщения
          </h2>
        </div>
        <p className="text-xs text-brown/50 mt-0.5">
          Личная переписка с другими пользователями
        </p>
      </div>

      {/* Фильтры */}
      <div className="px-4 py-3 flex flex-wrap gap-2 flex-shrink-0">
        <button
          type="button"
          onClick={() => setFilter('all')}
          className={`${PILL_BASE} ${filter === 'all' ? PILL_ACTIVE : PILL_IDLE}`}
        >
          Все ({conversations.length})
        </button>
        <button
          type="button"
          onClick={() => setFilter('unread')}
          className={`${PILL_BASE} ${filter === 'unread' ? PILL_ACTIVE : PILL_IDLE}`}
        >
          Непрочитанные ({totalUnread})
        </button>
        <button
          type="button"
          onClick={() => setFilter('favorites')}
          className={`${PILL_BASE} ${filter === 'favorites' ? PILL_ACTIVE : PILL_IDLE}`}
        >
          Избранные
        </button>
      </div>

      {/* Список диалогов */}
      <div className="flex-1 min-h-0 overflow-y-auto pb-2">
        {loading && <p className="px-4 py-2 text-sm text-brown/60">Загрузка…</p>}

        {!loading && visible.length === 0 && (
          <div className="p-3">
            {filter === 'favorites' ? (
              <p className="text-center text-xs text-brown/50 py-6">
                Избранных диалогов пока нет — эта функция появится позже.
              </p>
            ) : filter === 'unread' ? (
              <p className="text-center text-xs text-brown/50 py-6">
                Непрочитанных сообщений нет.
              </p>
            ) : (
              <EmptyState
                icon={<Mail size={40} strokeWidth={1.2} />}
                title="Пока нет сообщений"
                description="Начните диалог с кем-то из авторов — зайдите в профиль и нажмите «Написать»."
                action={{ label: 'Найти авторов', href: '/books' }}
              />
            )}
          </div>
        )}

        {visible.map(conv => {
          const isActive = activeId === conv.id
          return (
            <Link
              key={conv.id}
              href={`/messages/${conv.id}`}
              className={`flex items-center gap-3 px-4 py-2.5 border-l-2 transition-colors ${
                isActive
                  ? 'bg-cream-warm/70 border-wine'
                  : 'border-transparent hover:bg-cream-warm/40'
              }`}
            >
              <div className="w-11 h-11 rounded-full bg-emerald-mid text-cream flex items-center justify-center font-bold flex-shrink-0 overflow-hidden">
                {conv.otherUser?.avatar_url ? (
                  <img
                    src={conv.otherUser.avatar_url}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : (
                  (conv.otherUser?.username?.[0] || '?').toUpperCase()
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`font-medium text-sm truncate ${
                      conv.isMuted ? 'text-brown/50' : 'text-emerald-dark'
                    }`}
                  >
                    {conv.otherUser?.username || 'Аноним'}
                  </span>
                  <span className="flex items-center gap-1 flex-shrink-0">
                    {conv.isMuted && (
                      <BellOff
                        size={12}
                        strokeWidth={1.8}
                        className="text-brown/40"
                      />
                    )}
                    <span className="text-[11px] text-brown/40">
                      {formatTimeAgo(conv.last_message_at)}
                    </span>
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2 mt-0.5">
                  <span className="text-xs text-brown/60 truncate">
                    {conv.lastMessage?.sender_id === uid && (
                      <span className="text-brown/40">Вы: </span>
                    )}
                    {previewOf(conv.lastMessage)}
                  </span>
                  {conv.unreadCount > 0 && (
                    <span
                      className={`text-[10px] min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center font-medium flex-shrink-0 ${
                        conv.isMuted ? 'bg-brown/40 text-white/90' : 'bg-wine text-white'
                      }`}
                    >
                      {conv.unreadCount > 99 ? '99+' : conv.unreadCount}
                    </span>
                  )}
                </div>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
