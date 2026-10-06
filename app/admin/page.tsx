'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

export default function AdminPage() {
  const router = useRouter()
  const [tab, setTab] = useState<'reports' | 'pending' | 'words'>('reports')
  const [reports, setReports] = useState<any[]>([])
  const [pending, setPending] = useState<any[]>([])
  const [words, setWords] = useState<any[]>([])
  const [newWord, setNewWord] = useState('')
  const [loading, setLoading] = useState(true)
  const [me, setMe] = useState<any>(null)

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
        return
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()

      if (!profile || (profile.role !== 'admin' && profile.role !== 'moderator')) {
        router.push('/')
        return
      }

      setMe(profile)
      loadAll()
      setLoading(false)
    }
    init()
  }, [router])

  async function loadAll() {
    const { data: r } = await supabase
      .from('reports')
      .select('*, profiles!reports_reporter_id_fkey(username), posts(title)')
      .eq('status', 'open')
      .order('created_at', { ascending: false })
    setReports(r || [])

    const { data: p } = await supabase
      .from('posts')
      .select('*, profiles!posts_user_id_fkey(username), books(id, title, author)')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
    setPending(p || [])

    const { data: w } = await supabase
      .from('stop_words')
      .select('*')
      .order('word')
    setWords(w || [])
  }

  async function approvePost(id: string) {
    const { error } = await supabase
      .from('posts')
      .update({ status: 'approved' })
      .eq('id', id)
    if (error) {
      alert('Ошибка одобрения: ' + error.message)
      return
    }
    await loadAll()
  }

  async function rejectPost(id: string) {
    const reason = prompt('Причина отклонения?') || 'Не соответствует правилам'
    const { error } = await supabase
      .from('posts')
      .update({ status: 'rejected', rejection_reason: reason })
      .eq('id', id)
    if (error) {
      alert('Ошибка отклонения: ' + error.message)
      return
    }
    await loadAll()
  }

  async function deletePost(id: string) {
    if (!confirm('Удалить пост навсегда?')) return

    // Сначала пробуем удалить связанные записи
    await supabase.from('post_images').delete().eq('post_id', id)
    await supabase.from('comments').delete().eq('post_id', id)
    await supabase.from('likes').delete().eq('post_id', id)
    await supabase.from('reports').delete().eq('post_id', id)

    const { error } = await supabase.from('posts').delete().eq('id', id)

    if (error) {
      alert('Ошибка удаления: ' + error.message)
      return
    }
    await loadAll()
  }

  async function banUser(userId: string) {
    if (!confirm('Заблокировать пользователя?')) return
    const { error } = await supabase
      .from('profiles')
      .update({ is_banned: true })
      .eq('id', userId)

    if (error) {
      alert('Ошибка бана: ' + error.message)
      return
    }
    alert('Пользователь заблокирован')
    await loadAll()
  }

  async function resolveReport(id: string) {
    await supabase.from('reports').update({ status: 'resolved' }).eq('id', id)
    loadAll()
  }

  async function addWord() {
    if (!newWord.trim()) return
    await supabase
      .from('stop_words')
      .insert({ word: newWord.trim().toLowerCase() })
    setNewWord('')
    loadAll()
  }

  async function removeWord(id: string) {
    await supabase.from('stop_words').delete().eq('id', id)
    loadAll()
  }

  if (loading) {
    return <main className="p-4 md:p-8 max-w-7xl mx-auto">Загрузка…</main>
  }

  return (
    <main className="p-4 md:p-8 max-w-7xl mx-auto">
      <h1 className="text-2xl md:text-3xl font-bold text-emerald-dark mb-2">
        🛡 Панель модератора
      </h1>
      <p className="text-sm text-brown/60 mb-6">
        Роль: {me?.role}. Жалоб открытых: {reports.length}. Постов на проверке:{' '}
        {pending.length}.
      </p>

      <div className="flex gap-2 mb-6 border-b border-emerald-dark/10 pb-2 overflow-x-auto">
        <button
          onClick={() => setTab('reports')}
          className={`px-4 py-2 rounded text-sm whitespace-nowrap transition-colors ${
            tab === 'reports'
              ? 'bg-wine text-white'
              : 'text-brown/70 hover:text-wine'
          }`}
        >
          ⚠ Жалобы ({reports.length})
        </button>
        <button
          onClick={() => setTab('pending')}
          className={`px-4 py-2 rounded text-sm whitespace-nowrap transition-colors ${
            tab === 'pending'
              ? 'bg-wine text-white'
              : 'text-brown/70 hover:text-wine'
          }`}
        >
          📋 На проверке ({pending.length})
        </button>
        <button
          onClick={() => setTab('words')}
          className={`px-4 py-2 rounded text-sm whitespace-nowrap transition-colors ${
            tab === 'words'
              ? 'bg-wine text-white'
              : 'text-brown/70 hover:text-wine'
          }`}
        >
          🚫 Стоп-слова ({words.length})
        </button>
      </div>

      {tab === 'reports' && (
        <div className="space-y-3">
          {reports.length === 0 && (
            <p className="text-brown/60">Открытых жалоб нет. 🎉</p>
          )}
          {reports.map(r => (
            <div
              key={r.id}
              className="bg-cream-warm/40 border border-emerald-dark/10 rounded-lg p-4"
            >
              <div className="flex justify-between text-sm mb-2 flex-wrap gap-1">
                <span className="text-brown-dark">
                  От <b>{r.profiles?.username || 'аноним'}</b>
                  {r.posts?.title && (
                    <>
                      {' '}
                      на пост <b>«{r.posts.title}»</b>
                    </>
                  )}
                </span>
                <span className="text-brown/50 text-xs">
                  {new Date(r.created_at).toLocaleString('ru-RU')}
                </span>
              </div>
              <p className="text-sm text-brown-dark bg-white/50 p-2 rounded mb-3">
                {r.reason}
              </p>
              <div className="flex gap-2 flex-wrap">
                {r.post_id && (
                  <Link
                    href={`/post/${r.post_id}`}
                    className="text-xs bg-emerald-mid text-cream px-3 py-1 rounded hover:bg-emerald-dark"
                    target="_blank"
                  >
                    Открыть пост
                  </Link>
                )}
                <button
                  onClick={() => resolveReport(r.id)}
                  className="text-xs bg-cream border border-emerald-dark/20 px-3 py-1 rounded hover:bg-cream-warm"
                >
                  Отметить решённой
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'pending' && (
        <div className="space-y-3">
          {pending.length === 0 && (
            <p className="text-brown/60">Нет постов на проверке. 🎉</p>
          )}
          {pending.map(p => (
            <div
              key={p.id}
              className="bg-cream-warm/40 border border-emerald-dark/10 rounded-lg p-4"
            >
              <div className="text-sm text-brown-dark mb-1">
                Автор: <b>{p.profiles?.username || 'аноним'}</b>
              </div>
              {p.books && (
                <div className="text-xs text-brown/60 mb-1">
                  📖 {p.books.title}
                  {p.books.author && ` · ${p.books.author}`}
                </div>
              )}
              <h3 className="font-bold text-emerald-dark mb-2">{p.title}</h3>
              <p className="text-sm text-brown-dark/80 mb-3 whitespace-pre-wrap">
                {p.content}
              </p>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => approvePost(p.id)}
                  className="text-xs bg-emerald-mid text-cream px-3 py-1 rounded hover:bg-emerald-dark"
                >
                  ✓ Одобрить
                </button>
                <button
                  onClick={() => rejectPost(p.id)}
                  className="text-xs bg-wine text-white px-3 py-1 rounded hover:bg-wine-dark"
                >
                  ✕ Отклонить
                </button>
                <button
                  onClick={() => deletePost(p.id)}
                  className="text-xs bg-brown text-cream px-3 py-1 rounded hover:bg-brown-dark"
                >
                  🗑 Удалить
                </button>
                <button
                  onClick={() => banUser(p.user_id)}
                  className="text-xs bg-cream border border-wine/40 text-wine px-3 py-1 rounded hover:bg-wine/10"
                >
                  ⛔ Забанить автора
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'words' && (
        <div>
          <div className="flex gap-2 mb-4">
            <input
              type="text"
              value={newWord}
              onChange={(e) => setNewWord(e.target.value)}
              placeholder="Новое стоп-слово"
              className="flex-1 border border-emerald-dark/20 rounded px-3 py-2 bg-cream-warm/50"
              onKeyDown={(e) => e.key === 'Enter' && addWord()}
            />
            <button
              onClick={addWord}
              className="bg-emerald-mid text-cream px-4 py-2 rounded hover:bg-emerald-dark"
            >
              Добавить
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            {words.map(w => (
              <span
                key={w.id}
                className="bg-cream-warm border border-emerald-dark/20 rounded-full px-3 py-1 text-sm text-brown-dark flex items-center gap-2"
              >
                {w.word}
                <button
                  onClick={() => removeWord(w.id)}
                  className="text-wine hover:text-wine-dark"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
    </main>
  )
}