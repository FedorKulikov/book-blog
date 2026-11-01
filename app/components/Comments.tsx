'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { humanizeError } from '@/lib/errors'
import { MessageCircle, Send } from './icons'
import CommentNode, {
  type CommentNodeContext,
  type CommentRow,
} from './comments/CommentNode'

/** Сколько корневых комментариев грузим за раз */
const PAGE_SIZE = 20
/** Максимальная глубина вложенности, докуда догружаем ответы */
const MAX_DEPTH = 5
/** Размер пачки id для одного .in() */
const ID_CHUNK = 100

type User = { id: string }

type Cursor = { createdAt: string; id: string }

/** Строка, которую отдаёт RPC get_comment_roots() */
type RawRootRow = {
  id: string
  post_id: string
  user_id: string
  parent_id: string | null
  text: string
  created_at: string
  username: string | null
  avatar_url: string | null
}

function toCommentRow(row: RawRootRow): CommentRow {
  return {
    id: row.id,
    post_id: row.post_id,
    user_id: row.user_id,
    parent_id: row.parent_id,
    text: row.text,
    created_at: row.created_at,
    profiles: row.username
      ? { username: row.username, avatar_url: row.avatar_url }
      : null,
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * Ошибки приходят из триггера БД (public.comments_before_insert).
 * Тексты RAISE EXCEPTION уже человекочитаемые, но подстрахуемся ключевыми словами.
 */
function explainCommentError(message: string): string {
  const lower = message.toLowerCase()

  if (lower.includes('заблокирован') || lower.includes('забанен')) {
    return 'Ваш аккаунт заблокирован — комментирование недоступно.'
  }

  if (lower.includes('стоп-слов')) {
    return message
  }

  return humanizeError(message)
}

export default function Comments({ postId }: { postId: string }) {
  const [roots, setRoots] = useState<CommentRow[]>([])
  const [replies, setReplies] = useState<CommentRow[]>([])
  const [hasMore, setHasMore] = useState(false)

  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [user, setUser] = useState<User | null>(null)
  const [isStaff, setIsStaff] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const [newText, setNewText] = useState('')
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')

  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  /** Корневые комментарии страницей через RPC (limit + 1 для hasMore) */
  const fetchRoots = useCallback(
    async (
      cursor: Cursor | null,
      limit: number,
    ): Promise<{ rows: CommentRow[]; hasMore: boolean; error: string | null }> => {
      const { data, error: rpcError } = await supabase.rpc('get_comment_roots', {
        p_post_id: postId,
        p_cursor_created_at: cursor?.createdAt ?? null,
        p_cursor_id: cursor?.id ?? null,
        p_limit: limit + 1,
      })

      if (rpcError) {
        console.error('[comments] get_comment_roots failed:', rpcError.message)
        return { rows: [], hasMore: false, error: rpcError.message }
      }

      const rows = ((data ?? []) as unknown as RawRootRow[]).map(toCommentRow)
      const hasMoreRows = rows.length > limit

      return {
        rows: hasMoreRows ? rows.slice(0, limit) : rows,
        hasMore: hasMoreRows,
        error: null,
      }
    },
    [postId],
  )

  /**
   * Ответы одним запросом на уровень вложенности (не N+1):
   * берём массив parent_id и запрашиваем всех детей пачками.
   */
  const fetchReplies = useCallback(
    async (parentIds: string[]): Promise<CommentRow[]> => {
      const collected: CommentRow[] = []
      let frontier = parentIds

      for (let depth = 0; depth < MAX_DEPTH && frontier.length > 0; depth++) {
        const level: CommentRow[] = []

        for (const ids of chunk(frontier, ID_CHUNK)) {
          const { data, error: selectError } = await supabase
            .from('comments')
            .select(
              'id, post_id, user_id, parent_id, text, created_at, profiles(username, avatar_url)',
            )
            .in('parent_id', ids)
            .order('created_at', { ascending: true })

          if (selectError) {
            console.error('[comments] replies fetch failed:', selectError.message)
            break
          }
          level.push(...((data ?? []) as unknown as CommentRow[]))
        }

        if (level.length === 0) break
        collected.push(...level)
        frontier = level.map(r => r.id)
      }

      return collected
    },
    [],
  )

  /** Перезагрузка списка: 'initial' — первая страница, 'keep' — сколько уже открыто */
  const reload = useCallback(
    async (mode: 'initial' | 'keep') => {
      const limit =
        mode === 'initial' ? PAGE_SIZE : Math.max(roots.length, PAGE_SIZE)

      const result = await fetchRoots(null, limit)
      if (result.error) {
        setError('Не удалось загрузить комментарии: ' + result.error)
        setLoading(false)
        return
      }

      const children = await fetchReplies(result.rows.map(r => r.id))

      setRoots(result.rows)
      setReplies(children)
      setHasMore(result.hasMore)
      setError(null)
      setLoading(false)
    },
    [fetchRoots, fetchReplies, roots.length],
  )

  // Realtime-колбэк должен видеть актуальный reload без пересоздания подписки
  const reloadRef = useRef(reload)
  useEffect(() => {
    reloadRef.current = reload
  }, [reload])

  // Пользователь и роль
  useEffect(() => {
    let alive = true

    supabase.auth.getUser().then(async ({ data }) => {
      if (!alive) return
      const current = data.user ? { id: data.user.id } : null
      setUser(current)

      if (current) {
        const { data: myProfile } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', current.id)
          .maybeSingle()
        if (alive) {
          setIsStaff(
            myProfile?.role === 'admin' || myProfile?.role === 'moderator',
          )
        }
      }
    })

    return () => {
      alive = false
    }
  }, [])

  // Первая загрузка при смене поста
  useEffect(() => {
    setLoading(true)
    setRoots([])
    setReplies([])
    setExpanded(new Set())
    reloadRef.current('initial')
  }, [postId])

  // Realtime: новые комментарии этого поста появляются без перезагрузки
  useEffect(() => {
    const channel = supabase
      .channel(`comments:${postId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'comments',
          filter: `post_id=eq.${postId}`,
        },
        () => {
          void reloadRef.current('keep')
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [postId])

  async function loadMore() {
    const last = roots[roots.length - 1]
    if (!last || loadingMore || !hasMore) return

    setLoadingMore(true)
    const result = await fetchRoots(
      { createdAt: last.created_at, id: last.id },
      PAGE_SIZE,
    )

    if (result.error) {
      setError('Не удалось загрузить комментарии: ' + result.error)
      setLoadingMore(false)
      return
    }

    const children = await fetchReplies(result.rows.map(r => r.id))

    setRoots(prev => {
      const seen = new Set(prev.map(r => r.id))
      return [...prev, ...result.rows.filter(r => !seen.has(r.id))]
    })
    setReplies(prev => [...prev, ...children])
    setHasMore(result.hasMore)
    setLoadingMore(false)
  }

  async function handleDeleteComment(commentId: string) {
    if (!confirm('Удалить комментарий?')) return

    const { error: deleteError } = await supabase
      .from('comments')
      .delete()
      .eq('id', commentId)

    if (deleteError) {
      alert(humanizeError(deleteError.message))
      return
    }
    await reloadRef.current('keep')
  }

  async function submitComment(text: string, parentId: string | null = null) {
    if (!user) {
      alert('Войдите, чтобы оставить комментарий')
      return
    }

    // Из проверок на клиенте — только пустой текст.
    const clean = text.trim()
    if (!clean) return
    if (submitting) return // защита от двойной отправки

    setSubmitting(true)
    try {
      // Rate limit — RPC в БД, из консоли не обойти
      const { data: limitCheck } = await supabase.rpc('check_and_log_action', {
        action_input: 'comment',
        max_per_hour: 30,
        max_per_minute: 5,
      })

      if (limitCheck && !limitCheck.ok) {
        if (limitCheck.reason === 'minute_limit') {
          alert('Слишком быстро. Подождите минуту.')
        } else if (limitCheck.reason === 'hour_limit') {
          alert('Достигнут лимит комментариев на час (30).')
        }
        return
      }

      // Бан и стоп-слова проверяет триггер comments_before_insert:
      // клиентская проверка обходилась из консоли и удалена.
      const { error: insertError } = await supabase.from('comments').insert({
        post_id: postId,
        user_id: user.id,
        parent_id: parentId,
        text: clean,
      })

      if (insertError) {
        console.error('[comments] insert failed:', insertError.message)
        alert(explainCommentError(insertError.message))
        return
      }

      setNewText('')
      setReplyText('')
      setReplyTo(null)
      await reloadRef.current('keep')
    } finally {
      setSubmitting(false)
    }
  }

  /**
   * Дерево строится один раз за рендер: Map parent_id -> дети.
   * Раньше был comments.filter() внутри рекурсии — O(N²).
   */
  const childrenByParent = useMemo(() => {
    const map = new Map<string, CommentRow[]>()
    for (const reply of replies) {
      if (!reply.parent_id) continue
      const list = map.get(reply.parent_id)
      if (list) list.push(reply)
      else map.set(reply.parent_id, [reply])
    }
    return map
  }, [replies])

  const ctx: CommentNodeContext = {
    user,
    isStaff,
    replyTo,
    replyText,
    submitting,
    expanded,
    onToggleExpanded: (id: string) =>
      setExpanded(prev => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      }),
    onReplyToggle: (id: string | null) => {
      setReplyTo(id)
      if (id === null) setReplyText('')
    },
    onReplyTextChange: setReplyText,
    onSubmitReply: (text: string, parentId: string) => {
      void submitComment(text, parentId)
    },
    onDelete: (id: string) => {
      void handleDeleteComment(id)
    },
    childrenByParent,
  }

  const loadedCount = roots.length + replies.length

  return (
    <section className="mt-8 pt-6 border-t border-emerald-dark/10">
      <div className="flex items-center gap-2 mb-4">
        <MessageCircle size={17} strokeWidth={1.7} className="text-emerald-mid" />
        <h3 className="font-playfair text-lg font-bold text-emerald-dark">
          Комментарии
          {loadedCount > 0 && (
            <span className="text-brown/40 text-sm font-normal ml-2">
              показано {loadedCount}
            </span>
          )}
        </h3>
      </div>

      {user ? (
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            placeholder="Оставьте комментарий…"
            className="flex-1 border border-emerald-dark/15 rounded-full px-4 py-2 text-sm bg-cream-warm/40 focus:outline-none focus:border-emerald-mid"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !submitting) void submitComment(newText)
            }}
          />
          <button
            type="button"
            onClick={() => void submitComment(newText)}
            disabled={submitting || !newText.trim()}
            className="bg-emerald-mid text-cream px-4 py-2 rounded-full text-sm hover:bg-emerald-dark transition-colors flex items-center disabled:opacity-50"
          >
            {submitting ? '…' : <Send size={15} strokeWidth={1.8} />}
          </button>
        </div>
      ) : (
        <p className="text-sm text-brown/60 mb-4">
          <a href="/login" className="text-wine hover:underline">
            Войдите
          </a>{' '}
          или{' '}
          <a href="/signup" className="text-wine hover:underline">
            зарегистрируйтесь
          </a>
          , чтобы оставить комментарий.
        </p>
      )}

      {error && <p className="text-sm text-wine mb-3">{error}</p>}
      {loading && <p className="text-sm text-brown/60">Загрузка…</p>}

      {!loading && roots.length === 0 && !error && (
        <p className="text-sm text-brown/60">
          Пока нет комментариев. Будьте первым!
        </p>
      )}

      {roots.map(root => (
        <CommentNode key={root.id} comment={root} depth={0} ctx={ctx} />
      ))}

      {!loading && hasMore && (
        <div className="mt-6 flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loadingMore}
            className="bg-cream-warm border border-emerald-dark/15 text-brown-dark px-5 py-2 rounded-full text-sm hover:bg-cream transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loadingMore ? 'Загружаем…' : 'Показать ещё комментарии'}
          </button>
        </div>
      )}
    </section>
  )
}
