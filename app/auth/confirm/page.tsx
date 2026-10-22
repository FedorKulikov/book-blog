'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import type { EmailOtpType } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { humanizeError } from '@/lib/errors'
import { Library, CheckCircle2, AlertTriangle } from '@/app/components/icons'

type Status = 'loading' | 'success' | 'error'

function ConfirmContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [status, setStatus] = useState<Status>('loading')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    let alive = true
    let timer: number | undefined

    async function confirm() {
      const tokenHash = searchParams.get('token_hash')
      const type = searchParams.get('type') || 'email'

      // Первый await — чтобы setState не выполнялся синхронно в эффекте
      // (правило react-hooks/set-state-in-effect)
      await Promise.resolve()
      if (!alive) return

      if (!tokenHash) {
        setErrorMsg('Ссылка подтверждения неполная: в ней нет token_hash.')
        setStatus('error')
        return
      }

      const { error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: type as EmailOtpType,
      })

      if (!alive) return

      if (error) {
        setErrorMsg(humanizeError(error.message))
        setStatus('error')
        return
      }

      setStatus('success')
      timer = window.setTimeout(() => {
        router.push('/welcome')
      }, 1500)
    }

    confirm()

    return () => {
      alive = false
      if (timer) window.clearTimeout(timer)
    }
  }, [searchParams, router])

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-cream">
      <div className="w-full max-w-md text-center">
        {status === 'loading' && (
          <>
            <Library
              size={48}
              strokeWidth={1.2}
              className="text-emerald-mid mx-auto mb-6"
            />
            <h1 className="font-playfair text-2xl font-bold text-emerald-dark mb-3">
              Проверяем ссылку…
            </h1>
            <div className="w-10 h-10 border-4 border-emerald-mid/20 border-t-emerald-mid rounded-full animate-spin mx-auto mt-6" />
          </>
        )}

        {status === 'success' && (
          <>
            <CheckCircle2
              size={64}
              strokeWidth={1.5}
              className="text-emerald-mid mx-auto mb-6"
            />
            <h1 className="font-playfair text-3xl font-bold text-emerald-dark mb-3">
              Email подтверждён!
            </h1>
            <p className="text-brown-dark/70 mb-6">Сейчас перенаправим…</p>
            <Link
              href="/welcome"
              className="text-wine hover:underline text-sm"
            >
              Перейти сейчас →
            </Link>
          </>
        )}

        {status === 'error' && (
          <>
            <AlertTriangle
              size={64}
              strokeWidth={1.5}
              className="text-wine mx-auto mb-6"
            />
            <h1 className="font-playfair text-2xl font-bold text-emerald-dark mb-3">
              Не удалось подтвердить
            </h1>
            <p className="text-brown-dark/70 mb-6">{errorMsg}</p>
            <Link
              href="/login"
              className="inline-block bg-wine hover:bg-wine-dark text-white px-5 py-2.5 rounded-full text-sm transition-colors"
            >
              Попробовать снова
            </Link>
          </>
        )}
      </div>
    </main>
  )
}

export default function AuthConfirmPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen flex items-center justify-center bg-cream">
          <div className="w-10 h-10 border-4 border-emerald-mid/20 border-t-emerald-mid rounded-full animate-spin" />
        </main>
      }
    >
      <ConfirmContent />
    </Suspense>
  )
}
