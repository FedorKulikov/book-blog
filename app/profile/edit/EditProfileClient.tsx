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

type LegacyPromptState = {
  has_approved_posts: boolean
  has_legacy_profile: boolean
  already_prompted: boolean
  profile_public_active: boolean
  publication_active: boolean
  legacy_choice: 'granted' | 'hidden' | null
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
  const [publicationConsentActive, setPublicationConsentActive] = useState(false)
  const [legacyPromptState, setLegacyPromptState] = useState<LegacyPromptState | null>(null)
  const [legacyPromptBusy, setLegacyPromptBusy] = useState(false)
  const [legacyPromptError, setLegacyPromptError] = useState<string | null>(null)
  const [restoreLegacyBusy, setRestoreLegacyBusy] = useState(false)
  const [restoreLegacyError, setRestoreLegacyError] = useState<string | null>(null)
  const [showRevokeDialog, setShowRevokeDialog] = useState(false)
  const [consentLoading, setConsentLoading] = useState(false)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [consentError, setConsentError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [profileLoadError, setProfileLoadError] = useState<string | null>(null)
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

      const [
        { data: profile, error: profileReadError },
        { data: consentRows, error: consentReadError },
        { data: notificationsMutedValue, error: notificationsError },
        { data: legacyPromptRows, error: legacyReadError },
      ] = await Promise.all([
        supabase
          .from('profiles')
          .select('username, bio, avatar_url')
          .eq('id', user.id)
          .single(),
        supabase.rpc('my_distribution_consents'),
        supabase.rpc('my_profile_notification_settings'),
        supabase.rpc('my_legacy_distribution_prompt_state'),
      ])

      if (!alive) return

      if (profileReadError || !profile) {
        console.error('[profile-edit] failed to load current profile:', profileReadError?.message ?? 'profile row not found')
        setProfileLoadError('Не удалось загрузить данные профиля. Форма сохранения заблокирована, чтобы не затереть имя пользователя. Обновите страницу и попробуйте ещё раз.')
        setLoading(false)
        return
      }

      setUsername(profile.username ?? '')
      setBio(profile.bio || '')
      setAvatarUrl(profile.avatar_url)
      if (!notificationsError && typeof notificationsMutedValue === 'boolean') {
        setNotificationsMuted(notificationsMutedValue)
      } else {
        setConsentError('Не удалось загрузить настройку уведомлений. Приватную настройку пока нельзя сохранить.')
      }

      if (consentReadError || !Array.isArray(consentRows)) {
        setConsentError('Не удалось проверить согласия. Обновите страницу перед изменением настроек распространения.')
      } else {
        const rows = consentRows as ConsentRow[]
        const activeProfile = rows
          .filter(row => row.scope === 'profile_public' && row.revoked_at === null)
          .sort((a, b) => Date.parse(b.granted_at) - Date.parse(a.granted_at))[0]
        const activePublication = rows
          .filter(row => row.scope === 'publication' && row.revoked_at === null)
          .sort((a, b) => Date.parse(b.granted_at) - Date.parse(a.granted_at))[0]

        setProfileConsentActive(Boolean(activeProfile))
        setProfileConsentGrantedAt(activeProfile?.granted_at ?? null)
        setPublicationConsentActive(Boolean(activePublication))
      }

      if (legacyReadError || !Array.isArray(legacyPromptRows)) {
        setLegacyPromptError('Не удалось проверить, есть ли у вас ранее опубликованные материалы.')
      } else {
        setLegacyPromptState((legacyPromptRows[0] as LegacyPromptState | undefined) ?? null)
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

  async function resolveLegacyPrompt(decision: 'grant_existing' | 'hide_existing') {
    if (legacyPromptBusy) return

    setLegacyPromptBusy(true)
    setLegacyPromptError(null)

    try {
      const { error: decisionError } = await supabase.rpc(
        'resolve_my_legacy_distribution_prompt',
        { p_decision: decision },
      )

      if (decisionError) {
        setLegacyPromptError(
          'Не удалось сохранить выбор. Ваши материалы останутся в прежнем состоянии. Попробуйте ещё раз.',
        )
        return
      }

      const [{ data: rows, error: rowsError }, { data: promptRows, error: promptError }] = await Promise.all([
        supabase.rpc('my_distribution_consents'),
        supabase.rpc('my_legacy_distribution_prompt_state'),
      ])

      if (rowsError || !Array.isArray(rows) || promptError || !Array.isArray(promptRows)) {
        setLegacyPromptError('Выбор сохранён, но состояние согласий не удалось обновить. Перезагрузите страницу.')
        router.refresh()
        return
      }

      const consentRows = rows as ConsentRow[]
      const activeProfile = consentRows
        .filter(row => row.scope === 'profile_public' && row.revoked_at === null)
        .sort((a, b) => Date.parse(b.granted_at) - Date.parse(a.granted_at))[0]
      const activePublication = consentRows.some(
        row => row.scope === 'publication' && row.revoked_at === null,
      )

      setProfileConsentActive(Boolean(activeProfile))
      setProfileConsentGrantedAt(activeProfile?.granted_at ?? null)
      setPublicationConsentActive(activePublication)
      setLegacyPromptState((promptRows[0] as LegacyPromptState | undefined) ?? null)
      router.refresh()
    } catch {
      setLegacyPromptError('Не удалось отправить выбор. Проверьте соединение и попробуйте ещё раз.')
    } finally {
      setLegacyPromptBusy(false)
    }
  }


  async function restoreLegacyMaterials() {
    if (restoreLegacyBusy || legacyPromptState?.legacy_choice !== 'hidden') return

    setRestoreLegacyBusy(true)
    setRestoreLegacyError(null)

    try {
      const response = await fetch('/api/profile/restore-legacy', {
        method: 'POST',
        cache: 'no-store',
      })
      const result = (await response.json()) as {
        restored?: boolean
        legacyChoice?: 'granted' | 'hidden' | null
        publicationGrantedAt?: string | null
        profilePublicGrantedAt?: string | null
        error?: string
      }

      if (!response.ok || !result.restored || result.legacyChoice !== 'granted') {
        setRestoreLegacyError(result.error ?? 'Не удалось вернуть материалы. Попробуйте ещё раз.')
        return
      }

      setLegacyPromptState(previous => previous
        ? {
            ...previous,
            legacy_choice: 'granted',
            publication_active: Boolean(result.publicationGrantedAt),
            profile_public_active: Boolean(result.profilePublicGrantedAt),
          }
        : previous)
      setPublicationConsentActive(Boolean(result.publicationGrantedAt))
      if (result.profilePublicGrantedAt) {
        setProfileConsentActive(true)
        setProfileConsentGrantedAt(result.profilePublicGrantedAt)
      }
      router.refresh()
    } catch {
      setRestoreLegacyError('Не удалось отправить запрос. Проверьте соединение и попробуйте ещё раз.')
    } finally {
      setRestoreLegacyBusy(false)
    }
  }

  async function revokeAllDistributionConsents() {
    if (consentLoading) return

    setConsentLoading(true)
    setConsentError(null)

    try {
      const { error: revokeError } = await supabase.rpc('revoke_my_all_distribution_consents')
      if (revokeError) {
        setConsentError('Не удалось отозвать согласия. Публичные материалы не изменены.')
        return
      }

      setProfileConsentActive(false)
      setProfileConsentGrantedAt(null)
      setPublicationConsentActive(false)
      setLegacyPromptState(previous => previous
        ? {
            ...previous,
            already_prompted: true,
            profile_public_active: false,
            publication_active: false,
            legacy_choice: 'hidden',
          }
        : previous)
      setShowRevokeDialog(false)
      setConsentError('Оба согласия отозваны. Профиль и публикации скрываются от посетителей; уже выданные ссылки на изображения истекут не позднее чем через минуту. Данные не удалены.')
      router.refresh()
    } catch {
      setConsentError('Не удалось отправить отзыв согласий. Проверьте соединение и попробуйте ещё раз.')
    } finally {
      setConsentLoading(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (saving || avatarUploading) return
    if (!username.trim()) {
      setError('Имя пользователя не загружено. Обновите страницу; изменения не сохранены.')
      return
    }

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

  if (profileLoadError) {
    return (
      <main className="p-4 md:p-8 max-w-2xl mx-auto">
        <p role="alert" className="text-sm text-wine">{profileLoadError}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-3 rounded-full bg-emerald-mid px-4 py-2 text-sm text-cream hover:bg-emerald-dark"
        >
          Повторить
        </button>
      </main>
    )
  }

  const legacyDecisionPending = Boolean(
    legacyPromptState &&
    !legacyPromptState.already_prompted &&
    (legacyPromptState.has_legacy_profile || legacyPromptState.has_approved_posts),
  )

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

          {legacyDecisionPending && legacyPromptState?.has_legacy_profile && !profileConsentActive && (
            <p className="mb-3 text-sm leading-relaxed text-brown/70">
              Публичные поля существующего профиля пока видны посетителям до вашего решения ниже.
              Для дальнейшего публичного распространения этих полей потребуется отдельное согласие.
            </p>
          )}

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

        {legacyDecisionPending && legacyPromptState && (
          <section className="rounded-xl border border-wine/25 bg-wine/5 p-4">
            <h2 className="font-semibold text-emerald-dark mb-2">
              Ранее созданные данные
            </h2>
            <p className="text-sm leading-relaxed text-brown-dark mb-3">
              {legacyPromptState.has_legacy_profile && legacyPromptState.has_approved_posts
                ? 'Публичные поля профиля и ранее одобренные публикации пока видны посетителям.'
                : legacyPromptState.has_legacy_profile
                  ? 'Публичные поля существующего профиля пока видны посетителям.'
                  : 'Ранее одобренные публикации пока видны посетителям.'}
              {' '}Подтвердите их дальнейшее распространение или скройте. При скрытии записи и файлы
              останутся в аккаунте и не будут удалены.
            </p>
            {legacyPromptState.publication_active && (
              <p className="mb-3 text-sm leading-relaxed text-brown-dark">
                Отдельное согласие на новые публикации останется действовать. Этот выбор касается
                только материалов до даты перехода; согласие на будущие публикации можно отозвать отдельно.
              </p>
            )}
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                disabled={legacyPromptBusy}
                onClick={() => void resolveLegacyPrompt('grant_existing')}
                className="rounded-full bg-emerald-mid px-4 py-2 text-sm text-cream hover:bg-emerald-dark disabled:opacity-50"
              >
                {legacyPromptBusy
                  ? 'Сохраняем…'
                  : legacyPromptState.has_legacy_profile && !legacyPromptState.has_approved_posts
                    ? 'Оставить профиль публичным'
                    : 'Подтвердить распространение'}
              </button>
              <button
                type="button"
                disabled={legacyPromptBusy}
                onClick={() => void resolveLegacyPrompt('hide_existing')}
                className="rounded-full border border-emerald-dark/20 px-4 py-2 text-sm text-brown-dark hover:bg-cream-warm disabled:opacity-50"
              >
                {legacyPromptState.has_legacy_profile && legacyPromptState.has_approved_posts
                  ? 'Скрыть профиль и публикации'
                  : legacyPromptState.has_legacy_profile
                    ? 'Скрыть профиль'
                    : 'Скрыть публикации'}
              </button>
            </div>
            {legacyPromptError && (
              <p role="alert" className="mt-2 text-sm text-wine">{legacyPromptError}</p>
            )}
          </section>
        )}

        {legacyPromptError && !legacyPromptState?.has_approved_posts && (
          <p role="alert" className="text-sm text-wine">{legacyPromptError}</p>
        )}

        <section className="rounded-xl border border-emerald-dark/15 bg-cream-warm/20 p-4">
          <h2 className="font-semibold text-emerald-dark mb-2">
            Распространение публикаций
          </h2>
          <p className="text-sm text-brown-dark">
            {legacyPromptState?.legacy_choice === 'hidden' && legacyPromptState.has_approved_posts
              ? publicationConsentActive
                ? 'Ранее одобренные публикации остаются скрытыми. Действующее согласие распространяется на новые публикации после даты перехода.'
                : 'Ранее одобренные публикации остаются скрытыми по вашему выбору. Новое согласие на будущие публикации не откроет старые записи.'
              : publicationConsentActive
              ? 'Согласие на распространение ваших публикаций действует.'
              : legacyDecisionPending && legacyPromptState?.has_approved_posts
                ? 'Старые публикации остаются видимыми до вашего решения. Новые публикации отдельно требуют согласия.'
                : 'Согласие на распространение публикаций не действует. Скрытые старые публикации не видны посетителям; новые публикации отдельно запросят согласие.'}
          </p>

            {legacyPromptState?.legacy_choice === 'hidden' && (
              <div className="mt-4 border-t border-emerald-dark/10 pt-4">
                <p className="mb-3 text-sm leading-relaxed text-brown-dark">
                  Ранее скрытые материалы можно вернуть отдельным явным действием.
                  Для публикаций и публичных полей профиля будут записаны необходимые согласия с датой.
                </p>
                <button
                  type="button"
                  disabled={restoreLegacyBusy}
                  onClick={() => void restoreLegacyMaterials()}
                  className="rounded-full bg-emerald-mid px-4 py-2 text-sm text-cream hover:bg-emerald-dark disabled:opacity-50"
                >
                  {restoreLegacyBusy ? 'Возвращаем…' : 'Вернуть материалы'}
                </button>
                {restoreLegacyError && (
                  <p role="alert" className="mt-2 text-sm text-wine">{restoreLegacyError}</p>
                )}
              </div>
            )}
        </section>

        {(profileConsentActive || publicationConsentActive) && (
          <section className="rounded-xl border border-wine/25 p-4">
            <button
              type="button"
              disabled={consentLoading}
              onClick={() => setShowRevokeDialog(true)}
              className="rounded-full border border-wine/40 px-4 py-2 text-sm text-wine hover:bg-wine/5 disabled:opacity-50"
            >
              Отозвать согласия и скрыть материалы
            </button>
            {showRevokeDialog && (
              <div role="dialog" aria-modal="true" aria-labelledby="revoke-consent-title" className="mt-4 rounded-lg border border-wine/20 bg-cream p-4">
                <h3 id="revoke-consent-title" className="font-semibold text-emerald-dark mb-2">
                  Скрыть профиль и публикации?
                </h3>
                <p className="text-sm leading-relaxed text-brown-dark mb-3">
                  Будут отозваны оба согласия. Публичная страница профиля,
                  публикации, комментарии и изображения станут недоступны
                  посетителям. Ваши записи, комментарии, фотографии и история
                  согласий останутся в аккаунте и не будут удалены.
                  Уже выданные ссылки на изображения перестанут действовать
                  максимум через 60 секунд.
                </p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    type="button"
                    disabled={consentLoading}
                    onClick={() => void revokeAllDistributionConsents()}
                    className="rounded-full bg-wine px-4 py-2 text-sm text-white hover:bg-wine-dark disabled:opacity-50"
                  >
                    {consentLoading ? 'Отзываем…' : 'Скрыть всё'}
                  </button>
                  <button
                    type="button"
                    disabled={consentLoading}
                    onClick={() => setShowRevokeDialog(false)}
                    className="rounded-full border border-emerald-dark/20 px-4 py-2 text-sm text-brown-dark hover:bg-cream-warm disabled:opacity-50"
                  >
                    Отозвать позже
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

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
