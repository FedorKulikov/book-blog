'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import CodesReveal from '@/app/components/CodesReveal'
import {
  BookOpen,
  MessageCircle,
  PenLine,
  ChevronRight,
  Library,
} from '@/app/components/icons'

const actions = [
  {
    href: '/news',
    Icon: BookOpen,
    title: 'Найти интересное',
    description: 'Посмотрите книжные новости и свежие публикации.',
  },
  {
    href: '/discussions',
    Icon: MessageCircle,
    title: 'Присоединиться к обсуждению',
    description: 'Поговорите с другими читателями о книгах.',
  },
  {
    href: '/news/new',
    Icon: PenLine,
    title: 'Написать первый пост',
    description: 'Поделитесь книгой, мыслью или творчеством.',
  },
]

export default function WelcomePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [checkingRecovery, setCheckingRecovery] = useState(true)
  const [showRecoveryGate, setShowRecoveryGate] = useState(false)
  const [recoveryDeclineKey, setRecoveryDeclineKey] = useState('')
  const [recoveryPassword, setRecoveryPassword] = useState('')
  const [recoveryError, setRecoveryError] = useState('')
  const [generatingCodes, setGeneratingCodes] = useState(false)
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null)
  const [riskAcknowledged, setRiskAcknowledged] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function checkRecoveryStatus() {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()

        if (!user || cancelled) return

        const declineKey = `recovery-codes-declined:${user.id}`
        setRecoveryDeclineKey(declineKey)

        if (window.localStorage.getItem(declineKey) === '1') return

        const response = await fetch('/api/recovery/status', {
          method: 'GET',
          cache: 'no-store',
        })

        if (!response.ok || cancelled) return

        const status: unknown = await response.json()
        if (
          status &&
          typeof status === 'object' &&
          'configured' in status &&
          'active' in status &&
          status.configured === true &&
          status.active === 0
        ) {
          setShowRecoveryGate(true)
        }
      } catch {
        // Недоступность проверки не должна блокировать обычный вход на сайт.
      } finally {
        if (!cancelled) setCheckingRecovery(false)
      }
    }

    void checkRecoveryStatus()

    return () => {
      cancelled = true
    }
  }, [])

  async function finish() {
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      await supabase
        .from('profiles')
        .update({ onboarding_completed_at: new Date().toISOString() })
        .eq('id', user.id)
    }
  }

  async function finishAndGoHome() {
    setLoading(true)
    await finish()
    router.push('/')
    router.refresh()
  }

  async function generateRecoveryCodes(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setRecoveryError('')

    if (!recoveryPassword) {
      setRecoveryError('Введите пароль.')
      return
    }

    setGeneratingCodes(true)

    try {
      const response = await fetch('/api/recovery/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: recoveryPassword }),
      })

      const result: unknown = await response.json().catch(() => null)

      if (response.status === 503) {
        setShowRecoveryGate(false)
        return
      }

      if (response.status === 429) {
        setRecoveryError('Слишком много попыток, повторите позже.')
        return
      }

      if (response.status === 401) {
        setRecoveryError('Сессия истекла, войдите заново.')
        return
      }

      if (response.status === 500) {
        setRecoveryError('Не удалось выдать коды, попробуйте ещё раз.')
        return
      }

      if (response.status === 403) {
        setRecoveryError('Неверный пароль. Проверьте его и попробуйте ещё раз.')
        return
      }

      if (
        !response.ok ||
        !result ||
        typeof result !== 'object' ||
        !('codes' in result) ||
        !Array.isArray(result.codes) ||
        result.codes.length !== 10 ||
        !result.codes.every(code => typeof code === 'string')
      ) {
        setRecoveryError('Не удалось выдать коды, попробуйте ещё раз.')
        return
      }

      setRecoveryCodes(result.codes)
      setRecoveryPassword('')
    } catch {
      setRecoveryError('Не удалось выдать коды, попробуйте ещё раз.')
    } finally {
      setGeneratingCodes(false)
    }
  }

  function continueWithoutCodes() {
    if (!riskAcknowledged) return

    try {
      if (recoveryDeclineKey) {
        window.localStorage.setItem(recoveryDeclineKey, '1')
      }
    } catch {
      // Запоминание отказа необязательно для продолжения текущего сеанса.
    }

    setShowRecoveryGate(false)
  }

  if (checkingRecovery) {
    return (
      <main className="min-h-screen bg-cream px-4 md:px-6 py-12">
        <div className="mx-auto max-w-4xl text-sm text-brown-dark/70">
          Проверяем настройки аккаунта…
        </div>
      </main>
    )
  }

  if (showRecoveryGate) {
    return (
      <main className="min-h-screen bg-cream px-4 md:px-6 py-12">
        <div className="mx-auto max-w-2xl">
          <div className="mb-8 flex items-center gap-2 text-wine">
            <Library size={20} strokeWidth={1.6} />
            <span className="text-sm font-medium uppercase tracking-[0.18em]">
              Хлеба и букв
            </span>
          </div>

          {recoveryCodes ? (
            <CodesReveal
              codes={recoveryCodes}
              title="Сохраните резервные коды"
              doneLabel="Я сохранил коды — продолжить"
              onDone={() => {
                setRecoveryCodes(null)
                setShowRecoveryGate(false)
              }}
            />
          ) : (
            <>
              <h1 className="font-playfair text-3xl md:text-4xl font-bold text-emerald-dark">
                Защитите доступ к аккаунту
              </h1>
              <p className="mt-4 text-base leading-7 text-brown-dark/80">
                Создайте резервные коды сейчас. Они помогут восстановить доступ,
                если вы забудете пароль и не сможете воспользоваться обычным
                восстановлением.
              </p>

              <form onSubmit={generateRecoveryCodes} className="mt-6 space-y-4">
                <div>
                  <label
                    htmlFor="recovery-password"
                    className="mb-2 block text-sm font-medium text-brown-dark"
                  >
                    Пароль
                  </label>
                  <input
                    id="recovery-password"
                    type="password"
                    autoComplete="current-password"
                    value={recoveryPassword}
                    onChange={event => setRecoveryPassword(event.target.value)}
                    className="w-full rounded-lg border border-brown-dark/20 bg-white px-4 py-3 text-brown-dark outline-none focus:border-emerald-mid"
                    required
                  />
                </div>

                {recoveryError && (
                  <p role="alert" className="text-sm text-wine">
                    {recoveryError}
                    {recoveryError.startsWith('Сессия истекла') && (
                      <>
                        {' '}
                        <Link href="/login" className="underline underline-offset-2">
                          Войти
                        </Link>
                      </>
                    )}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={generatingCodes || !recoveryPassword}
                  className="rounded-full bg-emerald-mid px-5 py-3 text-sm font-medium text-cream transition-colors hover:bg-emerald-dark disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {generatingCodes ? 'Создаём коды…' : 'Получить резервные коды'}
                </button>
              </form>

              <div className="mt-8 border-t border-brown-dark/15 pt-5">
                <label className="flex items-start gap-2 text-sm leading-6 text-brown-dark/80">
                  <input
                    type="checkbox"
                    checked={riskAcknowledged}
                    onChange={event => setRiskAcknowledged(event.target.checked)}
                    className="mt-1"
                  />
                  <span>
                    Понимаю, что без резервных кодов не смогу восстановить пароль
                    этим способом, если потеряю доступ к почте.
                  </span>
                </label>
                <button
                  type="button"
                  onClick={continueWithoutCodes}
                  disabled={!riskAcknowledged}
                  className="mt-4 text-sm font-medium text-emerald-dark underline underline-offset-4 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Продолжить без кодов
                </button>
              </div>
            </>
          )}
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-cream px-4 md:px-6 py-12">
      <div className="mx-auto max-w-4xl">
        <div className="mb-12 max-w-2xl">
          <div className="flex items-center gap-2 mb-4 text-wine">
            <Library size={20} strokeWidth={1.6} />
            <span className="text-sm font-medium uppercase tracking-[0.18em]">
              Хлеба и букв
            </span>
          </div>
          <h1 className="font-playfair text-4xl md:text-5xl font-bold text-emerald-dark">
            Добро пожаловать
          </h1>
          <p className="mt-5 text-base md:text-lg leading-8 text-brown-dark/85">
            Это небольшое книжное сообщество, где можно находить новые книги,
            обсуждать прочитанное и публиковать своё творчество.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {actions.map(({ href, Icon, title, description }) => (
            <Link
              key={href}
              href={href}
              onClick={finish}
              className="group border-t border-brown-dark/20 pt-5 transition-opacity hover:opacity-75"
            >
              <Icon size={24} strokeWidth={1.5} className="mb-5 text-wine" />
              <h2 className="font-playfair text-xl md:text-2xl font-bold text-emerald-dark">
                {title}
              </h2>
              <p className="mt-3 text-sm leading-6 text-brown-dark/70">
                {description}
              </p>
              <div className="mt-5 flex items-center gap-2 text-sm font-medium text-emerald-dark">
                <span>Перейти</span>
                <ChevronRight
                  size={16}
                  strokeWidth={1.8}
                  className="transition-transform group-hover:translate-x-1"
                />
              </div>
            </Link>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-4 border-t border-brown-dark/15 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-xl text-sm leading-6 text-brown-dark/70">
            Здесь нет обязательного сценария. Можно сначала просто почитать,
            а написать что-нибудь позже.
          </p>
          <button
            onClick={finishAndGoHome}
            disabled={loading}
            className="text-sm font-medium text-emerald-dark underline underline-offset-4 disabled:opacity-50"
          >
            {loading ? 'Открываем…' : 'Перейти на главную'}
          </button>
        </div>
      </div>
    </main>
  )
}
