'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { humanizeError } from '@/lib/errors'
import MessageBubble, { ChatMessage } from '@/app/components/MessageBubble'
import ConversationList from '@/app/components/ConversationList'
import ChatUserPanel from '@/app/components/ChatUserPanel'
import ImageLightbox from '@/app/components/ImageLightbox'
import ChatMuteButton from '@/app/components/ChatMuteButton'
import {
  ChevronLeft,
  Send,
  ImageIcon,
  Mic,
  Trash2,
  MoreVertical,
  UserX,
  UserCheck,
  PanelLeft,
  PanelLeftClose,
  PanelRight,
  PanelRightClose,
} from '@/app/components/icons'

// --- Сворачивание боковых колонок (состояние в localStorage) ---
const LEFT_COLLAPSED_KEY = 'chat-left-collapsed'
const RIGHT_COLLAPSED_KEY = 'chat-right-collapsed'
const COLUMNS_EVENT = 'chat-columns-change'

function readFlag(key: string) {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function writeFlag(key: string, value: boolean) {
  try {
    window.localStorage.setItem(key, value ? '1' : '0')
  } catch {
    // приватный режим браузера — просто не запоминаем
  }
  window.dispatchEvent(new Event(COLUMNS_EVENT))
}

function subscribeColumns(callback: () => void) {
  window.addEventListener('storage', callback)
  window.addEventListener(COLUMNS_EVENT, callback)
  return () => {
    window.removeEventListener('storage', callback)
    window.removeEventListener(COLUMNS_EVENT, callback)
  }
}

type Counterpart = {
  id: string
  username: string | null
  avatar_url: string | null
}

const MAX_PHOTO_BYTES = 10 * 1024 * 1024 // 10 МБ
const MAX_RECORD_SECONDS = 300 // 5 минут
const MESSAGE_FIELDS =
  'id, text, image_url, audio_url, audio_duration, created_at, read_at, sender_id'

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0')
  const seconds = (totalSeconds % 60).toString().padStart(2, '0')
  return `${minutes}:${seconds}`
}

function dayLabel(value: string) {
  const date = new Date(value)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)

  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  if (sameDay(date, today)) return 'Сегодня'
  if (sameDay(date, yesterday)) return 'Вчера'
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}

