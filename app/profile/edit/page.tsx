'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import AvatarUploader from '@/app/components/AvatarUploader'
import { ChevronLeft } from '@/app/components/icons'

export default function EditProfilePage() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [bio, setBio] = useState('')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [notificationsMuted, setNotificationsMuted] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
        return
      }
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()
      if (data) {
        setUsername(data.username)
        setBio(data.bio || '')
        setAvatarUrl(data.avatar_url)
        setNotificationsMuted(!!data.notifications_muted)
      }
      setLoading(false)
    }
    load()
  }, [router])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { error: upErr } = await supabase
      .from('profiles')
      .update({
        username: username.trim(),
        bio: bio.trim() || null,
        avatar_url: avatarUrl,
        notifications_muted: notificationsMuted,
      })
      .eq('id', user.id)

    if (upErr) {
      setError(upErr.message)
      setSaving(false)
      return
    }

    router.push('/profile')
    router.refresh()
  }

  if (loading) {
    return <main className="p-4 md:p-8 max-w-2xl mx-auto">Загрузка…</main>
  }

  return (
    <main className="p-4 md:p-8 max-w-2xl mx-auto">
      <Link
        href="/profile"
        className="flex items-center gap-1 text-sm text-brown/70 hover:text-wine mb-6 transition-colors"
      >
        <ChevronLeft size={15} strokeWidth={2} />
        <span>Назад в профиль</span>
      </Link>

      <h1 className="font-playfair text-2xl md:text-3xl font-bold text-emerald-dark mb-8">
        Редактирование профиля
      </h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        <AvatarUploader currentUrl={avatarUrl} onUploaded={setAvatarUrl} />

        <div>
          <label className="block text-sm font-medium mb-1 text-brown-dark">
            Имя пользователя
          </label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            minLength={3}
            maxLength={30}
            pattern="[a-zA-Z0-9_]+"
            className="w-full border border-emerald-dark/15 rounded-lg px-3 py-2 bg-cream-warm/40 focus:outline-none focus:border-emerald-mid"
          />
          <p className="text-xs text-brown/50 mt-1">
            Только латиница, цифры и подчёркивание
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1 text-brown-dark">
            О себе
          </label>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={4}
            maxLength={300}
            className="w-full border border-emerald-dark/15 rounded-lg px-3 py-2 bg-cream-warm/40 font-sans focus:outline-none focus:border-emerald-mid"
            placeholder="Любимые жанры, книги, что-то о себе…"
          />
          <p className="text-xs text-brown/50 mt-1">{bio.length}/300</p>
        </div>

        <label className="flex items-center gap-2 text-sm text-brown-dark">
          <input
            type="checkbox"
            checked={notificationsMuted}
            onChange={(e) => setNotificationsMuted(e.target.checked)}
            className="w-4 h-4 accent-wine"
          />
          <span>Не показывать уведомления о новых сообщениях</span>
        </label>

        {error && <p className="text-wine text-sm">Ошибка: {error}</p>}

        <button
          type="submit"
          disabled={saving}
          className="w-full bg-wine text-white py-2.5 rounded-lg hover:bg-wine-dark disabled:opacity-50 transition-colors"
        >
          {saving ? 'Сохраняем…' : 'Сохранить'}
        </button>
      </form>
    </main>
  )
}