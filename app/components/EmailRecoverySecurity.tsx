'use client'

import { useEffect, useState } from 'react'

type Status = {
  configured: boolean
  verified: boolean
}

const enabled = process.env.NEXT_PUBLIC_ENABLE_EMAIL_RECOVERY === 'true'

export default function EmailRecoverySecurity() {
  const [status, setStatus] = useState<Status | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!enabled) return

    const result = new URLSearchParams(window.location.search).get('emailRecovery')
    let alive = true

    async function load() {
      await Promise.resolve()
      if (!alive) return

      if (result === 'verified') {
        setNotice(
          'Доступ к почтовому ящику подтверждён. Это подтверждение не включает сброс пароля по email.',
        )
      } else if (result === 'invalid') {
        setError('Ссылка подтверждения недействительна или срок её действия истёк. Запросите новую.')
      }

      try {
        const response = await fetch('/api/email-recovery/status', {
          cache: 'no-store',
        })
        const data = (await response.json().catch(() => ({}))) as Partial<Status>

        if (!alive) return

        if (!response.ok) {
          setError('Не удалось проверить состояние подтверждения email.')
          return
        }

        setStatus({
          configured: data.configured === true,
          verified: data.verified === true,
        })
      } catch {
        if (alive) setError('Не удалось связаться с сервисом подтверждения email.')
      }
    }

    void load()

    return () => {
      alive = false
    }
  }, [])

  async function requestVerification() {
    setLoading(true)
    setError('')
    setNotice('')

    try {
      const response = await fetch('/api/email-recovery/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      const data = (await response.json().catch(() => ({}))) as { error?: string }

      if (!response.ok) {
        setError(data.error || 'Не удалось отправить письмо.')
        return
      }

      setNotice(
        'Письмо с подтверждением адреса отправлено на email аккаунта. Сброс пароля по email-ссылке не используется.',
      )
    } catch {
      setError('Сеть недоступна. Попробуйте ещё раз.')
    } finally {
      setLoading(false)
    }
  }

  if (!enabled) return null

  return (
    <section className="rounded-xl border border-emerald-dark/15 p-4">
      <h2 className="font-semibold text-emerald-dark mb-1">Подтверждение адреса электронной почты</h2>
      <p className="text-sm text-brown/70 mb-3">
        Подтвердите, что у вас есть доступ к почтовому ящику. Это отдельная проверка владения адресом, а не способ сброса пароля.
      </p>

      {status === null && <p className="text-sm text-brown/50">Проверяем…</p>}

      {status && !status.configured && (
        <p className="text-sm text-wine">
          Подтверждение адреса ещё не настроено на сервере. Сброс пароля остаётся доступен по резервным кодам и passkeys.
        </p>
      )}

      {status?.configured && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm">
            {status.verified ? (
              <span className="text-emerald-dark">Доступ к текущему почтовому ящику подтверждён</span>
            ) : (
              <span className="text-wine">Доступ к текущему почтовому ящику ещё не подтверждён</span>
            )}
          </p>
          <button
            type="button"
            onClick={() => void requestVerification()}
            disabled={loading}
            className="rounded-full bg-emerald-mid px-4 py-2 text-sm text-cream hover:bg-emerald-dark disabled:opacity-50 transition-colors"
          >
            {loading ? 'Отправляем…' : status.verified ? 'Повторить подтверждение адреса' : 'Отправить ссылку подтверждения'}
          </button>
        </div>
      )}

      {notice && <p role="status" className="mt-3 text-sm text-emerald-dark">{notice}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-wine">{error}</p>}

      <p className="mt-3 text-xs text-brown/55">
        Изменение адреса в аккаунте сбрасывает подтверждение: новый адрес нужно подтвердить заново. Для сброса пароля используются резервные коды или passkeys; email-ссылки сброса отключены.
      </p>
    </section>
  )
}