export default function ConversationPage() {
  const params = useParams()
  const id = params.id as string
  const router = useRouter()

  const [uid, setUid] = useState<string | null>(null)
  const [otherUser, setOtherUser] = useState<Counterpart | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)

  const [menuOpen, setMenuOpen] = useState(false)
  const [iBlock, setIBlock] = useState(false)
  const [blockedByOther, setBlockedByOther] = useState(false)
  const [blockBusy, setBlockBusy] = useState(false)
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)

  // Читаем флаги из localStorage через useSyncExternalStore: сервер отдаёт
  // «развёрнуто», клиент после гидратации — реальное значение (без setState в эффекте)
  const leftCollapsed = useSyncExternalStore(
    subscribeColumns,
    () => readFlag(LEFT_COLLAPSED_KEY),
    () => false
  )
  const rightCollapsed = useSyncExternalStore(
    subscribeColumns,
    () => readFlag(RIGHT_COLLAPSED_KEY),
    () => false
  )

  function toggleLeft() {
    writeFlag(LEFT_COLLAPSED_KEY, !leftCollapsed)
  }

  function toggleRight() {
    writeFlag(RIGHT_COLLAPSED_KEY, !rightCollapsed)
  }

  const bottomRef = useRef<HTMLDivElement>(null)
  const readyRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const discardRef = useRef(false)
  const recordStartRef = useRef(0)

  const fetchMessages = useCallback(async (): Promise<ChatMessage[] | null> => {
    const { data, error: fetchError } = await supabase
      .from('messages')
      .select(MESSAGE_FIELDS)
      .eq('conversation_id', id)
      .order('created_at', { ascending: true })

    if (fetchError) {
      setError(humanizeError(fetchError.message))
      return null
    }
    return (data as ChatMessage[] | null) ?? []
  }, [id])

  const markRead = useCallback(
    async (userId: string) => {
      const { data, error: markError } = await supabase
        .from('messages')
        .update({ read_at: new Date().toISOString() })
        .eq('conversation_id', id)
        .neq('sender_id', userId)
        .is('read_at', null)
        .select('id')

      if (markError) {
        console.warn('[messages] не удалось отметить прочитанным:', markError.message)
        return
      }
      if ((data?.length ?? 0) === 0) {
        // Ничего не обновилось: либо непрочитанных нет, либо RLS не пускает UPDATE
        console.debug('[messages] пометка «прочитано» не затронула строк (RLS?)')
      }
    },
    [id]
  )

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
        return
      }
      setUid(user.id)

      const { data: conv } = await supabase
        .from('conversations')
        .select('id, user1_id, user2_id')
        .eq('id', id)
        .maybeSingle()

      if (!conv || (conv.user1_id !== user.id && conv.user2_id !== user.id)) {
        router.push('/messages')
        return
      }

      const otherId = conv.user1_id === user.id ? conv.user2_id : conv.user1_id
      const { data: prof } = await supabase
        .from('profiles')
        .select('id, username, avatar_url')
        .eq('id', otherId)
        .maybeSingle()

      setOtherUser(
        (prof as Counterpart | null) ?? { id: otherId, username: null, avatar_url: null }
      )

      const [{ data: blockedByOtherData }, { data: iBlockData }] = await Promise.all([
        supabase.rpc('is_blocked_by_other', { other_user_id: otherId }),
        supabase.rpc('is_blocking', { other_user_id: otherId }),
      ])
      setBlockedByOther(!!blockedByOtherData)
      setIBlock(!!iBlockData)

      const list = await fetchMessages()
      setMessages(list ?? [])
      setLoading(false)

      await markRead(user.id)
      readyRef.current = true
    }
    init()
  }, [id, router, fetchMessages, markRead])

  // Поллинг: догружаем только сообщения новее последнего известного
  useEffect(() => {
    const timer = setInterval(async () => {
      if (!uid || !readyRef.current) return

      const last = messages[messages.length - 1]
      let fresh: ChatMessage[] = []

      if (last) {
        const { data } = await supabase
          .from('messages')
          .select(MESSAGE_FIELDS)
          .eq('conversation_id', id)
          .gt('created_at', last.created_at)
          .order('created_at', { ascending: true })
        fresh = (data as ChatMessage[] | null) ?? []
      } else {
        fresh = (await fetchMessages()) ?? []
      }

      if (fresh.length > 0) {
        setMessages(prev => {
          const seen = new Set(prev.map(m => m.id))
          const merged = [...prev, ...fresh.filter(m => !seen.has(m.id))]
          return merged.length === prev.length ? prev : merged
        })
        await markRead(uid)
      }
    }, 5000)

    return () => clearInterval(timer)
  }, [uid, id, messages, fetchMessages, markRead])

  // Автоскролл вниз
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages])

  // Закрытие меню по клику вне
  useEffect(() => {
    function handleMouseDown(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [])

  const resetRecording = useCallback(() => {
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    mediaRecorderRef.current = null
    chunksRef.current = []
    setRecording(false)
    setSeconds(0)
  }, [])

  const finishRecording = useCallback(
    async (chunks: Blob[], mimeType: string) => {
      if (!uid) return

      const blob = new Blob(chunks, { type: mimeType || 'audio/webm' })
      const ext = blob.type.includes('mp4')
        ? 'mp4'
        : blob.type.includes('ogg')
        ? 'ogg'
        : 'webm'
      const path = `${uid}/${Date.now()}-voice.${ext}`
      // Точная длительность: считаем от момента старта записи, а не по тикам таймера
      const recordedDuration = recordStartRef.current
        ? Math.max(1, Math.round((Date.now() - recordStartRef.current) / 1000))
        : null

      setUploading(true)
      const { error: uploadError } = await supabase.storage
        .from('chat-media')
        .upload(path, blob, { contentType: blob.type || 'audio/webm' })

      if (uploadError) {
        setUploading(false)
        setError(humanizeError(uploadError.message))
        return
      }

      const { data: pub } = supabase.storage.from('chat-media').getPublicUrl(path)

      const { data, error: insertError } = await supabase
        .from('messages')
        .insert({
          conversation_id: id,
          sender_id: uid,
          audio_url: pub.publicUrl,
          audio_duration: recordedDuration,
        })
        .select(MESSAGE_FIELDS)
        .single()
      setUploading(false)

      if (insertError) {
        setError(humanizeError(insertError.message))
        return
      }

      setError(null)
      setMessages(prev => [...prev, data as ChatMessage])
    },
    [id, uid]
  )

  const stopRecording = useCallback(
    (discard: boolean) => {
      discardRef.current = discard
      const recorder = mediaRecorderRef.current
      if (recorder && recorder.state !== 'inactive') {
        recorder.stop() // дальше сработает onstop
        return
      }
      resetRecording()
    },
    [resetRecording]
  )

  // Таймер записи + автостоп на 5 минутах
  useEffect(() => {
    if (!recording) return

    const startedAt = Date.now()
    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000)
      setSeconds(elapsed)
      if (elapsed >= MAX_RECORD_SECONDS) stopRecording(false)
    }, 1000)

    return () => clearInterval(timer)
  }, [recording, stopRecording])

  async function startRecording() {
    if (recording || uploading || !uid) return

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      alert('Запись голоса не поддерживается этим браузером')
      return
    }

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      alert('Разрешите доступ к микрофону')
      return
    }

    const preferred = ['audio/webm', 'audio/mp4', 'audio/ogg']
    const mimeType =
      typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported
        ? preferred.find(type => MediaRecorder.isTypeSupported(type)) ?? ''
        : ''

    const recorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream)

    streamRef.current = stream
    mediaRecorderRef.current = recorder
    chunksRef.current = []
    discardRef.current = false
    recordStartRef.current = Date.now()

    recorder.ondataavailable = event => {
      if (event.data.size > 0) chunksRef.current.push(event.data)
    }

    recorder.onstop = () => {
      const chunks = chunksRef.current
      const type = recorder.mimeType
      const discard = discardRef.current
      resetRecording()
      if (discard || chunks.length === 0) return
      void finishRecording(chunks, type)
    }

    recorder.start()
    setError(null)
    setSeconds(0)
    setRecording(true)
  }

  async function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // чтобы можно было выбрать тот же файл повторно
    if (!file || !uid || uploading) return

    if (!file.type.startsWith('image/')) {
      setError('Можно прикрепить только изображение')
      return
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setError('Файл больше 10 МБ')
      return
    }

    setUploading(true)
    setError(null)

    const rawExt = file.name.includes('.') ? file.name.split('.').pop()! : 'jpg'
    const ext = rawExt.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
    const path = `${uid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

    const { error: uploadError } = await supabase.storage
      .from('chat-media')
      .upload(path, file, { contentType: file.type })

    if (uploadError) {
      setUploading(false)
      setError(humanizeError(uploadError.message))
      return
    }

    const { data: pub } = supabase.storage.from('chat-media').getPublicUrl(path)

    const { data, error: insertError } = await supabase
      .from('messages')
      .insert({ conversation_id: id, sender_id: uid, image_url: pub.publicUrl })
      .select(MESSAGE_FIELDS)
      .single()
    setUploading(false)

    if (insertError) {
      setError(humanizeError(insertError.message))
      return
    }

    setMessages(prev => [...prev, data as ChatMessage])
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    const body = text.trim()
    if (!body || !uid || sending) return

    setSending(true)
    const { data, error: sendError } = await supabase
      .from('messages')
      .insert({ conversation_id: id, sender_id: uid, text: body })
      .select(MESSAGE_FIELDS)
      .single()
    setSending(false)

    if (sendError) {
      setError(humanizeError(sendError.message))
      return
    }

    setError(null)
    setText('')
    setMessages(prev => [...prev, data as ChatMessage])
  }

  async function toggleBlock() {
    if (!uid || !otherUser?.id || blockBusy) return

    setMenuOpen(false)
    setBlockBusy(true)

    if (iBlock) {
      const { error: unblockError } = await supabase
        .from('user_blocks')
        .delete()
        .eq('blocker_id', uid)
        .eq('blocked_id', otherUser.id)
      setBlockBusy(false)

      if (unblockError) {
        setError(humanizeError(unblockError.message))
        return
      }
      setIBlock(false)
      alert('Пользователь разблокирован')
      return
    }

    const { error: blockError } = await supabase
      .from('user_blocks')
      .insert({ blocker_id: uid, blocked_id: otherUser.id })
    setBlockBusy(false)

    if (blockError) {
      setError(humanizeError(blockError.message))
      return
    }
    setIBlock(true)
    alert('Пользователь заблокирован. Он больше не сможет писать вам.')
  }

  return (
    <main className="h-[calc(100vh-64px)] lg:h-screen flex bg-cream">
      {/* ЛЕВАЯ КОЛОНКА — список диалогов, только desktop */}
      <aside
        className={`hidden lg:flex flex-col border-r border-emerald-dark/10 bg-cream-warm/20 flex-shrink-0 transition-[width] duration-300 ${
          leftCollapsed ? 'w-0 overflow-hidden' : 'w-[340px]'
        }`}
      >
        <ConversationList activeId={id} />
      </aside>

      {/* ЦЕНТРАЛЬНАЯ КОЛОНКА — чат */}
      <div className="flex-1 flex flex-col min-w-0">
      {/* Шапка диалога */}
      <header className="bg-emerald-dark text-cream px-4 py-3 flex items-center gap-3 border-b border-cream/10 flex-shrink-0">
        <Link
          href="/messages"
          className="lg:hidden text-cream/70 hover:text-cream transition-colors"
          aria-label="К списку диалогов"
        >
          <ChevronLeft size={20} strokeWidth={1.8} />
        </Link>

        <button
          type="button"
          onClick={toggleLeft}
          className="hidden lg:flex text-cream/60 hover:text-cream transition-colors p-1 mr-1"
          aria-label={
            leftCollapsed ? 'Показать список диалогов' : 'Скрыть список диалогов'
          }
          title={
            leftCollapsed ? 'Показать список диалогов' : 'Скрыть список диалогов'
          }
        >
          {leftCollapsed ? (
            <PanelLeft size={18} strokeWidth={1.8} />
          ) : (
            <PanelLeftClose size={18} strokeWidth={1.8} />
          )}
        </button>

        <Link
          href={otherUser?.username ? `/profile/${otherUser.username}` : '/messages'}
          className="flex items-center gap-3 flex-1 min-w-0 hover:opacity-90 transition-opacity"
        >
          <div className="w-9 h-9 rounded-full bg-cream/15 flex items-center justify-center font-bold overflow-hidden flex-shrink-0">
            {otherUser?.avatar_url ? (
              <img
                src={otherUser.avatar_url}
                alt=""
                className="w-full h-full object-cover"
              />
            ) : (
              (otherUser?.username?.[0] || '?').toUpperCase()
            )}
          </div>
          <span className="font-medium truncate">
            {otherUser?.username || 'Аноним'}
          </span>
        </Link>

        <ChatMuteButton conversationId={id} />

        <button
          type="button"
          onClick={toggleRight}
          className="hidden xl:flex text-cream/60 hover:text-cream transition-colors p-1"
          aria-label={
            rightCollapsed ? 'Показать панель собеседника' : 'Скрыть панель собеседника'
          }
          title={
            rightCollapsed ? 'Показать панель собеседника' : 'Скрыть панель собеседника'
          }
        >
          {rightCollapsed ? (
            <PanelRight size={18} strokeWidth={1.8} />
          ) : (
            <PanelRightClose size={18} strokeWidth={1.8} />
          )}
        </button>

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen(open => !open)}
            className="text-cream/70 hover:text-cream transition-colors p-1"
            aria-label="Действия с диалогом"
          >
            <MoreVertical size={20} strokeWidth={1.8} />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 w-56 bg-cream border border-emerald-dark/15 rounded-xl shadow-lg z-20 overflow-hidden">
              <button
                type="button"
                onClick={toggleBlock}
                disabled={blockBusy}
                className="w-full text-left px-4 py-2.5 text-sm text-brown-dark hover:bg-cream-warm/60 transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                {iBlock ? (
                  <UserCheck size={15} strokeWidth={1.8} />
                ) : (
                  <UserX size={15} strokeWidth={1.8} />
                )}
                <span>
                  {iBlock
                    ? 'Разблокировать пользователя'
                    : 'Заблокировать пользователя'}
                </span>
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Сообщения */}
      <div className="flex-1 overflow-y-auto p-4 bg-cream">
        {loading && (
          <p className="text-center text-brown/60 text-sm">Загрузка…</p>
        )}

        {!loading && messages.length === 0 && (
          <p className="text-center text-brown/50 text-sm mt-10">
            Начните разговор — напишите первое сообщение.
          </p>
        )}

        {messages.map((m, index) => {
          const prev = index > 0 ? messages[index - 1] : null
          const newDay =
            !prev ||
            new Date(prev.created_at).toDateString() !==
              new Date(m.created_at).toDateString()
          const sameAuthor = !!prev && !newDay && prev.sender_id === m.sender_id

          return (
            <div key={m.id}>
              {newDay && (
                <div className="text-center text-xs text-brown/50 my-4">
                  {dayLabel(m.created_at)}
                </div>
              )}
              <div className={sameAuthor ? 'mt-1' : 'mt-3'}>
                <MessageBubble
                  message={m}
                  isOwn={m.sender_id === uid}
                  onImageClick={setLightboxSrc}
                />
              </div>
            </div>
          )
        })}

        <div ref={bottomRef} />
      </div>

      {error && (
        <p className="bg-wine/10 text-wine text-xs px-4 py-2 flex-shrink-0">
          {error}
        </p>
      )}

      {uploading && !recording && (
        <p className="bg-cream-warm/60 text-brown/70 text-xs px-4 py-2 animate-pulse flex-shrink-0">
          Загрузка файла…
        </p>
      )}

      {blockedByOther ? (
        <div className="bg-cream border-t border-emerald-dark/10 p-4 text-center text-sm text-brown/60 flex-shrink-0">
          Вы не можете отправлять сообщения этому пользователю.
        </div>
      ) : recording ? (
        /* Интерфейс записи голосового */
        <div className="bg-cream border-t border-emerald-dark/10 p-3 flex items-center gap-3 flex-shrink-0">
          <span className="w-2.5 h-2.5 rounded-full bg-wine animate-pulse flex-shrink-0" />
          <span className="font-medium text-brown-dark tabular-nums">
            {formatDuration(seconds)}
          </span>
          <span className="text-xs text-brown/50 truncate">
            {uploading ? 'Отправляем…' : 'Идёт запись…'}
          </span>

          <button
            type="button"
            onClick={() => stopRecording(true)}
            disabled={uploading}
            className="ml-auto bg-cream-warm border border-emerald-dark/15 text-brown-dark w-10 h-10 rounded-full flex items-center justify-center hover:bg-cream transition-colors disabled:opacity-50 flex-shrink-0"
            aria-label="Отменить запись"
          >
            <Trash2 size={16} strokeWidth={1.8} />
          </button>

          <button
            type="button"
            onClick={() => stopRecording(false)}
            disabled={uploading}
            className="bg-emerald-mid hover:bg-emerald-dark text-cream w-10 h-10 rounded-full flex items-center justify-center transition-colors disabled:opacity-50 flex-shrink-0"
            aria-label="Отправить голосовое"
          >
            <Send size={16} strokeWidth={1.8} />
          </button>
        </div>
      ) : (
        <>
          {iBlock && (
            <div className="bg-cream border-t border-emerald-dark/10 px-4 py-2 text-center text-xs text-brown/60 flex-shrink-0">
              Вы заблокировали этого пользователя.{' '}
              <button
                type="button"
                onClick={toggleBlock}
                className="text-wine hover:underline"
              >
                Разблокировать
              </button>
            </div>
          )}

          {/* Форма отправки */}
          <form
            onSubmit={handleSend}
            className="bg-cream border-t border-emerald-dark/10 p-3 flex items-center gap-2 flex-shrink-0"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handlePhoto}
              className="hidden"
            />

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="bg-cream-warm border border-emerald-dark/15 text-brown-dark w-10 h-10 rounded-full flex items-center justify-center hover:bg-cream transition-colors disabled:opacity-50 flex-shrink-0"
              aria-label="Прикрепить фото"
            >
              <ImageIcon size={18} strokeWidth={1.8} />
            </button>

            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Написать сообщение…"
              className="flex-1 min-w-0 border border-emerald-dark/15 rounded-full px-4 py-2 bg-cream-warm/40 focus:outline-none focus:border-emerald-mid"
              autoFocus
            />

            <button
              type="button"
              onClick={startRecording}
              disabled={uploading}
              className="bg-cream-warm border border-emerald-dark/15 text-brown-dark w-10 h-10 rounded-full flex items-center justify-center hover:bg-cream transition-colors disabled:opacity-50 flex-shrink-0"
              aria-label="Записать голосовое"
            >
              <Mic size={18} strokeWidth={1.8} />
            </button>

            <button
              type="submit"
              disabled={!text.trim() || sending}
              className="bg-emerald-mid hover:bg-emerald-dark text-cream w-10 h-10 rounded-full flex items-center justify-center transition-colors disabled:opacity-50 flex-shrink-0"
              aria-label="Отправить"
            >
              <Send size={16} strokeWidth={1.8} />
            </button>
          </form>
        </>
      )}
      </div>

      {/* ПРАВАЯ КОЛОНКА — панель собеседника */}
      <aside
        className={`hidden xl:flex flex-col border-l border-emerald-dark/10 bg-cream-warm/20 flex-shrink-0 transition-[width] duration-300 ${
          rightCollapsed ? 'w-0 overflow-hidden' : 'w-[300px]'
        }`}
      >
        {otherUser && <ChatUserPanel userId={otherUser.id} />}
      </aside>

      {/* Лайтбокс для фото */}
      <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
    </main>
  )
}
