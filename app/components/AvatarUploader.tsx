'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Upload } from './icons'
import { IMAGE_ACCEPT_ATTR, validateImageFile } from './imageValidation'
import AvatarCropper from './AvatarCropper'

type Props = {
  currentUrl?: string | null
  onUploaded: (url: string) => void
  disabled?: boolean
  onUploadingChange?: (uploading: boolean) => void
}

export default function AvatarUploader({
  currentUrl,
  onUploaded,
  disabled = false,
  onUploadingChange,
}: Props) {
  const [uploading, setUploading] = useState(false)
  const [preview, setPreview] = useState<string | null>(currentUrl || null)
  const [error, setError] = useState<string | null>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)

  function handleFile(file: File | null) {
    if (disabled || !file) return

    const check = validateImageFile(file)
    if (!check.ok) {
      setError(check.message)
      return
    }

    setError(null)
    setPendingFile(file)
  }

  async function handleCroppedSave(blob: Blob) {
    if (disabled || uploading) return

    setUploading(true)
    onUploadingChange?.(true)
    setError(null)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setError('Войдите в аккаунт')
        return
      }

      const fileName = `${user.id}/avatar-${Date.now()}.jpg`
      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(fileName, blob, { upsert: true, contentType: 'image/jpeg' })

      if (upErr) {
        setError(
          upErr.message.includes('row-level security')
            ? 'Для загрузки аватара требуется активное согласие на распространение публичных полей профиля.'
            : upErr.message,
        )
        return
      }

      const { data } = supabase.storage.from('avatars').getPublicUrl(fileName)
      setPreview(data.publicUrl)
      onUploaded(data.publicUrl)
      setPendingFile(null)
    } catch {
      setError('Не удалось загрузить аватар. Проверьте соединение и попробуйте ещё раз.')
    } finally {
      setUploading(false)
      onUploadingChange?.(false)
    }
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
          <label className={`inline-flex items-center gap-2 bg-emerald-mid text-cream text-sm px-4 py-2 rounded-lg transition-colors ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-emerald-dark'}`}>
            <Upload size={15} strokeWidth={1.8} />
            <span>Выбрать файл</span>
            <input
              type="file"
              accept={IMAGE_ACCEPT_ATTR}
              disabled={disabled || uploading}
              onChange={(e) => {
                handleFile(e.target.files?.[0] || null)
                e.currentTarget.value = ''
              }}
              className="hidden"
            />
          </label>
          {uploading && (
            <p className="text-xs text-brown/60 mt-2">Загрузка…</p>
          )}
          {error && <p role="alert" className="text-xs text-wine mt-2">{error}</p>}
          {disabled && (
            <p className="text-xs text-brown/60 mt-2">
              Чтобы новый аватар не стал публичным раньше согласия, сначала
              подтвердите отдельный пункт о распространении полей профиля.
            </p>
          )}
          <p className="text-xs text-brown/50 mt-2">
            JPG, PNG, WebP или GIF. До 5 МБ. После выбора можно подвинуть
            и обрезать фото.
          </p>
        </div>
      </div>

      {pendingFile && (
        <AvatarCropper
          file={pendingFile}
          uploading={uploading}
          onCancel={() => {
            if (!uploading) setPendingFile(null)
          }}
          onSave={handleCroppedSave}
        />
      )}
    </div>
  )
}
