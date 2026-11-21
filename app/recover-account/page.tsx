'use client'

// app/recover-account/page.tsx
//
// Восстановление доступа без почты: имя пользователя + резервный код + новый пароль.
// Ни письма, ни SMTP здесь не участвуют.
import { useState } from 'react'
import Link from 'next/link'
import { passkeysEnabled } from '@/lib/passkeys'

const MIN_PASSWORD = 8

export default function RecoverAccountPage() {
  const [username, setUsername] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (password.length < MIN_PASSWORD) {
      setError(`Пароль должен быть не короче ${MIN_PASSWORD} символов`)
      return
    }

    if (password !== repeat) {
      setError('Пароли не совпадают')
      return
    }

    setLoading(true)

    try {
      const res = await fetch('/api/recovery/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          code,
          newPassword: password,
        }),
      })

      const data = (await res.json().catch(() => ({}))) as { error?: string }

      if (!res.ok) {
        setError(data.error || 'Не удалось восстановить доступ')
        return
      }

      setDone(true)
    } catch {
      setError('Сеть недоступна. Проверьте соединение и попробуйте ещё раз.')
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <main className="p-4 md:p-8 flex justify-center">
        <div className="w-full max-w-md text-center">
          <h1 className="text-2xl font-bold mb-3 text-emerald-dark">
            Пароль изменён
          </h1>
          <p className="text-brown/70 mb-6">
            Войдите с новым паролем. Использованный резервный код больше не
            действует, остальные коды остались рабочими.
          </p>
          <Link
            href="/login"
            className="inline-block rounded-full bg-emerald-mid px-6 py-2 text-sm text-cream hover:bg-emerald-dark transition-colors"
          >
            Войти
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="p-4 md:p-8 flex justify-center">
      <div className="w-full max-w-md">
        <h1 className="text-3xl font-bold mb-2 text-emerald-dark">
          🗝️ Восстановление по коду
        </h1>
        <p className="text-sm text-brown/70 mb-6">
          Подойдёт, если нет доступа к почте. Нужен один из резервных кодов,
          которые вы сохранили при регистрации.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="recover-username"
              className="block text-sm font-medium mb-1 text-brown-dark"
            >
              Имя пользователя
            </label>
            <input
              id="recover-username"
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              required
              autoComplete="username"
              className="w-full border border-emerald-dark/20 rounded px-3 py-2 bg-cream-warm/50"
              placeholder="как при входе"
            />
          </div>

          <div>
            <label
              htmlFor="recover-code"
              className="block text-sm font-medium mb-1 text-brown-dark"
            >
              Резервный код
            </label>
            <input
              id="recover-code"
              type="text"
              value={code}
              onChange={e => setCode(e.target.value)}
              required
              autoComplete="off"
              spellCheck={false}
              className="w-full border border-emerald-dark/20 rounded px-3 py-2 bg-cream-warm/50 font-mono tracking-wider"
              placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
            />
          </div>

          <div>
            <label
              htmlFor="recover-password"
              className="block text-sm font-medium mb-1 text-brown-dark"
            >
              Новый пароль
            </label>
            <input
              id="recover-password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={MIN_PASSWORD}
              autoComplete="new-password"
              className="w-full border border-emerald-dark/20 rounded px-3 py-2 bg-cream-warm/50"
              placeholder={`Минимум ${MIN_PASSWORD} символов`}
            />
          </div>

          <div>
            <label
              htmlFor="recover-password-repeat"
              className="block text-sm font-medium mb-1 text-brown-dark"
            >
              Повторите пароль
            </label>
            <input
              id="recover-password-repeat"
              type="password"
              value={repeat}
              onChange={e => setRepeat(e.target.value)}
              required
              minLength={MIN_PASSWORD}
              autoComplete="new-password"
              className="w-full border border-emerald-dark/20 rounded px-3 py-2 bg-cream-warm/50"
              placeholder="Ещё раз"
            />
          </div>

          {error && <p className="text-wine text-sm">Ошибка: {error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-emerald-mid text-cream py-2 rounded hover:bg-emerald-dark disabled:opacity-50 transition-colors"
          >
            {loading ? 'Проверяем…' : 'Восстановить доступ'}
          </button>
        </form>

        <p className="mt-4 text-sm text-brown/60">
          Восстановление по email сейчас отключено. Здесь нужен именно резервный код, сохранённый заранее.
        </p>
        {passkeysEnabled && (
          <p className="mt-2 text-sm text-brown/70">
            Есть ключ доступа? Вернитесь на <Link href="/login" className="text-wine hover:underline">страницу входа</Link> и войдите с ним, затем смените пароль в настройках профиля.
          </p>
        )}
        <p className="mt-2 text-sm text-brown/70">
          Вспомнили пароль?{' '}
          <Link href="/login" className="text-wine hover:underline">
            Войти
          </Link>
        </p>
      </div>
    </main>
  )
}
