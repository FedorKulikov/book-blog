'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase/client'
import { passkeyErrorMessage, passkeysEnabled } from '@/lib/passkeys'

type Passkey = {
  id: string
  friendly_name?: string | null
  created_at: string
  last_used_at?: string | null
}

function formatDate(value: string | null | undefined): string {
  if (!value) return 'ещё не использовался'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'дата неизвестна'
  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

export default function PasskeySecurity() {
  const [passkeys, setPasskeys] = useState<Passkey[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!passkeysEnabled) return

    let alive = true

    async function load() {
      try {
        const { data, error: listError } = await supabase.auth.passkey.list()
        if (!alive) return

        if (listError) {
          setError(passkeyErrorMessage(listError))
        } else {
          setPasskeys((data ?? []) as Passkey[])
        }
      } catch (loadError) {
        if (alive) setError(passkeyErrorMessage(loadError))
      } finally {
        if (alive) setLoading(false)
      }
    }

    void load()

    return () => {
      alive = false
    }
  }, [])

  async function addPasskey() {
    setBusy(true)
    setError('')
    setNotice('')

    try {
      const { error: registerError } = await supabase.auth.registerPasskey()

      if (registerError) {
        setError(passkeyErrorMessage(registerError))
        return
      }

      const { data, error: listError } = await supabase.auth.passkey.list()
      if (listError) {
        setError(passkeyErrorMessage(listError))
        return
      }

      setPasskeys((data ?? []) as Passkey[])
      setNotice('Ключ доступа добавлен. Не удаляйте резервные коды — храните оба способа входа.')
    } catch (registerError) {
      setError(passkeyErrorMessage(registerError))
    } finally {
      setBusy(false)
    }
  }

  async function removePasskey(passkey: Passkey) {
    const name = passkey.friendly_name || 'этот ключ доступа'
    if (!window.confirm(`Удалить «${name}»? Этот ключ больше не сможет входить в аккаунт.`)) {
      return
    }

    setBusy(true)
    setError('')
    setNotice('')

    try {
      const { error: deleteError } = await supabase.auth.passkey.delete({
        passkeyId: passkey.id,
      })

      if (deleteError) {
        setError(passkeyErrorMessage(deleteError))
        return
      }

      setPasskeys(current => current.filter(item => item.id !== passkey.id))
      setNotice('Ключ доступа удалён.')
    } catch (deleteError) {
      setError(passkeyErrorMessage(deleteError))
    } finally {
      setBusy(false)
    }
  }

  if (!passkeysEnabled) return null

  return (
    <section className="rounded-xl border border-emerald-dark/15 p-4">
      <h2 className="font-semibold text-emerald-dark mb-1">Ключи доступа</h2>
      <p className="text-sm text-brown/70 mb-3">
        Позволяют входить без пароля с помощью устройства или менеджера паролей.
        Добавьте ключи на разных устройствах, если они поддерживают passkeys.
      </p>

      {loading ? (
        <p className="text-sm text-brown/50">Проверяем ключи…</p>
      ) : (
        <>
          {passkeys.length === 0 ? (
            <p className="text-sm text-wine mb-3">
              Ключи доступа ещё не добавлены.
            </p>
          ) : (
            <ul className="space-y-2 mb-3">
              {passkeys.map(passkey => (
                <li
                  key={passkey.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-cream-warm/30 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-brown-dark">
                      {passkey.friendly_name || 'Ключ доступа'}
                    </p>
                    <p className="text-xs text-brown/55">
                      Добавлен: {formatDate(passkey.created_at)} · Последний вход: {formatDate(passkey.last_used_at)}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void removePasskey(passkey)}
                    className="text-xs text-wine hover:underline disabled:opacity-50"
                  >
                    Удалить
                  </button>
                </li>
              ))}
            </ul>
          )}

          <button
            type="button"
            disabled={busy}
            onClick={() => void addPasskey()}
            className="rounded-full bg-emerald-mid px-4 py-2 text-sm text-cream hover:bg-emerald-dark disabled:opacity-50 transition-colors"
          >
            {busy ? 'Выполняем…' : 'Добавить ключ доступа'}
          </button>
        </>
      )}

      {notice && <p role="status" className="mt-3 text-sm text-emerald-dark">{notice}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-wine">Ошибка: {error}</p>}
      <p className="mt-3 text-xs text-brown/55">
        Ключ доступа — дополнительный способ входа, а не замена резервным кодам.
        Не удаляйте последний рабочий ключ, пока не проверили остальные способы входа.
      </p>
    </section>
  )
}
