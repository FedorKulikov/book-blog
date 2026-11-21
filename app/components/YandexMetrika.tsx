'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

type Consent = 'accepted' | 'rejected' | null
type MetrikaFunction = ((...args: unknown[]) => void) & {
  a: unknown[][]
  l: number
}

const CONSENT_KEY = 'bookblog-analytics-consent-v1'
const SETTINGS_EVENT = 'bookblog:manage-analytics'

function disableMetrika(id: string) {
  const target = window as unknown as {
    [key: string]: unknown
    ym?: (...args: unknown[]) => void
  }

  // Yandex documents this flag as a way to block cookies and data collection.
  target[`disableYaCounter${id}`] = true
  target.ym?.(Number(id), 'destruct')
}

function enableMetrika(id: string) {
  const target = window as unknown as {
    [key: string]: unknown
    ym?: MetrikaFunction
  }

  target[`disableYaCounter${id}`] = false

  if (!target.ym) {
    const queued = ((...args: unknown[]) => {
      queued.a.push(args)
    }) as MetrikaFunction
    queued.a = []
    queued.l = Date.now()
    target.ym = queued
  }

  // Webvisor is deliberately disabled: this community has private messages
  // and support tickets, whose content must not be session-recorded.
  target.ym(Number(id), 'init', {
    clickmap: true,
    trackLinks: true,
    accurateTrackBounce: true,
    webvisor: false,
  })

  if (!document.querySelector('script[data-yandex-metrika]')) {
    const script = document.createElement('script')
    script.async = true
    script.src = 'https://mc.yandex.ru/metrika/tag.js'
    script.dataset.yandexMetrika = id
    document.head.appendChild(script)
  }
}

export default function YandexMetrika() {
  const id = process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID
  const validId = id && /^\\d+$/.test(id) ? id : null
  const [consent, setConsent] = useState<Consent>(null)

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(CONSENT_KEY)
      setConsent(stored === 'accepted' || stored === 'rejected' ? stored : null)
    } catch {
      // If storage is unavailable, do not initialize optional analytics.
      setConsent('rejected')
    }

    const openSettings = () => {
      if (validId) disableMetrika(validId)
      try {
        window.localStorage.removeItem(CONSENT_KEY)
      } catch {
        // The visitor can still use the page without saving a preference.
      }
      setConsent(null)
    }

    window.addEventListener(SETTINGS_EVENT, openSettings)
    return () => window.removeEventListener(SETTINGS_EVENT, openSettings)
  }, [validId])

  useEffect(() => {
    if (!validId || consent !== 'accepted') return
    enableMetrika(validId)
  }, [consent, validId])

  function chooseConsent(value: Exclude<Consent, null>) {
    try {
      window.localStorage.setItem(CONSENT_KEY, value)
    } catch {
      // Without a saved choice we keep analytics disabled on the next load.
    }

    if (value === 'rejected' && validId) disableMetrika(validId)
    setConsent(value)
  }

  if (!validId || consent !== null) return null

  return (
    <section
      aria-label="Настройки аналитики"
      className="fixed inset-x-3 bottom-20 z-[100] mx-auto max-w-3xl rounded-2xl border border-emerald-dark/15 bg-cream p-4 text-brown-dark shadow-xl sm:inset-x-5 sm:p-5 lg:bottom-5"
    >
      <h2 className="font-playfair text-base font-bold text-emerald-dark">
        Настройки аналитики
      </h2>
      <p className="mt-2 text-xs leading-5 text-brown-dark/75 sm:text-sm">
        Мы используем необходимые технологии для входа и работы сайта. С вашего
        разрешения подключим Яндекс.Метрику, чтобы понимать, какие разделы полезны
        читателям. Отказ не ограничивает доступ к сайту.
        {' '}
        <Link href="/privacy#cookies" className="underline underline-offset-2">
          Подробнее о cookie и аналитике
        </Link>
      </p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={() => chooseConsent('accepted')}
          className="inline-flex min-h-10 flex-1 items-center justify-center rounded-full bg-emerald-dark px-4 py-2 text-sm font-medium text-cream transition-colors hover:bg-emerald-mid focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-dark"
        >
          Разрешить аналитику
        </button>
        <button
          type="button"
          onClick={() => chooseConsent('rejected')}
          className="inline-flex min-h-10 flex-1 items-center justify-center rounded-full border border-emerald-dark/25 px-4 py-2 text-sm font-medium text-emerald-dark transition-colors hover:bg-cream-warm/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-dark"
        >
          Только необходимые
        </button>
      </div>
    </section>
  )
}
