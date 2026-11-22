'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

type ChatMode = 'preserve' | 'delete_own_messages'
type Blocker = { code: string; label: string; count: number }

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
    if (!password) {
      setError('Введите текущий пароль для повторного подтверждения личности.')
      return
    }

    setSubmitting(true)

    // Password is sent only to Supabase Auth for step-up authentication. It is
    // never sent to the account deletion API or written to application logs.
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (authError || !authData.user || authData.user.id !== accountId) {
      setSubmitting(false)
      setError('Не удалось повторно подтвердить этот аккаунт. Проверьте пароль.')
      return
    }

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
            Для аккаунтов без пароля потребуется отдельная повторная аутентификация.
          </p>
        </div>

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
          disabled={submitting || !accountId || !email}
          className="w-full rounded-full bg-wine px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-wine/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? 'Выполняется безопасное удаление…' : 'Подтвердить удаление аккаунта'}
        </button>
      </form>
    </main>
  )
}
