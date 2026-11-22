'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { humanizeError } from '@/lib/errors'
import Link from 'next/link'

type UsernameStatus = 'idle' | 'checking' | 'free' | 'taken'

const MIN_PASSWORD = 8

/**
 * Ошибки уникальности username приходят из БД (UNIQUE-констрейнт
 * profiles_username_key) — между клиентской проверкой и вставкой имя
 * мог занять кто-то другой. Показываем то же понятное сообщение.
 */
function explainSignupError(message: string): string {
  const lower = message.toLowerCase()

  if (
    lower.includes('duplicate key') ||
    lower.includes('profiles_username_key') ||
    lower.includes('unique constraint')
  ) {
    return 'Это имя уже занято. Попробуйте другое.'
  }

  return humanizeError(message)
}

export default function SignupPage() {
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [verificationEmail, setVerificationEmail] = useState<string | null>(null)
  const [resendCountdown, setResendCountdown] = useState(0)
  const [resendLoading, setResendLoading] = useState(false)
  const [resendMessage, setResendMessage] = useState<string | null>(null)

  // Храним результат проверки вместе с проверенным именем. Для нового
  // значения статус checking вычисляется без синхронного setState в эффекте.
  const [usernameCheck, setUsernameCheck] = useState<{
    username: string
    status: Exclude<UsernameStatus, 'checking'>
  }>({ username: '', status: 'idle' })
  const cleanUsernameValue = username.trim()
  const usernameStatus: UsernameStatus =
    cleanUsernameValue.length < 3
      ? 'idle'
      : usernameCheck.username !== cleanUsernameValue
        ? 'checking'
        : usernameCheck.status


  useEffect(() => {
    const clean = username.trim()

    if (clean.length < 3) return
    let alive = true

    const timer = setTimeout(async () => {
      const { data, error: checkError } = await supabase
        .from('profiles')
        .select('id')
        .eq('username', clean)
        .limit(1)
        .maybeSingle()

      if (!alive) return

      if (checkError) {
        // RLS мог не дать прочитать profiles — не мешаем заполнять форму,
        // окончательное решение примет UNIQUE-констрейнт при регистрации
        console.warn('[signup] username check failed:', checkError.message)
        setUsernameCheck({ username: clean, status: 'idle' })
        return
      }

      setUsernameCheck({ username: clean, status: data ? 'taken' : 'free' })
    }, 500)

    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [username])

  useEffect(() => {
    if (!verificationEmail || resendCountdown <= 0) return

    const timer = window.setInterval(() => {
      setResendCountdown(current => Math.max(0, current - 1))
    }, 1000)

    return () => window.clearInterval(timer)
  }, [verificationEmail, resendCountdown])

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const cleanUsername = username.trim()

    if (password.length < MIN_PASSWORD) {
      setError(`Пароль должен быть не короче ${MIN_PASSWORD} символов`)
      return
    }

    // Имя занято — не отправляем форму даже если пользователь нажал Enter
    if (usernameStatus === 'taken') {
      setError('Это имя уже занято. Попробуйте другое.')
      return
    }

    setLoading(true)

    // Финальная предпроверка прямо перед регистрацией: за время заполнения
    // имя могло освободиться или, наоборот, его мог занять кто-то другой
    const { data: taken, error: checkError } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', cleanUsername)
      .limit(1)
      .maybeSingle()

    if (checkError) {
      console.warn('[signup] username pre-check failed:', checkError.message)
    } else if (taken) {
      setError('Это имя уже занято. Попробуйте другое.')
      setUsernameCheck({ username: cleanUsername, status: 'taken' })
      setLoading(false)
      return
    }

    // Создаём аккаунт, но не выполняем автологин и не выдаём коды
    // до подтверждения email. Пустой identities от Supabase для уже
    // существующего адреса показываем точно так же: не раскрываем наличие.
    const { error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { username: cleanUsername } },
    })

    if (signUpError) {
      setError(explainSignupError(signUpError.message))
      setLoading(false)
      return
    }

    setPassword('')
    setVerificationEmail(email.trim())
    setResendCountdown(60)
    setResendMessage(null)
    setLoading(false)
  }

  async function resendSignupEmail() {
    if (!verificationEmail || resendLoading || resendCountdown > 0) return

    setResendLoading(true)
    setResendMessage(null)
    setResendCountdown(60)

    const { error: resendError } = await supabase.auth.resend({
      type: 'signup',
      email: verificationEmail,
    })

    setResendMessage(
      resendError
        ? 'Не удалось запросить письмо. Попробуйте ещё раз позже.'
        : 'Запрос принят. Проверьте почту и папку «Спам».',
    )
    setResendLoading(false)
  }

  const submitDisabled =
    loading || usernameStatus === 'taken' || usernameStatus === 'checking'

  if (verificationEmail) {
    return (
      <main className="p-4 md:p-8 flex justify-center">
        <div className="w-full max-w-md text-center">
          <h1 className="text-3xl font-bold mb-4 text-emerald-dark">
            Подтвердите адрес
          </h1>
          <p className="text-sm text-brown/75 mb-2">
            Мы отправили письмо на <strong>{verificationEmail}</strong>. Перейдите по ссылке из письма, чтобы активировать аккаунт.
          </p>
          <p className="text-sm text-brown/60 mb-6">
            Если письмо не пришло, проверьте папку «Спам» или запросите повторную отправку.
          </p>
          <button
            type="button"
            onClick={() => void resendSignupEmail()}
            disabled={resendLoading || resendCountdown > 0}
            className="w-full bg-emerald-mid text-cream py-2 rounded hover:bg-emerald-dark disabled:opacity-50 transition-colors"
          >
            {resendLoading
              ? 'Отправляем…'
              : resendCountdown > 0
                ? `Отправить письмо ещё раз (${resendCountdown} сек.)`
                : 'Отправить письмо ещё раз'}
          </button>
          {resendMessage && (
            <p role="status" className="mt-3 text-sm text-brown/70">
              {resendMessage}
            </p>
          )}
          <p className="mt-6 text-sm text-brown/70">
            Уже подтвердили адрес?{' '}
            <Link href="/login" className="text-wine hover:underline">
              Войти
            </Link>
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="p-4 md:p-8 flex justify-center">
      <div className="w-full max-w-md">
        <h1 className="text-3xl font-bold mb-6 text-emerald-dark">
          📝 Регистрация
        </h1>

        <form onSubmit={handleSignup} className="space-y-4">
          <div>
            <label
              htmlFor="signup-username"
              className="block text-sm font-medium mb-1 text-brown-dark"
            >
              Имя пользователя
            </label>
            <input
              id="signup-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={3}
              maxLength={30}
              pattern="[a-zA-Z0-9_]+"
              aria-invalid={usernameStatus === 'taken'}
              className={`w-full border rounded px-3 py-2 bg-cream-warm/50 ${
                usernameStatus === 'taken'
                  ? 'border-wine'
                  : usernameStatus === 'free'
                  ? 'border-emerald-mid'
                  : 'border-emerald-dark/20'
              }`}
              placeholder="ivan_reader"
            />

            {usernameStatus === 'checking' && (
              <p className="text-xs text-brown/50 mt-1">Проверяем имя…</p>
            )}
            {usernameStatus === 'free' && (
              <p className="text-xs text-emerald-mid mt-1">
                ✓ Имя свободно
              </p>
            )}
            {usernameStatus === 'taken' && (
              <p className="text-xs text-wine mt-1">
                Это имя уже занято. Попробуйте другое.
              </p>
            )}
            {usernameStatus === 'idle' && (
              <p className="text-xs text-brown/60 mt-1">
                Только латинские буквы, цифры и подчёркивание
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="signup-email"
              className="block text-sm font-medium mb-1 text-brown-dark"
            >
              Email
            </label>
            <input
              id="signup-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="ym-disable-keys w-full border border-emerald-dark/20 rounded px-3 py-2 bg-cream-warm/50"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label
              htmlFor="signup-password"
              className="block text-sm font-medium mb-1 text-brown-dark"
            >
              Пароль
            </label>
            <input
              id="signup-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={MIN_PASSWORD}
              className="ym-disable-keys w-full border border-emerald-dark/20 rounded px-3 py-2 bg-cream-warm/50"
              placeholder={`Минимум ${MIN_PASSWORD} символов`}
            />
          </div>

          {error && <p className="text-wine text-sm">Ошибка: {error}</p>}

          <button
            type="submit"
            disabled={submitDisabled}
            className="w-full bg-emerald-mid text-cream py-2 rounded hover:bg-emerald-dark disabled:opacity-50 transition-colors"
          >
            {loading
              ? 'Регистрируем…'
              : usernameStatus === 'taken'
              ? 'Имя занято'
              : 'Зарегистрироваться'}
          </button>
        </form>

        <p className="mt-4 text-sm text-brown/70">
          Перед началом использования ознакомьтесь с{' '}
          <Link href="/rules" className="text-wine hover:underline">
            Правилами сообщества
          </Link>
          .
        </p>

        <p className="mt-4 text-sm text-brown/70">
          Уже есть аккаунт?{' '}
          <Link href="/login" className="text-wine hover:underline">
            Войти
          </Link>
        </p>
      </div>
    </main>
  )
}
