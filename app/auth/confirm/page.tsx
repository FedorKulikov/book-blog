'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import type { EmailOtpType } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { humanizeError } from '@/lib/errors'
import { safeInternalPath } from '@/lib/auth-navigation'
import { Library, CheckCircle2, AlertTriangle } from '@/app/components/icons'

type Status = 'loading' | 'pending' | 'success' | 'error'

const SESSION_WAIT_MS = 3000
const SESSION_POLL_MS = 250

function ConfirmContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [status, setStatus] = useState<Status>('loading')
  const [errorMsg, setErrorMsg] = useState('')
  const [confirming, setConfirming] = useState(false)

  const rawNext = searchParams.get('next')
  const safeNext = safeInternalPath(rawNext)
  const next = safeNext === '/' ? '/welcome' : safeNext
  const isRecovery = next === '/auth/reset'
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type') || 'email'

  useEffect(() => {
    let alive = true
    let timer: number | undefined

    async function prepare() {
      await Promise.resolve()
      if (!alive) return

      // Do not consume token_hash on GET. Email scanners often prefetch links;
      // verification happens only after the user explicitly presses the button.
      if (tokenHash) {
        setStatus('pending')
        return
      }

      // Legacy implicit flow: supabase-js may process an access token from URL
      // fragment. No one-time token_hash is consumed by this page.
      const deadline = Date.now() + SESSION_WAIT_MS
      while (Date.now() < deadline) {
        const { data } = await supabase.auth.getSession()
        if (!alive) return

        if (data.session) {
          setStatus('success')
          timer = window.setTimeout(() => router.replace(next), 1500)
          return
        }

        await new Promise(resolve => window.setTimeout(resolve, SESSION_POLL_MS))
      }

      setErrorMsg(
        isRecovery
          ? 'Ссылка недействительна или устарела. Используйте резервный код либо запросите новую ссылку.'
          : 'Не удалось восстановить сессию. Возможно, ссылка устарела — попробуйте подтвердить email ещё раз.',
      )
      setStatus('error')
    }

    void prepare()

    return () => {
      alive = false
      if (timer) window.clearTimeout(timer)
    }
  }, [searchParams, router, next, isRecovery, tokenHash])

  async function verifyToken() {
    if (!tokenHash || confirming) return

    setConfirming(true)
    setErrorMsg('')

    try {
      const { error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: type as EmailOtpType,
      })

      if (error) {
        // A provider may have consumed a link before the browser finished
        // processing the response, but only accept it when a session exists.
        const { data } = await supabase.auth.getSession()
        if (data.session) {
          setStatus('success')
          window.setTimeout(() => router.replace(next), 1500)
          return
        }

        setErrorMsg(humanizeError(error.message))
        setStatus('error')
        return
      }

      setStatus('success')
      window.setTimeout(() => router.replace(next), 1500)
    } catch (error) {
      setErrorMsg(
        error instanceof Error
          ? humanizeError(error.message)
          : 'Не удалось подтвердить ссылку. Попробуйте ещё раз.',
      )
      setStatus('error')
    } finally {
      setConfirming(false)
    }
  }

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
            <div className="w-10 h-10 border-4 border-emerald-mid/20 border-t-emerald-mid rounded-full mx-auto mt-6 animate-spin" />
          </>
        )}

        {status === 'pending' && (
          <>
            <Library
              size={48}
              strokeWidth={1.2}
              className="text-emerald-mid mx-auto mb-6"
            />
            <h1 className="font-playfair text-2xl font-bold text-emerald-dark mb-3">
              {isRecovery ? 'Подтвердить сброс пароля' : 'Подтвердить email'}
            </h1>
            <p className="text-brown-dark/70 mb-6">
              {isRecovery
                ? 'Нажмите кнопку, чтобы подтвердить одноразовую ссылку и перейти к созданию нового пароля.'
                : 'Нажмите кнопку, чтобы завершить подтверждение email.'}
            </p>
            <button
              type="button"
              onClick={() => void verifyToken()}
              disabled={confirming}
              className="w-full rounded-full bg-emerald-mid px-5 py-2.5 text-sm text-cream hover:bg-emerald-dark disabled:opacity-50 transition-colors"
            >
              {confirming ? 'Проверяем…' : 'Продолжить'}
            </button>
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
              {isRecovery ? 'Ссылка подтверждена' : 'Email подтверждён!'}
            </h1>
            <p className="text-brown-dark/70 mb-6">
              {isRecovery
                ? 'Сейчас перейдём к смене пароля…'
                : 'Сейчас перенаправим…'}
            </p>
            <Link href={next} className="text-wine hover:underline text-sm">
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
              href={isRecovery ? '/recover-account' : '/login'}
              className="inline-block bg-wine hover:bg-wine-dark text-white px-5 py-2.5 rounded-full text-sm transition-colors"
            >
              {isRecovery ? 'Восстановить по резервному коду' : 'Попробовать снова'}
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
