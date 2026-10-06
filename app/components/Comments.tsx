'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { findBadWord } from '@/lib/moderation'
import ReportButton from './ReportButton'
import { MessageCircle, Send } from './icons'

type Comment = {
  id: string
  post_id: string
  user_id: string
  parent_id: string | null
  text: string
  created_at: string
  profiles?: { username: string; avatar_url?: string | null }
}

export default function Comments({ postId }: { postId: string }) {
  const [comments, setComments] = useState<Comment[]>([])
  const [newText, setNewText] = useState('')
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user))
    loadComments()
  }, [postId])

  async function loadComments() {
    const { data } = await supabase
      .from('comments')
      .select('*, profiles(username, avatar_url)')
      .eq('post_id', postId)
      .order('created_at', { ascending: true })
    setComments(data || [])
    setLoading(false)
  }

  async function submitComment(text: string, parentId: string | null = null) {
    if (!user) {
      alert('Войдите, чтобы оставить комментарий')
      return
    }
    if (!text.trim()) return

    const { data: profile } = await supabase
      .from('profiles')
      .select('is_banned')
      .eq('id', user.id)
      .single()

    if (profile?.is_banned) {
      alert('Ваш аккаунт заблокирован')
      return
    }

    const found = await findBadWord(text)
    if (found) {
      alert('В комментарии есть недопустимые слова')
      return
    }

    // Rate limit
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

    const { error } = await supabase.from('comments').insert({
      post_id: postId,
      user_id: user.id,
      parent_id: parentId,
      text: text.trim(),
    })

    if (!error) {
      setNewText('')
      setReplyText('')
      setReplyTo(null)
      loadComments()
    }
  }

  const rootComments = comments.filter(c => !c.parent_id)

  function Avatar({
    name,
    url,
    size = 32,
  }: {
    name: string
    url?: string | null
    size?: number
  }) {
    if (url) {
      return (
        <img
          src={url}
          alt=""
          style={{ width: size, height: size }}
          className="rounded-full object-cover flex-shrink-0"
        />
      )
    }
    return (
      <div
        style={{ width: size, height: size }}
        className="rounded-full bg-emerald-mid text-cream flex items-center justify-center text-xs font-bold flex-shrink-0"
      >
        {name[0].toUpperCase()}
      </div>
    )
  }

  function renderComment(c: Comment, depth: number = 0) {
    const children = comments.filter(x => x.parent_id === c.id)
    const name = c.profiles?.username || 'Аноним'

    return (
      <div
        key={c.id}
        className={
          depth > 0
            ? 'ml-6 mt-3 border-l-2 border-emerald-dark/8 pl-4'
            : 'mt-4'
        }
      >
        <div className="flex gap-3">
          <Avatar name={name} url={c.profiles?.avatar_url} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium text-emerald-dark">{name}</span>
              <span className="text-brown/45 text-xs">
                {new Date(c.created_at).toLocaleString('ru-RU', {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
            <p className="text-brown-dark mt-1 whitespace-pre-wrap text-sm leading-relaxed">
              {c.text}
            </p>

            <div className="flex items-center gap-3 mt-1">
              {user && (
                <button
                  onClick={() => setReplyTo(replyTo === c.id ? null : c.id)}
                  className="text-xs text-brown/50 hover:text-wine transition-colors"
                >
                  {replyTo === c.id ? 'Отмена' : 'Ответить'}
                </button>
              )}
              {user && user.id !== c.user_id && (
                <ReportButton commentId={c.id} />
              )}
            </div>

            {replyTo === c.id && (
              <div className="mt-2 flex gap-2">
                <input
                  type="text"
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Ваш ответ…"
                  className="flex-1 border border-emerald-dark/15 rounded-full px-4 py-1.5 text-sm bg-cream-warm/40 focus:outline-none focus:border-emerald-mid"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitComment(replyText, c.id)
                  }}
                />
                <button
                  onClick={() => submitComment(replyText, c.id)}
                  className="bg-wine text-white px-3 py-1.5 rounded-full text-sm hover:bg-wine-dark transition-colors flex items-center"
                >
                  <Send size={14} strokeWidth={1.8} />
                </button>
              </div>
            )}

            {children.map(child => renderComment(child, depth + 1))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <section className="mt-8 pt-6 border-t border-emerald-dark/10">
      <div className="flex items-center gap-2 mb-4">
        <MessageCircle size={17} strokeWidth={1.7} className="text-emerald-mid" />
        <h3 className="font-playfair text-lg font-bold text-emerald-dark">
          Комментарии ({comments.length})
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
              if (e.key === 'Enter') submitComment(newText)
            }}
          />
          <button
            onClick={() => submitComment(newText)}
            className="bg-emerald-mid text-cream px-4 py-2 rounded-full text-sm hover:bg-emerald-dark transition-colors flex items-center"
          >
            <Send size={15} strokeWidth={1.8} />
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

      {loading && <p className="text-sm text-brown/60">Загрузка…</p>}
      {!loading && comments.length === 0 && (
        <p className="text-sm text-brown/60">
          Пока нет комментариев. Будьте первым!
        </p>
      )}

      {rootComments.map(c => renderComment(c))}
    </section>
  )
}