'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

type ChatMode = 'preserve' | 'delete_own_messages'
type Blocker = { code: string; label: string; count: number }
type MfaFactor = {
  id: string
  factor_type: 'totp' | 'phone'
  friendly_name: string | null
  phone?: string
}

const CONFIRMATION = 'УДАЛИТЬ АККАУНТ'

export default function DeleteAccountPage() {
  const router = useRouter()
  const [accountId, setAccountId] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [loadingAccount, setLoadingAccount] = useState(true)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [chatMode, setChatMode] = useState<ChatMode>('preserve')
  const [blockers, setBlockers] = useState<Blocker[]>([])
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [mfaFactors, setMfaFactors] = useState<MfaFactor[]>([])
  const [mfaFactorId, setMfaFactorId] = useState('')
  const [mfaChallengeId, setMfaChallengeId] = useState('')
  const [mfaCode, setMfaCode] = useState('')
  const [mfaRequired, setMfaRequired] = useState(false)

  useEffect(() => {
    let active = true

    async function loadAccount() {
      const { data, error: userError } = await supabase.auth.getUser()
      if (!active) return

      if (userError || !data.user) {
        router.replace('/login?next=%2Fprofile%2Fdelete-account')
        return
      }

      setAccountId(data.user.id)
      setEmail(data.user.email ?? '')
      setLoadingAccount(false)
    }

    void loadAccount()
    return () => {
      active = false
    }
  }, [router])

  async function sendDeletionRequest() {
    const response = await fetch('/api/account/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmation, chatMode }),
    })

    const result = await response.json().catch(() => ({} as Record<string, unknown>))
    setSubmitting(false)
    setPassword('')

    if (response.status === 409 && result.code === 'RETENTION_POLICY_REQUIRED') {
      setBlockers(Array.isArray(result.blockers) ? result.blockers as Blocker[] : [])
      setError(typeof result.error === 'string' ? result.error : 'Удаление пока заблокировано политикой хранения данных.')
      return
    }

    if (
      response.status === 409 &&
      result.code === 'CHAT_MODE_LOCKED' &&
      (result.requiredMode === 'preserve' || result.requiredMode === 'delete_own_messages')
    ) {
      setChatMode(result.requiredMode)
      setError(typeof result.error === 'string' ? result.error : 'Продолжите предыдущую попытку в первоначальном режиме.')
      return
    }

    if (response.status === 403 && result.code === 'MFA_REQUIRED') {
      setError('Подтвердите второй фактор MFA, затем повторите удаление.')
      return
    }

    if (!response.ok) {
      setError(
        typeof result.error === 'string'
          ? result.error
          : 'Не удалось завершить удаление. Повторите запрос с тем же режимом.',
      )
      return
    }

    await supabase.auth.signOut({ scope: 'local' })
    window.location.assign('/login?deleted=1')
  }

  async function startMfaChallenge() {
    if (!mfaFactorId) {
      setError('Выберите подтверждённый фактор MFA.')
      return
    }

    setError(null)
    setSubmitting(true)
    const { data, error: challengeError } = await supabase.auth.mfa.challenge({
      factorId: mfaFactorId,
    })

    if (challengeError || !data?.id) {
      setSubmitting(false)
      setError('Не удалось подготовить проверку MFA. Попробуйте ещё раз.')
      return
    }

    setMfaChallengeId(data.id)
    setMfaCode('')
    setSubmitting(false)
    setError(
      'Введите одноразовый код из приложения-аутентификатора или SMS, в зависимости от выбранного фактора.',
    )
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setBlockers([])

    if (!accountId || !email) {
      setError('Не удалось определить текущий аккаунт. Обновите страницу и войдите заново.')
      return
    }
    if (confirmation !== CONFIRMATION) {
      setError(`Введите точную фразу: ${CONFIRMATION}`)
      return
    }

    setSubmitting(true)

    // If a factor challenge is active, verify it before invoking the server.
    // The route independently validates the signed AAL claim.
    if (mfaRequired) {
      if (!mfaChallengeId || !mfaFactorId || !mfaCode.trim()) {
        setSubmitting(false)
        setError('Сначала подготовьте проверку MFA и введите одноразовый код.')
        return
      }

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: mfaFactorId,
        challengeId: mfaChallengeId,
        code: mfaCode.trim(),
      })

      if (verifyError) {
        setSubmitting(false)
        setError('Код MFA не принят. Проверьте его и повторите попытку.')
        return
      }

      setMfaRequired(false)
      setMfaFactors([])
      setMfaFactorId('')
      setMfaChallengeId('')
      setMfaCode('')
      await sendDeletionRequest()
      return
    }

    if (!password) {
      setSubmitting(false)
      setError('Введите текущий пароль для повторного подтверждения личности.')
      return
    }

    // Password is sent only to Supabase Auth. It is never sent to our deletion
    // API or logged by the application.
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (authError || !authData.user || authData.user.id !== accountId) {
      setSubmitting(false)
      setError('Не удалось повторно подтвердить этот аккаунт. Проверьте пароль.')
      return
    }

    const { data: assurance, error: assuranceError } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel()

    if (assuranceError || !assurance) {
      setSubmitting(false)
      setError('Не удалось проверить второй фактор. Повторите вход позже.')
      return
    }

    if (assurance.nextLevel === 'aal2' && assurance.currentLevel !== 'aal2') {
      const { data: listed, error: listError } = await supabase.auth.mfa.listFactors()
      if (listError || !listed) {
        setSubmitting(false)
        setError('Не удалось получить список подтверждённых факторов MFA.')
        return
      }

      const verifiedFactors = [...listed.totp, ...listed.phone].filter(
        factor => factor.status === 'verified',
      ) as MfaFactor[]

      if (verifiedFactors.length === 0) {
        setSubmitting(false)
        setError('Для аккаунта требуется MFA, но подтверждённый фактор не найден. Удаление остановлено.')
        return
      }

      // Prefer TOTP; use a verified phone factor if no authenticator factor exists.
      const preferredFactor =
        verifiedFactors.find(factor => factor.factor_type === 'totp') ?? verifiedFactors[0]

      setMfaFactors(verifiedFactors)
      setMfaFactorId(preferredFactor.id)
      setMfaRequired(true)
      setPassword('')
      setSubmitting(false)
      setError('Пароль подтверждён. Подтвердите второй фактор MFA, чтобы продолжить.')
      return
    }

    await sendDeletionRequest()
  }

  if (loadingAccount) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-12">
        <p className="text-sm text-brown/60">Проверяем аккаунт…</p>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <Link href="/profile" className="text-sm text-wine hover:underline">
        ← Вернуться в профиль
      </Link>

      <h1 className="mt-5 font-playfair text-3xl font-bold text-emerald-dark">
        Удаление аккаунта
      </h1>
      <p className="mt-3 text-sm leading-6 text-brown/75">
        Удаление необратимо. Перед удалением сервис проверит связанные публикации,
        обращения и записи модерации. Если их нельзя безопасно обработать по
        действующим правилам хранения, удаление будет остановлено без изменения данных.
      </p>

      <section className="mt-6 rounded-2xl border border-wine/25 bg-wine/5 p-4">
        <h2 className="font-semibold text-brown-dark">Что произойдёт с перепиской</h2>

        <label className="mt-4 flex cursor-pointer items-start gap-3">
          <input
            type="radio"
            name="chatMode"
            value="preserve"
            checked={chatMode === 'preserve'}
            onChange={() => setChatMode('preserve')}
            className="mt-1 accent-emerald-mid"
          />
          <span className="text-sm leading-6 text-brown-dark">
            <strong>Сохранить историю у собеседника — по умолчанию.</strong>
            <br />
            Ваши сообщения останутся в беседе с подписью «Удалённый пользователь».
            Вложения будут перенесены в приватное хранилище без привязки к вашему аккаунту.
          </span>
        </label>

        <label className="mt-4 flex cursor-pointer items-start gap-3">
          <input
            type="radio"
            name="chatMode"
            value="delete_own_messages"
            checked={chatMode === 'delete_own_messages'}
            onChange={() => setChatMode('delete_own_messages')}
            className="mt-1 accent-wine"
          />
          <span className="text-sm leading-6 text-brown-dark">
            <strong>Удалить только мои сообщения.</strong>
            <br />
            Ваши сообщения и связанные вложения будут удалены у обоих участников.
            Сообщения собеседника сохранятся. Пустая после этого беседа будет удалена.
            Это действие необратимо.
          </span>
        </label>
      </section>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="account-email" className="block text-sm font-medium text-brown-dark">
            Аккаунт
          </label>
          <input
            id="account-email"
            value={email}
            readOnly
            className="mt-1 w-full rounded-xl border border-emerald-dark/15 bg-cream-warm/40 px-3 py-2 text-sm text-brown/70"
          />
        </div>

        {!mfaRequired ? (
          <div>
            <label htmlFor="current-password" className="block text-sm font-medium text-brown-dark">
              Текущий пароль для повторного входа
            </label>
            <input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              className="mt-1 w-full rounded-xl border border-emerald-dark/15 bg-cream px-3 py-2 text-sm outline-none focus:border-emerald-mid"
              required
            />
            <p className="mt-1 text-xs text-brown/55">
              Пароль проверяется Supabase Auth и не передаётся в обработчик удаления.
              Для аккаунтов без пароля потребуется отдельный способ повторного входа.
            </p>
          </div>
        ) : (
          <div className="space-y-3 rounded-xl border border-emerald-dark/15 bg-cream-warm/50 p-4">
            <p className="text-sm font-semibold text-brown-dark">Дополнительная проверка MFA</p>
            <label htmlFor="mfa-factor" className="block text-sm text-brown-dark">
              Подтверждённый фактор
            </label>
            <select
              id="mfa-factor"
              value={mfaFactorId}
              onChange={event => {
                setMfaFactorId(event.target.value)
                setMfaChallengeId('')
                setMfaCode('')
              }}
              className="w-full rounded-xl border border-emerald-dark/15 bg-cream px-3 py-2 text-sm"
            >
              {mfaFactors.map(factor => (
                <option key={factor.id} value={factor.id}>
                  {factor.factor_type === 'totp' ? 'Приложение-аутентификатор' : 'SMS'}
                  {factor.friendly_name ? ` — ${factor.friendly_name}` : ''}
                  {factor.factor_type === 'phone' && factor.phone ? ` (${factor.phone})` : ''}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void startMfaChallenge()}
              disabled={submitting || !mfaFactorId}
              className="rounded-full border border-emerald-dark/20 px-4 py-2 text-sm font-medium text-emerald-dark disabled:opacity-50"
            >
              {mfaChallengeId ? 'Отправить новый код / обновить проверку' : 'Подготовить проверку MFA'}
            </button>
            {mfaChallengeId && (
              <>
                <label htmlFor="mfa-code" className="block text-sm text-brown-dark">
                  Одноразовый код MFA
                </label>
                <input
                  id="mfa-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={mfaCode}
                  onChange={event => setMfaCode(event.target.value.replace(/\s/g, ''))}
                  className="w-full rounded-xl border border-emerald-dark/15 bg-cream px-3 py-2 text-sm"
                  required
                />
              </>
            )}
            <p className="text-xs leading-5 text-brown/60">
              Удаление не начнётся, пока Supabase Auth не подтвердит выбранный фактор.
            </p>
          </div>
        )}

        <div>
          <label htmlFor="delete-confirmation" className="block text-sm font-medium text-brown-dark">
            Для подтверждения введите «{CONFIRMATION}»
          </label>
          <input
            id="delete-confirmation"
            value={confirmation}
            onChange={event => setConfirmation(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="mt-1 w-full rounded-xl border border-wine/25 bg-cream px-3 py-2 text-sm outline-none focus:border-wine"
            required
          />
        </div>

        {blockers.length > 0 && (
          <div className="rounded-xl border border-wine/20 bg-wine/5 p-4">
            <p className="text-sm font-semibold text-brown-dark">
              Необработанные связанные данные
            </p>
            <ul className="mt-2 space-y-1 text-sm text-brown/75">
              {blockers.map(blocker => (
                <li key={blocker.code}>
                  {blocker.label}: {blocker.count}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs leading-5 text-brown/60">
              Ничего из перечисленного не удалено. Сначала нужно утвердить и реализовать
              правила хранения для этих категорий.
            </p>
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-xl bg-wine/10 px-3 py-2 text-sm text-wine">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting || !accountId || !email || (mfaRequired && (!mfaChallengeId || !mfaCode.trim()))}
          className="w-full rounded-full bg-wine px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-wine/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? 'Проверяем данные…' : mfaRequired ? 'Подтвердить MFA и удалить аккаунт' : 'Подтвердить удаление аккаунта'}
        </button>
      </form>
    </main>
  )
}
