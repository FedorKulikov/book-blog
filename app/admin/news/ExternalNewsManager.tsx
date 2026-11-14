'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { humanizeError } from '@/lib/errors'
import { ExternalLink, Trash2 } from '@/app/components/icons'

type ExternalNewsItem = {
  id: string
  title: string
  url: string
  source: string
  summary: string | null
  created_at: string
}

function explainError(message: string): string {
  const lower = message.toLowerCase()

  if (
    lower.includes('row-level security') ||
    lower.includes('permission denied') ||
    lower.includes('policy')
  ) {
    return 'Нет прав: добавлять внешние новости могут только admin и moderator.'
  }

  return humanizeError(message)
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export default function ExternalNewsManager() {
  const [items, setItems] = useState<ExternalNewsItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [source, setSource] = useState('Читай-город')
  const [summary, setSummary] = useState('')

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase
      .from('external_news')
      .select('id, title, url, source, summary, created_at')
      .order('created_at', { ascending: false })
      .limit(50)

    if (loadError) {
      setError('Не удалось загрузить новости: ' + humanizeError(loadError.message))
      setLoading(false)
      return
    }

    setItems((data ?? []) as unknown as ExternalNewsItem[])
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    const cleanTitle = title.trim()
    const cleanUrl = url.trim()
    const cleanSource = source.trim() || 'Читай-город'
    const cleanSummary = summary.trim()

    if (cleanTitle.length < 3) {
      setError('Заголовок — минимум 3 символа.')
      return
    }
    if (!isValidUrl(cleanUrl)) {
      setError('Ссылка должна начинаться с http:// или https://')
      return
    }

    setSaving(true)
    setError(null)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setError('Войдите в аккаунт')
      setSaving(false)
      return
    }

    const { error: insertError } = await supabase.from('external_news').insert({
      title: cleanTitle,
      url: cleanUrl,
      source: cleanSource,
      summary: cleanSummary || null,
      created_by: user.id,
    })

    if (insertError) {
      console.error('[external-news] insert failed:', insertError.message)
      setError(explainError(insertError.message))
      setSaving(false)
      return
    }

    setTitle('')
    setUrl('')
    setSummary('')
    setSaving(false)
    await load()
  }

  async function handleDelete(id: string) {
    if (!confirm('Удалить эту новость?')) return

    setDeletingId(id)
    setError(null)

    const { error: deleteError } = await supabase
      .from('external_news')
      .delete()
      .eq('id', id)

    if (deleteError) {
      setError(explainError(deleteError.message))
      setDeletingId(null)
      return
    }

    setItems(prev => prev.filter(i => i.id !== id))
    setDeletingId(null)
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,420px)_1fr] gap-8 items-start">
      {/* Форма */}
      <form
        onSubmit={handleSubmit}
        className="bg-cream-warm/30 border border-emerald-dark/10 rounded-2xl p-5 space-y-4"
      >
        <h2 className="font-playfair text-lg font-bold text-emerald-dark">
          Добавить новость
        </h2>

        <div>
          <label className="block text-sm font-medium mb-1 text-brown-dark">
            Заголовок <span className="text-wine">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={200}
            placeholder="Новая книга Пелевина вышла в свет"
            className="w-full border border-emerald-dark/15 rounded-lg px-3 py-2 bg-cream focus:outline-none focus:border-emerald-mid"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1 text-brown-dark">
            Ссылка <span className="text-wine">*</span>
          </label>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
            placeholder="https://www.chitai-gorod.ru/news/..."
            className="w-full border border-emerald-dark/15 rounded-lg px-3 py-2 bg-cream focus:outline-none focus:border-emerald-mid"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1 text-brown-dark">
            Источник
          </label>
          <input
            type="text"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            maxLength={60}
            className="w-full border border-emerald-dark/15 rounded-lg px-3 py-2 bg-cream focus:outline-none focus:border-emerald-mid"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1 text-brown-dark">
            Краткое описание
          </label>
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={4}
            maxLength={400}
            placeholder="О чём новость в двух словах…"
            className="w-full border border-emerald-dark/15 rounded-lg px-3 py-2 bg-cream font-sans focus:outline-none focus:border-emerald-mid"
          />
        </div>

        {error && <p className="text-wine text-sm">{error}</p>}

        <button
          type="submit"
          disabled={saving}
          className="w-full rounded-full bg-emerald-mid px-4 py-2.5 text-sm text-cream transition-colors hover:bg-emerald-dark disabled:opacity-50"
        >
          {saving ? 'Сохраняем…' : 'Добавить новость'}
        </button>

        <p className="text-xs text-brown/50">
          Публикуется только заголовок, короткое описание и ссылка на
          первоисточник — так безопасно с точки зрения авторских прав.
        </p>
      </form>

      {/* Список */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-playfair text-lg font-bold text-emerald-dark">
            Опубликованные ({items.length})
          </h2>
          <button
            type="button"
            onClick={() => void load()}
            className="text-xs text-brown/60 hover:text-wine transition-colors"
          >
            Обновить
          </button>
        </div>

        {loading && <p className="text-sm text-brown/60">Загрузка…</p>}

        {!loading && items.length === 0 && (
          <p className="text-sm text-brown/60">Пока ничего не добавлено.</p>
        )}

        <ul className="space-y-3">
          {items.map(item => (
            <li
              key={item.id}
              className="bg-cream-warm/25 border border-emerald-dark/8 rounded-xl p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-emerald-dark hover:text-wine transition-colors inline-flex items-center gap-1"
                  >
                    <span className="line-clamp-2">{item.title}</span>
                    <ExternalLink size={12} strokeWidth={1.8} className="shrink-0" />
                  </a>

                  {item.summary && (
                    <p className="text-xs text-brown/60 mt-1 line-clamp-2">
                      {item.summary}
                    </p>
                  )}

                  <p className="text-[11px] text-brown/40 mt-1.5">
                    {item.source} ·{' '}
                    {new Intl.DateTimeFormat('ru-RU', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                      timeZone: 'Europe/Moscow',
                    }).format(new Date(item.created_at))}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => void handleDelete(item.id)}
                  disabled={deletingId === item.id}
                  className="text-brown/40 hover:text-wine transition-colors disabled:opacity-50"
                  title="Удалить"
                  aria-label="Удалить новость"
                >
                  <Trash2 size={14} strokeWidth={1.8} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
