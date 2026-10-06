'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Upload } from './icons'

type Props = {
  currentUrl?: string | null
  onUploaded: (url: string) => void
}

export default function AvatarUploader({ currentUrl, onUploaded }: Props) {
  const [uploading, setUploading] = useState(false)
  const [preview, setPreview] = useState<string | null>(currentUrl || null)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File | null) {
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      setError('Файл больше 5 МБ')
      return
    }
    if (!file.type.startsWith('image/')) {
      setError('Только изображения')
      return
    }

    setUploading(true)
    setError(null)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setError('Войдите в аккаунт')
      setUploading(false)
      return
    }

    const ext = file.name.split('.').pop()
    const fileName = `${user.id}/avatar-${Date.now()}.${ext}`

    const { error: upErr } = await supabase.storage
      .from('avatars')
      .upload(fileName, file, { upsert: true })

    if (upErr) {
      setError(upErr.message)
      setUploading(false)
      return
    }

    const { data } = supabase.storage.from('avatars').getPublicUrl(fileName)
    setPreview(data.publicUrl)
    onUploaded(data.publicUrl)
    setUploading(false)
  }

  return (
    <div>
      <label className="block text-sm font-medium mb-2 text-brown-dark">
        Аватар
      </label>
      <div className="flex items-center gap-4">
        <div className="w-20 h-20 rounded-full overflow-hidden bg-emerald-mid text-cream flex items-center justify-center text-2xl font-bold flex-shrink-0 border border-emerald-dark/10">
          {preview ? (
            <img src={preview} alt="" className="w-full h-full object-cover" />
          ) : (
            '?'
          )}
        </div>
        <div className="flex-1">
          <label className="inline-flex items-center gap-2 cursor-pointer bg-emerald-mid hover:bg-emerald-dark text-cream text-sm px-4 py-2 rounded-lg transition-colors">
            <Upload size={15} strokeWidth={1.8} />
            <span>Выбрать файл</span>
            <input
              type="file"
              accept="image/*"
              disabled={uploading}
              onChange={(e) => handleFile(e.target.files?.[0] || null)}
              className="hidden"
            />
          </label>
          {uploading && (
            <p className="text-xs text-brown/60 mt-2">Загрузка…</p>
          )}
          {error && <p className="text-xs text-wine mt-2">{error}</p>}
          <p className="text-xs text-brown/50 mt-2">
            JPG, PNG. До 5 МБ.
          </p>
        </div>
      </div>
    </div>
  )
}