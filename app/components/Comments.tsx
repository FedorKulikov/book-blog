'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type Comment = {
  id: string
  post_id: string
  user_id: string
  parent_id: string | null
  text: string
  created_at: string
  profiles?: { username: string }
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
      .select('*, profiles(username)')
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

  // Группируем: корневые комментарии + их дети
  const rootComments = comments.filter(c => !c.parent_id)

  function renderComment(c: Comment, depth: number = 0) {
    const children = comments.filter(x => x.parent_id === c.id)
    return (
      <div
        key={c.id}
        className={depth > 0 ? 'ml-6 mt-3 border-l-2 border-emerald-dark/10 pl-4' : 'mt-4'}
      >
        <div className="flex gap-3">
          <div className="w-8 h-8 rounded-full bg-emerald-mid text-cream flex items-center justify-center text-xs font-bold flex-shrink-0">
            {(c.profiles?.username || '?')[0].toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium text-emerald-dark">
                {c.profiles?.username || 'Аноним'}
              </span>
              <span className="text-brown/50 text-xs">
                {new Date(c.created_at).toLocaleString('ru-RU', {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
            <p className="text-brown-dark mt-1 whitespace-pre-wrap text-sm">
              {c.text}
            </p>
            {user && (
              <button
                onClick={() => setReplyTo(replyTo === c.id ? null : c.id)}
                className="text-xs text-brown/60 hover:text-wine mt-1"
              >
                {replyTo === c.id ? 'Отмена' : 'Ответить'}
              </button>
            )}

            {replyTo === c.id && (
              <div className="mt-2 flex gap-2">
                <input
                  type="text"
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Ваш ответ…"
                  className="flex-1 border border-emerald-dark/20 rounded px-3 py-1.5 text-sm bg-cream-warm/40"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitComment(replyText, c.id)
                  }}
                />
                <button
                  onClick={() => submitComment(replyText, c.id)}
                  className="bg-wine text-white px-3 py-1.5 rounded text-sm hover:bg-wine-dark transition-colors"
                >
                  Отправить
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
    <section className="mt-6 pt-4 border-t border-emerald-dark/10">
      <h3 className="text-lg font-bold text-emerald-dark mb-3">
        💬 Комментарии ({comments.length})
      </h3>

      {user ? (
        <div className="flex gap-2 mb-2">
          <input
            type="text"
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            placeholder="Оставьте комментарий…"
            className="flex-1 border border-emerald-dark/20 rounded px-3 py-2 text-sm bg-cream-warm/40"
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitComment(newText)
            }}
          />
          <button
            onClick={() => submitComment(newText)}
            className="bg-emerald-mid text-cream px-4 py-2 rounded text-sm hover:bg-emerald-dark transition-colors"
          >
            Отправить
          </button>
        </div>
      ) : (
        <p className="text-sm text-brown/60 mb-3">
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
        <p className="text-sm text-brown/60">Пока нет комментариев. Будьте первым!</p>
      )}

      {rootComments.map(c => renderComment(c))}
    </section>
  )
}