'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { humanizeError } from '@/lib/errors'
import Link from 'next/link'
import { getPostAuthPath, safeInternalPath } from '@/lib/auth-navigation'
import { passkeyErrorMessage, passkeysEnabled } from '@/lib/passkeys'

const UNCONFIRMED_EMAIL_MESSAGE =
  'Адрес не подтверждён. Проверьте почту или отправьте письмо ещё раз'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [passkeyLoading, setPasskeyLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [canResendConfirmation, setCanResendConfirmation] = useState(false)
  const [resendLoading, setResendLoading] = useState(false)
  const [resendFeedback, setResendFeedback] = useState<string | null>(null)
  const router = useRouter()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setCanResendConfirmation(false)
    setResendFeedback(null)

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      const message = humanizeError(error.message)
      setError(message)
      setCanResendConfirmation(message === UNCONFIRMED_EMAIL_MESSAGE)
      setLoading(false)
    } else {
      const next = getPostAuthPath(window.location.search, '/')
      router.replace(next)
      router.refresh()
    }
  }

  async function resendConfirmationEmail() {
    const normalizedEmail = email.trim()
    if (!normalizedEmail || resendLoading) return

    setResendLoading(true)
    setResendFeedback(null)

    try {
      const { error: resendError } = await supabase.auth.resend({
        type: 'signup',
        email: normalizedEmail,
      })

      if (resendError) {
        const message = resendError.message.toLowerCase()
        setResendFeedback(
          message.includes('rate limit') || message.includes('too many')
            ? 'Слишком много попыток. Подождите несколько минут.'
            : 'Не удалось отправить письмо. Попробуйте позже.',
        )
      } else {
        setResendFeedback('Письмо отправлено. Проверьте почту.')
      }
    } catch {
      setResendFeedback('Не удалось отправить письмо. Попробуйте позже.')
    } finally {
      setResendLoading(false)
    }
  }

  async function handlePasskeyLogin() {
    setPasskeyLoading(true)
    setError(null)
    setCanResendConfirmation(false)
    setResendFeedback(null)

    try {
      const { error: passkeyError } = await supabase.auth.signInWithPasskey()

      if (passkeyError) {
        setError(passkeyErrorMessage(passkeyError))
        return
      }

      const next = getPostAuthPath(window.location.search, '/')
      router.replace(next)
      router.refresh()
    } catch (passkeyError) {
      setError(passkeyErrorMessage(passkeyError))
    } finally {
      setPasskeyLoading(false)
    }
  }

  return (
    <main className="p-4 md:p-8 flex justify-center">
      <div className="w-full max-w-md">
        <h1 className="text-3xl font-bold mb-6 text-emerald-dark">🔐 Вход</h1>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label
              htmlFor="login-email"
              className="block text-sm font-medium mb-1 text-brown-dark"
            >
              Email
            </label>
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="ym-disable-keys w-full border border-emerald-dark/20 rounded px-3 py-2 bg-cream-warm/50"
              placeholder="fedor@test.com"
            />
          </div>

          <div>
            <label
              htmlFor="login-password"
              className="block text-sm font-medium mb-1 text-brown-dark"
            >
              Пароль
            </label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="ym-disable-keys w-full border border-emerald-dark/20 rounded px-3 py-2 bg-cream-warm/50"
              placeholder="••••••"
            />
          </div>

          {error && (
            <p role="alert" className="text-wine text-sm">
              Ошибка: {error}
            </p>
          )}

          {canResendConfirmation && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => void resendConfirmationEmail()}
                disabled={loading || passkeyLoading || resendLoading || !email.trim()}
                className="text-sm font-medium text-wine underline underline-offset-4 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {resendLoading ? 'Отправляем письмо…' : 'Отправить письмо ещё раз'}
              </button>
              {resendFeedback && (
                <p role="status" className="text-sm text-brown-dark/80">
                  {resendFeedback}
                </p>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || passkeyLoading || resendLoading}
            className="w-full bg-emerald-mid text-cream py-2 rounded hover:bg-emerald-dark disabled:opacity-50 transition-colors"
          >
            {loading ? 'Входим…' : 'Войти'}
          </button>
        </form>

        {passkeysEnabled && (
          <div className="mt-4">
            <div className="relative flex items-center">
              <div className="flex-grow border-t border-emerald-dark/15" />
              <span className="px-3 text-xs text-brown/50">или</span>
              <div className="flex-grow border-t border-emerald-dark/15" />
            </div>
            <button
              type="button"
              onClick={() => void handlePasskeyLogin()}
              disabled={loading || passkeyLoading}
              className="mt-3 w-full rounded-full border border-emerald-dark/20 px-5 py-2.5 text-sm text-brown-dark hover:border-emerald-mid disabled:opacity-50 transition-colors"
            >
              {passkeyLoading ? 'Проверяем ключ доступа…' : 'Войти с ключом доступа'}
            </button>
          </div>
        )}

        <p className="mt-4 text-sm text-brown/70">
          Нет аккаунта?{' '}
          <Link
            href="/signup"
            onClick={event => {
              const next = safeInternalPath(new URLSearchParams(window.location.search).get('next'))
              if (next !== '/') {
                event.preventDefault()
                router.push(`/signup?next=${encodeURIComponent(next)}`)
              }
            }}
            className="text-wine hover:underline"
          >
            Зарегистрироваться
          </Link>
        </p>

        <p className="mt-2 text-sm text-brown/70">
          <Link href="/forgot-password" className="text-wine hover:underline">
            Забыли пароль?
          </Link>
        </p>
        <p className="mt-2 text-sm text-brown/70">
          Если не приходит письмо или нет доступа к ящику, напишите на{' '}
          <span className="select-all font-medium text-brown-dark">monikla1312@gmail.com</span>
          {' '}— восстановим доступ вручную.
        </p>
      </div>
    </main>
  )
}
