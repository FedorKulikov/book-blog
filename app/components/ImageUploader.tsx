'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  IMAGE_ACCEPT_ATTR,
  MAX_IMAGE_BYTES,
  validateImageFile,
} from './imageValidation'

type Props = {
  onUploaded: (urls: string[]) => void
}

export default function ImageUploader({ onUploaded }: Props) {
  const [uploading, setUploading] = useState(false)
  const [previews, setPreviews] = useState<string[]>([])
  const [urls, setUrls] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return

    setError(null)

    // Сначала отбираем валидные файлы: неверные пропускаем и говорим почему,
    // но не блокируем загрузку остальных.
    const accepted: File[] = []
    for (const file of Array.from(files)) {
      const check = validateImageFile(file)
      if (check.ok) {
        accepted.push(file)
      } else {
        setError(check.message)
      }
    }

    if (accepted.length === 0) return

    // Не больше 5 новых файлов за раз
    const batch = accepted.slice(0, 5)

    setUploading(true)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      alert('Войдите, чтобы загрузить фото')
      setUploading(false)
      return
    }

    const newUrls: string[] = []

    for (const file of batch) {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
      const fileName = `${user.id}/${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}.${ext}`

      const { error: uploadError } = await supabase.storage
        .from('post-images')
        .upload(fileName, file, { contentType: file.type })

      if (uploadError) {
        setError('Ошибка загрузки: ' + uploadError.message)
        continue
      }

      const { data } = supabase.storage
        .from('post-images')
        .getPublicUrl(fileName)

      newUrls.push(data.publicUrl)
    }

    setPreviews(prev => [...prev, ...newUrls])
    const allUrls = [...urls, ...newUrls]
    setUrls(allUrls)
    onUploaded(allUrls)
    setUploading(false)
  }

  function removeImage(index: number) {
    const updated = urls.filter((_, i) => i !== index)
    setUrls(updated)
    setPreviews(updated)
    onUploaded(updated)
  }

  return (
    <div>
      <label className="block text-sm font-medium mb-1 text-brown-dark">
        Фотографии (до 5)
      </label>

      <input
        type="file"
        accept={IMAGE_ACCEPT_ATTR}
        multiple
        onChange={(e) => {
          void handleFiles(e.target.files)
          // Сбрасываем input: иначе повторный выбор того же файла не сработает
          e.currentTarget.value = ''
        }}
        disabled={uploading}
        className="block w-full text-sm text-brown-dark file:mr-3 file:py-2 file:px-4 file:rounded file:border-0 file:bg-emerald-mid file:text-cream hover:file:bg-emerald-dark file:cursor-pointer cursor-pointer"
      />

      <p className="text-xs text-brown/50 mt-1">
        JPG, PNG, WebP или GIF. До 5 МБ ({(MAX_IMAGE_BYTES / 1024 / 1024).toFixed(0)} МБ)
        на файл.
      </p>

      {uploading && (
        <p className="text-sm text-brown/60 mt-2">Загрузка фото…</p>
      )}

      {error && <p className="text-xs text-wine mt-2">{error}</p>}

      {previews.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-3">
          {previews.map((url, i) => (
            <div key={`${url}-${i}`} className="relative group">
              <img
                src={url}
                alt=""
                className="w-20 h-20 object-cover rounded border border-emerald-dark/20"
              />
              <button
                type="button"
                onClick={() => removeImage(i)}
                className="absolute -top-2 -right-2 bg-wine text-white w-6 h-6 rounded-full text-xs opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                aria-label="Удалить фото"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
