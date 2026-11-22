'use client'

// app/auth/reset/page.tsx
// Установка нового пароля после перехода по ссылке из письма.
//
// Сюда пользователь попадает уже с recovery-сессией: токен из письма
// проверил /auth/confirm. Если сессии нет — ссылка устарела или открыта
// в другом браузере, и это надо сказать прямо, а не показывать форму,
// которая всё равно не сработает.
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { humanizeError } from '@/lib/errors'

const MIN_PASSWORD = 8

export default function ResetPasswordPage() {
  const router = useRouter()
  const [checking, setChecking] = useState(true)
  const [hasSession, setHasSession] = useState(false)
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true

    async function check() {
      const { data } = await supabase.auth.getSession()
      // Первый await — чтобы setState не выполнялся синхронно в эффекте
      await Promise.resolve()
      if (!alive) return

      setHasSession(Boolean(data.session))
      setChecking(false)
    }

    check()

    return () => {
      alive = false
    }
  }, [])

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
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setLoading(false)

    if (updateError) {
      setError(humanizeError(updateError.message))
      return
    }

    setDone(true)
    // Пароль изменён, пользователь уже авторизован — уводим на главную
    window.setTimeout(() => router.push('/'), 1500)
  }

  if (checking) {
    return (
      <main className="p-4 md:p-8 flex justify-center">
        <div className="w-full max-w-md text-center">
          <p className="text-brown/70">Проверяем ссылку…</p>
        </div>
      </main>
    )
  }

  if (done) {
    return (
      <main className="p-4 md:p-8 flex justify-center">
        <div className="w-full max-w-md text-center">
          <h1 className="text-2xl font-bold mb-3 text-emerald-dark">
            Пароль обновлён
          </h1>
          <p className="text-brown/70 mb-6">Сейчас откроем главную страницу…</p>
          <Link href="/" className="text-wine hover:underline text-sm">
            Перейти сейчас →
          </Link>
        </div>
      </main>
    )
  }

  if (!hasSession) {
    return (
      <main className="p-4 md:p-8 flex justify-center">
        <div className="w-full max-w-md text-center">
          <h1 className="text-2xl font-bold mb-3 text-emerald-dark">
            Ссылка недействительна
          </h1>
          <p className="text-brown/70 mb-6">
            Ссылка недействительна или восстановить сессию не удалось.
            Запросите новое письмо на странице «Забыли пароль?». Если не приходит
            письмо или нет доступа к ящику, напишите на{' '}
            <span className="select-all font-medium text-brown-dark">monikla1312@gmail.com</span>
            {' '}— восстановим доступ вручную.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link
              href="/forgot-password"
              className="rounded-full bg-emerald-mid px-5 py-2 text-sm text-cream hover:bg-emerald-dark transition-colors"
            >
              Запросить новое письмо
            </Link>
            <Link
              href="/login"
              className="rounded-full border border-emerald-dark/20 px-5 py-2 text-sm text-brown-dark hover:border-emerald-mid transition-colors"
            >
              Ко входу
            </Link>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="p-4 md:p-8 flex justify-center">
      <div className="w-full max-w-md">
        <h1 className="text-3xl font-bold mb-6 text-emerald-dark">
          🔐 Новый пароль
        </h1>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="reset-password"
              className="block text-sm font-medium mb-1 text-brown-dark"
            >
              Новый пароль
            </label>
            <input
              id="reset-password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={MIN_PASSWORD}
              className="w-full border border-emerald-dark/20 rounded px-3 py-2 bg-cream-warm/50"
              placeholder={`Минимум ${MIN_PASSWORD} символов`}
            />
          </div>

          <div>
            <label
              htmlFor="reset-password-repeat"
              className="block text-sm font-medium mb-1 text-brown-dark"
            >
              Повторите пароль
            </label>
            <input
              id="reset-password-repeat"
              type="password"
              value={repeat}
              onChange={e => setRepeat(e.target.value)}
              required
              minLength={MIN_PASSWORD}
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
            {loading ? 'Сохраняем…' : 'Сохранить пароль'}
          </button>
        </form>
      </div>
    </main>
  )
}
