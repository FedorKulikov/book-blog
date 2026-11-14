'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { humanizeError } from '@/lib/errors'
import { IMAGE_ACCEPT_ATTR, validateImageFile } from '@/app/components/imageValidation'
import { Upload, X } from '@/app/components/icons'

function explainInsertError(message: string): string {
  const lower = message.toLowerCase()

  if (
    lower.includes('row-level security') ||
    lower.includes('permission denied') ||
    lower.includes('policy')
  ) {
    return 'Нет прав на добавление книги. Войдите в аккаунт.'
  }

  if (lower.includes('duplicate key')) {
    return 'Такая книга уже есть в каталоге.'
  }

  return humanizeError(message)
}

export default function AddBookForm() {
  const router = useRouter()

  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [year, setYear] = useState('')
  const [description, setDescription] = useState('')

  const [coverUrl, setCoverUrl] = useState<string | null>(null)
  const [uploadingCover, setUploadingCover] = useState(false)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCoverFile(file: File | null) {
    if (!file) return

    const check = validateImageFile(file)
    if (!check.ok) {
      setError(check.message)
      return
    }

    setUploadingCover(true)
    setError(null)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setError('Войдите, чтобы загрузить обложку')
      setUploadingCover(false)
      return
    }

    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
    // Обложки кладём в тот же бакет, что и фото постов: там уже настроены
    // лимит 5 МБ и разрешённые MIME-типы.
    const fileName = `${user.id}/book-cover-${Date.now()}.${ext}`

    const { error: uploadError } = await supabase.storage
      .from('post-images')
      .upload(fileName, file, { contentType: file.type })

    if (uploadError) {
      setError('Не удалось загрузить обложку: ' + humanizeError(uploadError.message))
      setUploadingCover(false)
      return
    }

    const { data } = supabase.storage.from('post-images').getPublicUrl(fileName)
    setCoverUrl(data.publicUrl)
    setUploadingCover(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    const cleanTitle = title.trim()
    if (cleanTitle.length < 1) {
      setError('Укажите название книги.')
      return
    }
    if (cleanTitle.length > 200) {
      setError('Название — не длиннее 200 символов.')
      return
    }

    let parsedYear: number | null = null
    if (year.trim()) {
      const n = Number(year)
      if (!Number.isFinite(n) || n < 0 || n > 2100) {
        setError('Год должен быть числом от 0 до 2100.')
        return
      }
      parsedYear = Math.trunc(n)
    }

    setSaving(true)
    setError(null)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setError('Войдите в аккаунт')
      setSaving(false)
      return
    }

    const { data, error: insertError } = await supabase
      .from('books')
      .insert({
        title: cleanTitle,
        author: author.trim() || null,
        year: parsedYear,
        description: description.trim() || null,
        cover_url: coverUrl,
        created_by: user.id,
      })
      .select('id')
      .single()

    if (insertError) {
      console.error('[add-book] insert failed:', insertError.message)
      setError(explainInsertError(insertError.message))
      setSaving(false)
      return
    }

    const created = data as unknown as { id: string }
    router.push(`/book/${created.id}`)
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label className="block text-sm font-medium mb-1 text-brown-dark">
          Название <span className="text-wine">*</span>
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          maxLength={200}
          placeholder="Например: Мастер и Маргарита"
          className="w-full border border-emerald-dark/15 rounded-lg px-3 py-2 bg-cream-warm/40 focus:outline-none focus:border-emerald-mid"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1 text-brown-dark">
            Автор
          </label>
          <input
            type="text"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            maxLength={120}
            placeholder="Михаил Булгаков"
            className="w-full border border-emerald-dark/15 rounded-lg px-3 py-2 bg-cream-warm/40 focus:outline-none focus:border-emerald-mid"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1 text-brown-dark">
            Год
          </label>
          <input
            type="number"
            inputMode="numeric"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            min={0}
            max={2100}
            placeholder="1967"
            className="w-full border border-emerald-dark/15 rounded-lg px-3 py-2 bg-cream-warm/40 focus:outline-none focus:border-emerald-mid"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1 text-brown-dark">
          Описание
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={6}
          placeholder="О чём книга, почему её стоит прочитать…"
          className="w-full border border-emerald-dark/15 rounded-lg px-3 py-2 bg-cream-warm/40 font-sans focus:outline-none focus:border-emerald-mid"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1 text-brown-dark">
          Обложка
        </label>

        <div className="flex items-center gap-4">
          <div className="w-16 h-24 rounded-lg overflow-hidden bg-emerald-mid/10 flex items-center justify-center flex-shrink-0">
            {coverUrl ? (
              <img src={coverUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="text-[10px] text-brown/40 text-center px-1">
                нет обложки
              </span>
            )}
          </div>

          <div className="flex-1">
            <label className="inline-flex items-center gap-2 cursor-pointer bg-emerald-mid hover:bg-emerald-dark text-cream text-sm px-4 py-2 rounded-lg transition-colors">
              <Upload size={15} strokeWidth={1.8} />
              <span>{coverUrl ? 'Заменить файл' : 'Выбрать файл'}</span>
              <input
                type="file"
                accept={IMAGE_ACCEPT_ATTR}
                disabled={uploadingCover}
                onChange={(e) => {
                  void handleCoverFile(e.target.files?.[0] || null)
                  e.currentTarget.value = ''
                }}
                className="hidden"
              />
            </label>

            {uploadingCover && (
              <p className="text-xs text-brown/60 mt-2">Загрузка обложки…</p>
            )}

            {coverUrl && !uploadingCover && (
              <button
                type="button"
                onClick={() => setCoverUrl(null)}
                className="mt-2 flex items-center gap-1 text-xs text-brown/50 hover:text-wine transition-colors"
              >
                <X size={12} strokeWidth={2} />
                <span>Убрать обложку</span>
              </button>
            )}

            <p className="text-xs text-brown/50 mt-2">
              JPG, PNG, WebP или GIF. До 5 МБ.
            </p>
          </div>
        </div>
      </div>

      {error && <p className="text-wine text-sm">Ошибка: {error}</p>}

      <div className="flex flex-col sm:flex-row gap-3">
        <button
          type="submit"
          disabled={saving || uploadingCover}
          className="flex-1 rounded-full bg-wine px-4 py-2.5 text-sm text-white transition-colors hover:bg-wine-dark disabled:opacity-50"
        >
          {saving ? 'Сохраняем…' : 'Добавить книгу'}
        </button>
        <Link
          href="/books"
          className="flex-1 rounded-full border border-emerald-dark/15 bg-cream-warm px-4 py-2.5 text-center text-sm text-brown-dark transition-colors hover:bg-cream"
        >
          Отмена
        </Link>
      </div>
    </form>
  )
}
