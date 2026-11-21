'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase/client'
import { humanizeError } from '@/lib/errors'
import { passkeysEnabled } from '@/lib/passkeys'

const MIN_PASSWORD = 8

export default function ChangePassword() {
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  if (!passkeysEnabled) return null

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setNotice('')

    if (password.length < MIN_PASSWORD) {
      setError(`Пароль должен быть не короче ${MIN_PASSWORD} символов.`)
      return
    }

    if (password !== repeat) {
      setError('Пароли не совпадают.')
      return
    }

    setLoading(true)

    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password,
      })

      if (updateError) {
        setError(humanizeError(updateError.message))
        return
      }

      setPassword('')
      setRepeat('')
      setNotice(
        'Пароль изменён. Теперь создайте новый набор резервных кодов ниже и сохраните его отдельно.',
      )
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? humanizeError(updateError.message)
          : 'Не удалось изменить пароль. Попробуйте ещё раз.',
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="rounded-xl border border-emerald-dark/15 p-4">
      <h2 className="font-semibold text-emerald-dark mb-1">Сменить пароль</h2>
      <p className="text-sm text-brown/70 mb-3">
        Например, после входа с ключом доступа, если старый пароль забыт.
      </p>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label htmlFor="new-account-password" className="block text-sm font-medium mb-1 text-brown-dark">
            Новый пароль
          </label>
          <input
            id="new-account-password"
            type="password"
            value={password}
            onChange={event => setPassword(event.target.value)}
            minLength={MIN_PASSWORD}
            autoComplete="new-password"
            required
            className="w-full border border-emerald-dark/20 rounded px-3 py-2 bg-cream-warm/50"
            placeholder={`Минимум ${MIN_PASSWORD} символов`}
          />
        </div>

        <div>
          <label htmlFor="repeat-account-password" className="block text-sm font-medium mb-1 text-brown-dark">
            Повторите новый пароль
          </label>
          <input
            id="repeat-account-password"
            type="password"
            value={repeat}
            onChange={event => setRepeat(event.target.value)}
            minLength={MIN_PASSWORD}
            autoComplete="new-password"
            required
            className="w-full border border-emerald-dark/20 rounded px-3 py-2 bg-cream-warm/50"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="rounded-full bg-emerald-mid px-4 py-2 text-sm text-cream hover:bg-emerald-dark disabled:opacity-50 transition-colors"
        >
          {loading ? 'Сохраняем…' : 'Изменить пароль'}
        </button>
      </form>

      {notice && <p role="status" className="mt-3 text-sm text-emerald-dark">{notice}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-wine">Ошибка: {error}</p>}
    </section>
  )
}
