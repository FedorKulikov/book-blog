'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { humanizeError } from '@/lib/errors'
import Link from 'next/link'
import CodesReveal from '@/app/components/CodesReveal'
import { getPostAuthPath } from '@/lib/auth-navigation'

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
  const [codes, setCodes] = useState<string[] | null>(null)
  const [recoveryUnavailable, setRecoveryUnavailable] = useState(false)
  const [recoveryError, setRecoveryError] = useState<string | null>(null)
  const [recoveryPassword, setRecoveryPassword] = useState('')
  const [recoveryLoading, setRecoveryLoading] = useState(false)
  const [acknowledgedRecoveryRisk, setAcknowledgedRecoveryRisk] = useState(false)

  // Живая проверка занятости имени (с дебаунсом, чтобы не дёргать БД на каждый символ)
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('idle')

  const router = useRouter()

  useEffect(() => {
    const clean = username.trim()

    if (clean.length < 3) {
      setUsernameStatus('idle')
      return
    }

    setUsernameStatus('checking')
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
        setUsernameStatus('idle')
        return
      }

      setUsernameStatus(data ? 'taken' : 'free')
    }, 500)

    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [username])

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
      setUsernameStatus('taken')
      setLoading(false)
      return
    }

    // Регистрируем пользователя
    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { username: cleanUsername } },
    })

    if (signUpError) {
      setError(explainSignupError(signUpError.message))
      setLoading(false)
      return
    }

    // Сразу входим (так как email подтверждать не нужно)
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (signInError) {
      setError('Регистрация прошла, но войти не удалось. ' + humanizeError(signInError.message))
      setLoading(false)
      return
    }

    // Резервные коды — единственный доступный пользователю способ
    // самостоятельно восстановить пароль, поэтому ошибку нельзя скрывать.
    try {
      const res = await fetch('/api/recovery/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        codes?: string[]
        saved?: number
        error?: string
      }

      if (
        res.ok &&
        Array.isArray(data.codes) &&
        data.codes.length > 0 &&
        data.saved === data.codes.length
      ) {
        setCodes(data.codes)
        setLoading(false)
        return
      }

      setRecoveryError(
        data.error ||
          'Не удалось сохранить полный набор резервных кодов. Попробуйте ещё раз.',
      )
    } catch {
      setRecoveryError(
        'Не удалось связаться с сервисом резервных кодов. Проверьте соединение и повторите попытку.',
      )
    }

    // Аккаунт уже создан и пользователь вошёл. Не отправляем его дальше
    // молча: сначала явно сообщаем, что восстановление пока не настроено.
    setPassword('')
    setRecoveryUnavailable(true)
    setLoading(false)
  }

  async function retryRecoveryCodes(e: React.FormEvent) {
    e.preventDefault()
    setRecoveryError(null)
    setRecoveryLoading(true)

    try {
      const res = await fetch('/api/recovery/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: recoveryPassword }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        codes?: string[]
        saved?: number
        error?: string
      }

      if (
        !res.ok ||
        !Array.isArray(data.codes) ||
        data.codes.length === 0 ||
        data.saved !== data.codes.length
      ) {
        setRecoveryError(
          data.error ||
            'Не удалось сохранить полный набор резервных кодов. Проверьте пароль и попробуйте ещё раз.',
        )
        return
      }

      setCodes(data.codes)
      setRecoveryUnavailable(false)
      setRecoveryPassword('')
      setAcknowledgedRecoveryRisk(false)
    } catch {
      setRecoveryError(
        'Не удалось связаться с сервисом резервных кодов. Проверьте соединение и повторите попытку.',
      )
    } finally {
      setRecoveryLoading(false)
    }
  }

  function finishSignup() {
    router.push(getPostAuthPath(window.location.search))
    router.refresh()
  }

  const submitDisabled =
    loading || usernameStatus === 'taken' || usernameStatus === 'checking'

  if (codes) {
    return (
      <main className="p-4 md:p-8 flex justify-center">
        <div className="w-full max-w-md">
          <h1 className="text-2xl font-bold mb-2 text-emerald-dark">
            Аккаунт создан
          </h1>
          <p className="text-sm text-brown/70 mb-4">
            Это единственный момент, когда резервные коды видны. Если потеряете
            пароль, доступ можно будет вернуть по имени пользователя и одному
            из этих кодов — почта для этого не нужна.
          </p>
          <CodesReveal
            codes={codes}
            doneLabel="Продолжить"
            onDone={finishSignup}
          />
        </div>
      </main>
    )
  }

  if (recoveryUnavailable) {
    return (
      <main className="p-4 md:p-8 flex justify-center">
        <div className="w-full max-w-md">
          <h1 className="text-2xl font-bold mb-3 text-wine">
            Аккаунт создан, но резервные коды не выданы
          </h1>
          <p className="text-sm text-brown/75 mb-4">
            Вы уже вошли в аккаунт. Сейчас самостоятельное восстановление
            пароля не настроено, пока не удастся сохранить резервные коды.
            Попробуйте повторить выдачу сейчас.
          </p>

          <form onSubmit={retryRecoveryCodes} className="space-y-3">
            <label htmlFor="recovery-retry-password" className="block text-sm font-medium text-brown-dark">
              Подтвердите пароль
            </label>
            <input
              id="recovery-retry-password"
              type="password"
              value={recoveryPassword}
              onChange={e => setRecoveryPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full border border-emerald-dark/20 rounded px-3 py-2 bg-cream-warm/50"
              placeholder="Пароль, который вы только что задали"
            />
            {recoveryError && <p role="alert" className="text-sm text-wine">{recoveryError}</p>}
            <button
              type="submit"
              disabled={recoveryLoading}
              className="w-full bg-emerald-mid text-cream py-2 rounded hover:bg-emerald-dark disabled:opacity-50"
            >
              {recoveryLoading ? 'Пробуем ещё раз…' : 'Повторить выдачу кодов'}
            </button>
          </form>

          <label className="mt-5 flex items-start gap-2 text-sm text-brown/70">
            <input
              type="checkbox"
              checked={acknowledgedRecoveryRisk}
              onChange={e => setAcknowledgedRecoveryRisk(e.target.checked)}
              className="mt-1"
            />
            <span>
              Я понимаю, что без сохранённого резервного кода не смогу
              самостоятельно восстановить пароль, если забуду его.
            </span>
          </label>
          <button
            type="button"
            disabled={!acknowledgedRecoveryRisk}
            onClick={finishSignup}
            className="mt-4 w-full rounded-full border border-emerald-dark/20 px-5 py-2.5 text-sm text-brown-dark disabled:opacity-40"
          >
            Продолжить без кодов
          </button>
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
              className="w-full border border-emerald-dark/20 rounded px-3 py-2 bg-cream-warm/50"
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
              className="w-full border border-emerald-dark/20 rounded px-3 py-2 bg-cream-warm/50"
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
          Уже есть аккаунт?{' '}
          <Link href="/login" className="text-wine hover:underline">
            Войти
          </Link>
        </p>
      </div>
    </main>
  )
}
