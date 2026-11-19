'use client'

// app/admin/news/ForeignTitleEditor.tsx
// Редактор русских заголовков для зарубежных новостей.
//
// Машинный перевод мы сознательно не используем: он даёт кривые фразы
// в заголовках. Вместо этого редактор вписывает русский вариант вручную,
// а на сайте показывается title_ru, пока его нет — оригинал с пометкой «EN».
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { humanizeError } from '@/lib/errors'
import { ExternalLink } from '@/app/components/icons'

type ForeignItem = {
  id: string
  title: string
  title_ru: string | null
  url: string
  source: string | null
  created_at: string
}

const SELECT_WITH_TRANSLATION =
  'id, title, title_ru, url, source, created_at, lang'
const SELECT_LEGACY = 'id, title, url, source, created_at'

export default function ForeignTitleEditor() {
  const [items, setItems] = useState<ForeignItem[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [savingId, setSavingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [schemaReady, setSchemaReady] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)

    let response = await supabase
      .from('external_news')
      .select(SELECT_WITH_TRANSLATION)
      .eq('lang', 'en')
      .order('created_at', { ascending: false })
      .limit(40)

    if (
      response.error &&
      (response.error.code === '42703' ||
        /column .* does not exist/i.test(response.error.message))
    ) {
      // Миграция 20261123 ещё не применена: редактор просто нечего показывать
      setSchemaReady(false)
      setItems([])
      setLoading(false)
      return
    }

    if (response.error || !response.data) {
      setError(
        'Не удалось загрузить зарубежные новости: ' +
          humanizeError(response.error?.message ?? 'неизвестная ошибка'),
      )
      setLoading(false)
      return
    }

    const rows = response.data as unknown as ForeignItem[]

    setItems(rows)
    setDrafts(
      Object.fromEntries(rows.map(row => [row.id, row.title_ru ?? ''])),
    )
    setError(null)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function save(id: string) {
    const value = (drafts[id] ?? '').trim()

    setSavingId(id)
    setNotice(null)
    setError(null)

    const { data, error: updateError } = await supabase
      .from('external_news')
      .update({ title_ru: value || null })
      .eq('id', id)
      .select('id')

    if (updateError) {
      setError('Не удалось сохранить: ' + humanizeError(updateError.message))
      setSavingId(null)
      return
    }

    // RLS: пустой ответ означает, что прав на запись нет
    if (!data || data.length === 0) {
      setError('Нет прав на изменение: нужна роль admin или moderator.')
      setSavingId(null)
      return
    }

    setItems(prev =>
      prev.map(item => (item.id === id ? { ...item, title_ru: value || null } : item)),
    )
    setNotice(value ? 'Русский заголовок сохранён.' : 'Перевод убран — показываем оригинал.')
    setSavingId(null)
  }

  if (!schemaReady) {
    return (
      <section className="mt-10 rounded-2xl border border-emerald-dark/10 bg-cream-warm/30 p-5">
        <h2 className="font-playfair text-lg font-bold text-emerald-dark mb-2">
          🌍 Русские заголовки зарубежных новостей
        </h2>
        <p className="text-sm text-brown/60">
          Раздел включится после миграции{' '}
          <code className="text-xs">20261123_radar_foreign_and_trends.sql</code>{' '}
          — в ней появляются колонки <code className="text-xs">lang</code> и{' '}
          <code className="text-xs">title_ru</code>.
        </p>
      </section>
    )
  }

  return (
    <section className="mt-10">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-playfair text-lg font-bold text-emerald-dark">
          🌍 Русские заголовки зарубежных новостей
        </h2>
        <button
          type="button"
          onClick={() => void load()}
          className="text-xs text-brown/60 hover:text-wine transition-colors"
        >
          Обновить
        </button>
      </div>

      <p className="mb-4 text-sm text-brown/60">
        Заголовки зарубежных лент показываются на сайте как есть. Впишите
        русский вариант — он появится в «Мировой полке» радара, а оригинал
        останется ниже мелким шрифтом.
      </p>

      {error && <p className="mb-3 text-sm text-wine">{error}</p>}
      {notice && <p className="mb-3 text-sm text-emerald-mid">{notice}</p>}
      {loading && <p className="text-sm text-brown/60">Загрузка…</p>}

      {!loading && items.length === 0 && (
        <p className="text-sm text-brown/60">
          Зарубежных новостей пока нет — они появятся после ближайшего импорта.
        </p>
      )}

      <ul className="space-y-3">
        {items.map(item => {
          const dirty = (drafts[item.id] ?? '') !== (item.title_ru ?? '')

          return (
            <li
              key={item.id}
              className="rounded-xl border border-emerald-dark/10 bg-cream-warm/25 p-4"
            >
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mb-2 inline-flex items-start gap-1 text-sm font-medium text-emerald-dark hover:text-wine transition-colors"
              >
                <span className="line-clamp-2">{item.title}</span>
                <ExternalLink size={12} strokeWidth={1.8} className="mt-1 shrink-0" />
              </a>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={drafts[item.id] ?? ''}
                  onChange={e =>
                    setDrafts(prev => ({ ...prev, [item.id]: e.target.value }))
                  }
                  maxLength={200}
                  placeholder="Русский заголовок…"
                  className="min-w-0 flex-1 rounded-lg border border-emerald-dark/15 bg-cream px-3 py-2 text-sm focus:border-emerald-mid focus:outline-none"
                />

                <button
                  type="button"
                  onClick={() => void save(item.id)}
                  disabled={savingId === item.id || !dirty}
                  className="rounded-full bg-emerald-mid px-4 py-2 text-xs text-cream transition-colors hover:bg-emerald-dark disabled:opacity-40"
                >
                  {savingId === item.id ? 'Сохраняем…' : 'Сохранить'}
                </button>
              </div>

              <p className="mt-1.5 text-[11px] text-brown/40">
                {item.source ?? 'Медиа'} ·{' '}
                {new Intl.DateTimeFormat('ru-RU', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                  timeZone: 'Europe/Moscow',
                }).format(new Date(item.created_at))}
                {item.title_ru ? ' · перевод есть' : ' · перевода нет'}
              </p>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
