'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function EmailRecoveryResetForm() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError('')
    setNotice('')

    try {
      const { error: requestError } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
      )

      if (requestError) {
        setError('Не удалось обработать запрос. Попробуйте ещё раз позже.')
        return
      }

      // Same response regardless of whether an account uses this address.
      setNotice(
        'Если аккаунт с таким адресом существует, письмо для восстановления отправлено. Проверьте входящие и папку «Спам».',
      )
    } catch {
      setError('Не удалось отправить запрос. Проверьте соединение и попробуйте ещё раз.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="rounded-xl border border-emerald-dark/15 p-4">
      <h2 className="font-semibold text-emerald-dark mb-1">Восстановление по email</h2>
      <p className="text-sm text-brown/70 mb-3">
        Укажите адрес электронной почты, связанный с аккаунтом. Мы отправим ссылку для создания нового пароля.
      </p>

      <form onSubmit={handleSubmit} className="space-y-3">
        <label htmlFor="recovery-email" className="block text-sm font-medium text-brown-dark">
          Email аккаунта
        </label>
        <input
          id="recovery-email"
          type="email"
          value={email}
          onChange={event => {
            setEmail(event.target.value)
            setError('')
            setNotice('')
          }}
          autoComplete="email"
          required
          className="w-full border border-emerald-dark/20 rounded px-3 py-2 bg-cream-warm/50"
          placeholder="you@example.com"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-full bg-emerald-mid px-4 py-2 text-sm text-cream hover:bg-emerald-dark disabled:opacity-50 transition-colors"
        >
          {loading ? 'Отправляем…' : 'Отправить ссылку для сброса'}
        </button>
      </form>

      {notice && <p role="status" className="mt-3 text-sm text-emerald-dark">{notice}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-wine">{error}</p>}
    </section>
  )
}
