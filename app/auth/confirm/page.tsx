'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import type { EmailOtpType } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { humanizeError } from '@/lib/errors'
import { Library, CheckCircle2, AlertTriangle } from '@/app/components/icons'

type Status = 'loading' | 'success' | 'error'

// Сколько ждать, пока supabase-js разберёт #access_token из адреса.
// Стандартный поток Supabase кладёт токены в хеш, а не в query, поэтому
// страница должна уметь дождаться сессии, а не требовать token_hash.
const SESSION_WAIT_MS = 3000
const SESSION_POLL_MS = 250

function ConfirmContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [status, setStatus] = useState<Status>('loading')
  const [errorMsg, setErrorMsg] = useState('')

  const rawNext = searchParams.get('next')
  const next = rawNext && /^\/(?!\/)/.test(rawNext) ? rawNext : '/welcome'
  const isRecovery = next.startsWith('/auth/reset')

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

      function succeed() {
        setStatus('success')
        timer = window.setTimeout(() => {
          router.push(next)
        }, 1500)
      }

      // Поток с явным token_hash (кастомный шаблон письма).
      if (tokenHash) {
        const { error } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: type as EmailOtpType,
        })

        if (!alive) return

        if (error) {
          // Токен мог быть уже израсходован, а сессия — установлена.
          const { data } = await supabase.auth.getSession()
          if (!alive) return
          if (data.session) {
            succeed()
            return
          }
          setErrorMsg(humanizeError(error.message))
          setStatus('error')
          return
        }

        succeed()
        return
      }

      // token_hash нет — значит, скорее всего, это стандартный поток
      // Supabase: supabase-js сам разбирает #access_token из адреса.
      // Даём ему время и проверяем сессию несколько раз.
      const deadline = Date.now() + SESSION_WAIT_MS
      while (Date.now() < deadline) {
        const { data } = await supabase.auth.getSession()
        if (!alive) return
        if (data.session) {
          succeed()
          return
        }
        await new Promise(resolve => window.setTimeout(resolve, SESSION_POLL_MS))
      }

      setErrorMsg(
        isRecovery
          ? 'Восстановление пароля по email сейчас отключено. Используйте резервный код, сохранённый при регистрации.'
          : 'В ссылке нет token_hash и не удалось восстановить сессию. Возможно, ссылка устарела — попробуйте подтвердить email ещё раз.',
      )
      setStatus('error')
    }

    confirm()

    return () => {
      alive = false
      if (timer) window.clearTimeout(timer)
    }
  }, [searchParams, router, next])

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
              {isRecovery ? 'Ссылка подтверждена' : 'Email подтверждён!'}
            </h1>
            <p className="text-brown-dark/70 mb-6">
              {isRecovery
                ? 'Сейчас перейдём к смене пароля…'
                : 'Сейчас перенаправим…'}
            </p>
            <Link
              href={next}
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
