'use client'

import { useState } from 'react'

const enabled = process.env.NEXT_PUBLIC_ENABLE_EMAIL_RECOVERY === 'true'

export default function EmailRecoveryResetForm() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  if (!enabled) return null

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError('')
    setNotice('')

    try {
      const response = await fetch('/api/email-recovery/reset-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })

      if (!response.ok) {
        setError('Сервис восстановления временно недоступен. Попробуйте позже или используйте резервный код.')
        return
      }

      // Deliberately the same for unknown, unverified and verified email
      // addresses. The endpoint never confirms whether an account exists.
      setNotice(
        'Если адрес относится к аккаунту и ранее был подтверждён в настройках профиля, письмо для сброса пароля отправлено. Если письма нет, используйте резервный код.',
      )
    } catch {
      setError('Сеть недоступна. Попробуйте ещё раз.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="mt-8 rounded-xl border border-emerald-dark/15 p-4">
      <h2 className="font-semibold text-emerald-dark mb-1">Восстановить по подтверждённому email</h2>
      <p className="text-sm text-brown/70 mb-3">
        Этот способ работает только после того, как вы заранее подтвердили доступ к почте в настройках профиля.
      </p>

      <form onSubmit={handleSubmit} className="space-y-3">
        <label htmlFor="recovery-email" className="block text-sm font-medium text-brown-dark">
          Email аккаунта
        </label>
        <input
          id="recovery-email"
          type="email"
          value={email}
          onChange={event => setEmail(event.target.value)}
          autoComplete="email"
          required
          className="w-full border border-emerald-dark/20 rounded px-3 py-2 bg-cream-warm/50"
          placeholder="you@example.com"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-full border border-emerald-dark/20 px-4 py-2 text-sm text-brown-dark hover:border-emerald-mid disabled:opacity-50 transition-colors"
        >
          {loading ? 'Отправляем…' : 'Отправить ссылку для сброса'}
        </button>
      </form>

      {notice && <p role="status" className="mt-3 text-sm text-emerald-dark">{notice}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-wine">{error}</p>}
    </section>
  )
}
