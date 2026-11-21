'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { humanizeError } from '@/lib/errors'
import Link from 'next/link'
import { getPostAuthPath } from '@/lib/auth-navigation'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setError(humanizeError(error.message))
      setLoading(false)
    } else {
      const next = getPostAuthPath(window.location.search)
      router.replace(next)
      router.refresh()
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
              className="w-full border border-emerald-dark/20 rounded px-3 py-2 bg-cream-warm/50"
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
              className="w-full border border-emerald-dark/20 rounded px-3 py-2 bg-cream-warm/50"
              placeholder="••••••"
            />
          </div>

          {error && <p className="text-wine text-sm">Ошибка: {error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-emerald-mid text-cream py-2 rounded hover:bg-emerald-dark disabled:opacity-50 transition-colors"
          >
            {loading ? 'Входим…' : 'Войти'}
          </button>
        </form>

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
          {' '}Восстановление доступно по резервному коду.
        </p>
      </div>
    </main>
  )
}
