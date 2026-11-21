'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'

function ConfirmContent() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token') ?? ''
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function confirmEmail() {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      setError('Ссылка подтверждения недействительна или устарела.')
      return
    }

    setLoading(true)
    setError('')

    try {
      const response = await fetch('/api/email-recovery/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
      }

      if (!response.ok || data.ok !== true) {
        setError(data.error || 'Не удалось подтвердить email. Запросите новую ссылку.')
        return
      }

      setDone(true)
    } catch {
      setError('Сеть недоступна. Попробуйте ещё раз.')
    } finally {
      setLoading(false)
    }
  }

  const tokenLooksValid = /^[A-Za-z0-9_-]{43}$/.test(token)

  if (done) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6 bg-cream">
        <section className="w-full max-w-md rounded-2xl border border-emerald-dark/15 bg-cream-warm/20 p-6 text-center">
          <h1 className="font-playfair text-2xl font-bold text-emerald-dark mb-3">
            Email подтверждён
          </h1>
          <p className="text-sm text-brown/70 mb-6">
            Адрес подтверждён для восстановления аккаунта. Вернитесь в профиль, чтобы проверить состояние и сохранить резервные коды.
          </p>
          <Link
            href="/login?next=%2Fprofile%2Fedit"
            className="inline-block rounded-full bg-emerald-mid px-5 py-2.5 text-sm text-cream hover:bg-emerald-dark transition-colors"
          >
            Перейти в аккаунт
          </Link>
        </section>
      </main>
    )
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-cream">
      <section className="w-full max-w-md rounded-2xl border border-emerald-dark/15 bg-cream-warm/20 p-6 text-center">
        <h1 className="font-playfair text-2xl font-bold text-emerald-dark mb-3">
          Подтвердить email
        </h1>
        <p className="text-sm text-brown/70 mb-6">
          Нажмите кнопку, чтобы подтвердить доступ к этому почтовому ящику и разрешить использовать его для восстановления аккаунта.
        </p>

        <button
          type="button"
          onClick={() => void confirmEmail()}
          disabled={loading || !tokenLooksValid}
          className="w-full rounded-full bg-emerald-mid px-5 py-2.5 text-sm text-cream hover:bg-emerald-dark disabled:opacity-50 transition-colors"
        >
          {loading ? 'Проверяем…' : 'Подтвердить email'}
        </button>

        {!tokenLooksValid && (
          <p className="mt-4 text-sm text-wine">
            Ссылка повреждена или срок её действия истёк. Запросите новую в настройках профиля.
          </p>
        )}
        {error && <p role="alert" className="mt-4 text-sm text-wine">{error}</p>}
      </section>
    </main>
  )
}

export default function EmailRecoveryConfirmClient() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen flex items-center justify-center bg-cream">
          <p className="text-sm text-brown/60">Загружаем подтверждение…</p>
        </main>
      }
    >
      <ConfirmContent />
    </Suspense>
  )
}
