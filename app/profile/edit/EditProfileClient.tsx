'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import AvatarUploader from '@/app/components/AvatarUploader'
import { ChevronLeft } from '@/app/components/icons'
import PasskeySecurity from '@/app/components/PasskeySecurity'
import ChangePassword from '@/app/components/ChangePassword'
import EmailRecoverySecurity from '@/app/components/EmailRecoverySecurity'

type ConsentRow = {
  scope: string
  granted_at: string
  revoked_at: string | null
  document_version: string
}

function formatGrantedAt(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Europe/Moscow',
  }).format(new Date(value))
}

export default function EditProfilePage() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [bio, setBio] = useState('')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [notificationsMuted, setNotificationsMuted] = useState(false)
  const [profileConsentActive, setProfileConsentActive] = useState(false)
  const [profileConsentGrantedAt, setProfileConsentGrantedAt] = useState<string | null>(null)
  const [profileConsentChecked, setProfileConsentChecked] = useState(false)
  const [consentLoading, setConsentLoading] = useState(false)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [consentError, setConsentError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true

    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        const currentPath = `${window.location.pathname}${window.location.search}`
        router.push(`/login?next=${encodeURIComponent(currentPath)}`)
        return
      }

      const [{ data: profile }, { data: consentRows, error: consentReadError }] = await Promise.all([
        supabase
          .from('profiles')
          .select('username, bio, avatar_url, notifications_muted')
          .eq('id', user.id)
          .single(),
        supabase.rpc('my_distribution_consents'),
      ])

      if (!alive) return

      if (profile) {
        setUsername(profile.username)
        setBio(profile.bio || '')
        setAvatarUrl(profile.avatar_url)
        setNotificationsMuted(!!profile.notifications_muted)
      }

      if (consentReadError || !Array.isArray(consentRows)) {
        setConsentError('Не удалось проверить согласие. Публичные изменения будут доступны после повторной проверки; приватные настройки можно сохранить.')
      } else {
        const active = (consentRows as ConsentRow[])
          .filter(row => row.scope === 'profile_public' && row.revoked_at === null)
          .sort((a, b) => Date.parse(b.granted_at) - Date.parse(a.granted_at))[0]

        if (active) {
          setProfileConsentActive(true)
          setProfileConsentGrantedAt(active.granted_at)
        }
      }

      setLoading(false)
    }

    void load()
    return () => {
      alive = false
    }
  }, [router])

  async function grantProfileConsent() {
    if (profileConsentActive || consentLoading) return

    setProfileConsentChecked(true)
    setConsentLoading(true)
    setConsentError(null)

    try {
      // The endpoint derives the user from auth.getUser() and writes the
      // fixed profile_public scope/categories/version server-side.
      const response = await fetch('/api/profile/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
      })
      const result = (await response.json()) as {
        active?: boolean
        grantedAt?: string
        error?: string
      }

      if (!response.ok || !result.active || !result.grantedAt) {
        setProfileConsentChecked(false)
        setConsentError(result.error ?? 'Не удалось записать согласие. Попробуйте ещё раз.')
        return
      }

      setProfileConsentActive(true)
      setProfileConsentGrantedAt(result.grantedAt)
      setProfileConsentChecked(false)
    } catch {
      setProfileConsentChecked(false)
      setConsentError('Не удалось отправить согласие. Проверьте соединение и попробуйте ещё раз.')
    } finally {
      setConsentLoading(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (saving || avatarUploading) return

    setSaving(true)
    setError(null)

    try {
      const response = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          username: username.trim(),
          bio: bio.trim() || null,
          avatarUrl,
          notificationsMuted,
        }),
      })

      const result = (await response.json()) as { error?: string }
      if (!response.ok) {
        setError(result.error ?? 'Не удалось сохранить профиль.')
        setSaving(false)
        return
      }

      router.push('/profile')
      router.refresh()
    } catch {
      setError('Не удалось отправить изменения. Проверьте соединение и попробуйте ещё раз.')
      setSaving(false)
    }
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
        <section className="rounded-xl border border-emerald-dark/15 bg-cream-warm/20 p-4">
          <h2 className="font-semibold text-emerald-dark mb-2">
            Распространение публичных полей профиля
          </h2>

          {profileConsentActive && profileConsentGrantedAt ? (
            <p className="text-sm leading-relaxed text-brown-dark">
              <span className="font-semibold text-emerald-mid">Согласие действует.</span>
              {' '}Выдано: {formatGrantedAt(profileConsentGrantedAt)}.
              {' '}
              <Link
                href="/consent-distribution"
                target="_blank"
                rel="noopener noreferrer"
                className="text-wine underline hover:text-wine-dark"
              >
                Какие данные видны посетителям
              </Link>
            </p>
          ) : (
            <>
              <div className="flex items-start gap-3">
                <input
                  id="profile-public-consent"
                  type="checkbox"
                  checked={profileConsentChecked}
                  disabled={consentLoading}
                  onChange={(event) => {
                    if (event.target.checked) void grantProfileConsent()
                    else setProfileConsentChecked(false)
                  }}
                  className="mt-1 h-4 w-4 accent-wine disabled:opacity-50"
                />
                <label htmlFor="profile-public-consent" className="text-sm leading-relaxed text-brown-dark">
                  Согласен на распространение публичных полей профиля: имени
                  пользователя, аватара, описания и даты регистрации.
                  {' '}
                  <Link
                    href="/consent-distribution"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-wine underline hover:text-wine-dark"
                  >
                    Подробнее о данных и отзыве согласия
                  </Link>
                </label>
              </div>
              {consentLoading && (
                <p role="status" className="mt-2 text-xs text-brown/60">
                  Записываем согласие…
                </p>
              )}
            </>
          )}

          {consentError && (
            <p role="alert" className="mt-2 text-sm text-wine">
              {consentError}
            </p>
          )}
        </section>

        <AvatarUploader
          currentUrl={avatarUrl}
          onUploaded={setAvatarUrl}
          disabled={!profileConsentActive}
          onUploadingChange={setAvatarUploading}
        />

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
          <span className="text-xs text-brown/50">(приватная настройка)</span>
        </label>

        {error && <p role="alert" className="text-wine text-sm">Ошибка: {error}</p>}

        <button
          type="submit"
          disabled={saving || avatarUploading || consentLoading}
          className="w-full bg-wine text-white py-2.5 rounded-lg hover:bg-wine-dark disabled:opacity-50 transition-colors"
        >
          {saving ? 'Сохраняем…' : avatarUploading ? 'Загружается аватар…' : 'Сохранить'}
        </button>
      </form>

      <section className="mt-8 space-y-5">
        <h2 className="font-playfair text-xl font-bold text-emerald-dark">
          Безопасность аккаунта
        </h2>
        <EmailRecoverySecurity />
        <PasskeySecurity />
        <ChangePassword />
      </section>
    </main>
  )
}
