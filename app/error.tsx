'use client'

import Link from 'next/link'
import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="text-center max-w-md">
        <div className="font-playfair text-8xl font-bold text-wine/20 mb-2">
          500
        </div>
        <h1 className="font-playfair text-2xl font-bold text-emerald-dark mb-3">
          Что-то пошло не так
        </h1>
        <p className="text-sm text-brown/65 mb-8 leading-relaxed">
          Мы уже работаем над этим. Попробуйте обновить страницу.
        </p>
        <div className="flex gap-3 justify-center flex-wrap">
          <button
            onClick={reset}
            className="bg-emerald-mid hover:bg-emerald-dark text-cream px-5 py-2.5 rounded-full text-sm transition-colors"
          >
            Попробовать снова
          </button>
          <Link
            href="/"
            className="border border-emerald-dark/20 hover:bg-cream-warm/50 text-brown-dark px-5 py-2.5 rounded-full text-sm transition-colors"
          >
            На главную
          </Link>
        </div>
      </div>
    </main>
  )
}
