'use client'

// app/components/RecoveryCodes.tsx
//
// Блок «Резервные коды» в настройках профиля.
// Показывает, сколько кодов активно, и позволяет выпустить новый набор.
// Открытые коды видны ровно один раз — после этого их не вернуть.
import { useEffect, useState } from 'react'
import CodesReveal from './CodesReveal'

type Status = { active: number; configured: boolean }

export default function RecoveryCodes() {
  const [status, setStatus] = useState<Status | null>(null)
  const [asking, setAsking] = useState(false)
  const [password, setPassword] = useState('')
  const [codes, setCodes] = useState<string[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true

    async function load() {
      try {
        const res = await fetch('/api/recovery/status', { cache: 'no-store' })
        const data = (await res.json().catch(() => ({}))) as Partial<Status>

        if (!alive) return

        setStatus({
          active: typeof data.active === 'number' ? data.active : 0,
          configured: data.configured === true,
        })
      } catch {
        if (alive) setStatus({ active: 0, configured: false })
      }
    }

    load()

    return () => {
      alive = false
    }
  }, [])

  async function generate(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/recovery/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })

      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        codes?: string[]
      }

      if (!res.ok || !Array.isArray(data.codes)) {
        setError(data.error || 'Не удалось создать коды')
        return
      }

      setCodes(data.codes)
      setPassword('')
      setAsking(false)
      setStatus({ active: data.codes.length, configured: true })
    } catch {
      setError('Сеть недоступна. Попробуйте ещё раз.')
    } finally {
      setLoading(false)
    }
  }

  if (codes) {
    return (
      <CodesReveal
        codes={codes}
        onDone={() => setCodes(null)}
        title="Новый набор создан — прежние коды отменены"
      />
    )
  }

  return (
    <div className="rounded-xl border border-emerald-dark/15 p-4">
      <h2 className="font-semibold text-emerald-dark mb-1">Резервные коды</h2>
      <p className="text-sm text-brown/70 mb-3">
        Позволяют восстановить пароль без доступа к почте: имя пользователя плюс
        один код.
      </p>

      {status === null && <p className="text-sm text-brown/50">Проверяем…</p>}

      {status && !status.configured && (
        <p className="text-sm text-wine">
          Восстановление по кодам не настроено на сервере — обратитесь к
          администрации.
        </p>
      )}

      {status && status.configured && (
        <>
          <p className="text-sm mb-3">
            {status.active > 0 ? (
              <>
                Активных кодов: <span className="font-semibold">{status.active}</span>
              </>
            ) : (
              <span className="text-wine">
                Коды не созданы — восстановить доступ без почты пока нельзя.
              </span>
            )}
          </p>

          {!asking ? (
            <button
              type="button"
              onClick={() => setAsking(true)}
              className="rounded-full bg-emerald-mid px-4 py-2 text-sm text-cream hover:bg-emerald-dark transition-colors"
            >
              {status.active > 0 ? 'Создать новые коды' : 'Создать резервные коды'}
            </button>
          ) : (
            <form onSubmit={generate} className="space-y-3">
              <p className="text-sm text-brown/70">
                {status.active > 0
                  ? 'Новый набор отменит все прежние коды. Подтвердите пароль.'
                  : 'Подтвердите пароль, чтобы создать коды.'}
              </p>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="Текущий пароль"
                className="w-full border border-emerald-dark/20 rounded px-3 py-2 bg-cream-warm/50"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="rounded-full bg-emerald-mid px-4 py-2 text-sm text-cream hover:bg-emerald-dark disabled:opacity-50 transition-colors"
                >
                  {loading ? 'Создаём…' : 'Создать коды'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAsking(false)
                    setPassword('')
                    setError('')
                  }}
                  className="rounded-full px-4 py-2 text-sm text-brown/70 hover:text-wine transition-colors"
                >
                  Отмена
                </button>
              </div>
            </form>
          )}
        </>
      )}

      {error && <p className="mt-3 text-sm text-wine">Ошибка: {error}</p>}
    </div>
  )
}
