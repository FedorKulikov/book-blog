'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'

type Props = {
  onUploaded: (urls: string[]) => void
}

export default function ImageUploader({ onUploaded }: Props) {
  const [uploading, setUploading] = useState(false)
  const [previews, setPreviews] = useState<string[]>([])
  const [urls, setUrls] = useState<string[]>([])

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(true)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      alert('Войдите, чтобы загрузить фото')
      setUploading(false)
      return
    }

    const newUrls: string[] = []

    for (const file of Array.from(files).slice(0, 5)) {
      const ext = file.name.split('.').pop()
      const fileName = `${user.id}/${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}.${ext}`

      const { error } = await supabase.storage
        .from('post-images')
        .upload(fileName, file)

      if (error) {
        alert('Ошибка загрузки: ' + error.message)
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
        accept="image/*"
        multiple
        onChange={(e) => handleFiles(e.target.files)}
        disabled={uploading}
        className="block w-full text-sm text-brown-dark file:mr-3 file:py-2 file:px-4 file:rounded file:border-0 file:bg-emerald-mid file:text-cream hover:file:bg-emerald-dark file:cursor-pointer cursor-pointer"
      />

      {uploading && (
        <p className="text-sm text-brown/60 mt-2">Загрузка фото…</p>
      )}

      {previews.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-3">
          {previews.map((url, i) => (
            <div key={i} className="relative group">
              <img
                src={url}
                alt=""
                className="w-20 h-20 object-cover rounded border border-emerald-dark/20"
              />
              <button
                type="button"
                onClick={() => removeImage(i)}
                className="absolute -top-2 -right-2 bg-wine text-white w-6 h-6 rounded-full text-xs opacity-0 group-hover:opacity-100 transition-opacity"
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