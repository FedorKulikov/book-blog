'use client'

// app/forgot-password/page.tsx
// Запрос ссылки на восстановление пароля.
//
// Письмо формирует Supabase. Ссылка в шаблоне должна вести на наш
// /auth/confirm с типом recovery и параметром next — тогда после проверки
// токена пользователь попадёт на форму нового пароля:
//   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/auth/reset
import { useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { humanizeError } from '@/lib/errors'
import { SITE_URL } from '@/lib/site'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email.trim(),
      { redirectTo: `${SITE_URL}/auth/confirm?next=/auth/reset` },
    )

    setLoading(false)

    if (resetError) {
      setError(humanizeError(resetError.message))
      return
    }

    // Всегда показываем одинаковый результат: иначе по ответу можно узнать,
    // зарегистрирован ли такой адрес
    setSent(true)
  }

  return (
    <main className="p-4 md:p-8 flex justify-center">
      <div className="w-full max-w-md">
        <h1 className="text-3xl font-bold mb-6 text-emerald-dark">
          🔑 Восстановление пароля
        </h1>

        {sent ? (
          <>
            <p className="text-brown-dark/80 mb-4">
              Если адрес <span className="font-medium">{email.trim()}</span>{' '}
              зарегистрирован, письмо со ссылкой уже отправлено. Проверьте почту
              и папку «Спам».
            </p>
            <p className="text-sm text-brown/60 mb-6">
              Ссылка действует ограниченное время. Не пришло — запросите новое
              письмо.
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setSent(false)}
                className="rounded-full border border-emerald-dark/20 px-5 py-2 text-sm text-brown-dark hover:border-emerald-mid transition-colors"
              >
                Отправить ещё раз
              </button>
              <Link
                href="/login"
                className="rounded-full bg-emerald-mid px-5 py-2 text-sm text-cream hover:bg-emerald-dark transition-colors"
              >
                Ко входу
              </Link>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-brown/70 mb-6">
              Укажите адрес, на который зарегистрирован аккаунт. Пришлём ссылку
              для установки нового пароля.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="forgot-email"
                  className="block text-sm font-medium mb-1 text-brown-dark"
                >
                  Email
                </label>
                <input
                  id="forgot-email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  className="w-full border border-emerald-dark/20 rounded px-3 py-2 bg-cream-warm/50"
                  placeholder="fedor@test.com"
                />
              </div>

              {error && <p className="text-wine text-sm">Ошибка: {error}</p>}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-emerald-mid text-cream py-2 rounded hover:bg-emerald-dark disabled:opacity-50 transition-colors"
              >
                {loading ? 'Отправляем…' : 'Отправить ссылку'}
              </button>
            </form>

            <p className="mt-4 text-sm text-brown/70">
              Вспомнили пароль?{' '}
              <Link href="/login" className="text-wine hover:underline">
                Войти
              </Link>
            </p>
          </>
        )}
      </div>
    </main>
  )
}
