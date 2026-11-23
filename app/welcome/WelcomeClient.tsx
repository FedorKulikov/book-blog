'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import {
  BookOpen,
  MessageCircle,
  PenLine,
  ChevronRight,
  Library,
} from '@/app/components/icons'

type LegacyPromptState = {
  has_approved_posts: boolean
  has_legacy_profile: boolean
  already_prompted: boolean
  publication_active: boolean
  legacy_choice: 'granted' | 'hidden' | null
}

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

export default function WelcomeClient() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [legacyPromptState, setLegacyPromptState] = useState<LegacyPromptState | null>(null)
  const [legacyPromptLoading, setLegacyPromptLoading] = useState(true)
  const [legacyPromptBusy, setLegacyPromptBusy] = useState(false)
  const [legacyPromptError, setLegacyPromptError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true

    async function loadLegacyPrompt() {
      try {
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser()

        if (!alive) return

        if (userError || !user) {
          setLegacyPromptError('Не удалось проверить состояние ранее созданных данных. Откройте настройки профиля после повторного входа.')
          setLegacyPromptLoading(false)
          return
        }

        const { data, error } = await supabase.rpc('my_legacy_distribution_prompt_state')
        if (!alive) return

        if (error || !Array.isArray(data)) {
          console.error('[welcome] legacy distribution state lookup failed:', error?.message ?? 'unexpected response')
          setLegacyPromptError('Не удалось проверить, есть ли у вас ранее созданные публичные данные. Выбор можно открыть в настройках профиля.')
        } else {
          setLegacyPromptState((data[0] as LegacyPromptState | undefined) ?? null)
        }

        setLegacyPromptLoading(false)
      } catch {
        if (!alive) return
        setLegacyPromptError('Не удалось проверить состояние ранее созданных данных. Попробуйте обновить страницу.')
        setLegacyPromptLoading(false)
      }
    }

    void loadLegacyPrompt()
    return () => {
      alive = false
    }
  }, [])

  async function resolveLegacyPrompt(decision: 'grant_existing' | 'hide_existing') {
    if (legacyPromptBusy) return

    setLegacyPromptBusy(true)
    setLegacyPromptError(null)

    try {
      // This RPC is called only after the user explicitly presses one of the
      // two decision buttons. Loading this page never records a consent.
      const { error } = await supabase.rpc('resolve_my_legacy_distribution_prompt', {
        p_decision: decision,
      })

      if (error) {
        setLegacyPromptError('Не удалось сохранить выбор. Публичность данных не изменена. Попробуйте ещё раз.')
        return
      }

      const { data, error: stateError } = await supabase.rpc('my_legacy_distribution_prompt_state')
      if (stateError || !Array.isArray(data) || !data[0]) {
        setLegacyPromptState(previous => previous
          ? {
              ...previous,
              already_prompted: true,
              legacy_choice: decision === 'grant_existing' ? 'granted' : 'hidden',
            }
          : previous)
        setLegacyPromptError('Выбор сохранён, но состояние не удалось обновить. Перезагрузите страницу.')
        router.refresh()
        return
      }

      setLegacyPromptState(data[0] as LegacyPromptState)
      router.refresh()
    } catch {
      setLegacyPromptError('Не удалось отправить выбор. Проверьте соединение и попробуйте ещё раз.')
    } finally {
      setLegacyPromptBusy(false)
    }
  }

  const legacyDecisionPending = Boolean(
    legacyPromptState &&
    !legacyPromptState.already_prompted &&
    (legacyPromptState.has_legacy_profile || legacyPromptState.has_approved_posts),
  )

  async function finish() {
    const {
      data: { user },
    } = await supabase.auth.getUser()

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

        {!legacyPromptLoading && legacyDecisionPending && legacyPromptState && (
          <section
            aria-labelledby="welcome-legacy-prompt-title"
            className="mb-10 rounded-2xl border border-wine/25 bg-wine/5 p-5 md:p-6"
          >
            <h2
              id="welcome-legacy-prompt-title"
              className="font-playfair text-xl font-bold text-emerald-dark"
            >
              Решение о ранее созданных данных
            </h2>
            <p className="mt-3 text-sm leading-7 text-brown-dark">
              {legacyPromptState.has_legacy_profile && legacyPromptState.has_approved_posts
                ? 'Публичные поля профиля и ранее одобренные публикации, созданные до даты перехода, пока видны посетителям.'
                : legacyPromptState.has_legacy_profile
                  ? 'Публичные поля существующего профиля пока видны посетителям.'
                  : 'Ранее одобренные публикации пока видны посетителям.'}
              {' '}Вы можете подтвердить их дальнейшее распространение или скрыть. При скрытии записи и файлы
              останутся в аккаунте и не будут удалены.
            </p>
            {legacyPromptState.publication_active && (
              <p className="mt-2 text-sm leading-6 text-brown-dark/80">
                Отдельное согласие на новые публикации останется действовать. Этот выбор не откроет
                старые публикации повторно после скрытия.
              </p>
            )}
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                disabled={legacyPromptBusy}
                onClick={() => void resolveLegacyPrompt('grant_existing')}
                className="rounded-full bg-emerald-mid px-5 py-2.5 text-sm font-medium text-cream hover:bg-emerald-dark disabled:cursor-not-allowed disabled:opacity-50"
              >
                {legacyPromptBusy
                  ? 'Сохраняем…'
                  : legacyPromptState.has_legacy_profile && !legacyPromptState.has_approved_posts
                    ? 'Оставить профиль публичным'
                    : 'Подтвердить распространение'}
              </button>
              <button
                type="button"
                disabled={legacyPromptBusy}
                onClick={() => void resolveLegacyPrompt('hide_existing')}
                className="rounded-full border border-emerald-dark/20 px-5 py-2.5 text-sm font-medium text-brown-dark hover:bg-cream-warm disabled:cursor-not-allowed disabled:opacity-50"
              >
                {legacyPromptState.has_legacy_profile && legacyPromptState.has_approved_posts
                  ? 'Скрыть профиль и публикации'
                  : legacyPromptState.has_legacy_profile
                    ? 'Скрыть профиль'
                    : 'Скрыть публикации'}
              </button>
            </div>
            <p className="mt-3 text-xs leading-5 text-brown-dark/65">
              Решение можно открыть позже в{' '}
              <Link href="/profile/edit" className="underline underline-offset-2 hover:text-wine">
                настройках профиля
              </Link>
              . Подробности — в{' '}
              <Link href="/consent-distribution" className="underline underline-offset-2 hover:text-wine">
                описании распространения данных
              </Link>
              .
            </p>
            {legacyPromptError && (
              <p role="alert" className="mt-3 text-sm text-wine">{legacyPromptError}</p>
            )}
          </section>
        )}

        {legacyPromptError && !legacyDecisionPending && (
          <p role="status" className="mb-6 text-sm text-brown/70">
            {legacyPromptError}{' '}
            <Link href="/profile/edit" className="underline underline-offset-2 hover:text-wine">
              Настройки профиля
            </Link>
          </p>
        )}

        {!legacyPromptLoading && legacyPromptState?.already_prompted && legacyPromptState.legacy_choice === 'granted' && (
          <p role="status" className="mb-6 text-sm text-brown/70">
            Вы подтвердили распространение ранее созданных данных. Управлять отдельными согласиями можно в{' '}
            <Link href="/profile/edit" className="underline underline-offset-2 hover:text-wine">
              настройках профиля
            </Link>
            .
          </p>
        )}

        {!legacyPromptLoading && legacyPromptState?.already_prompted && legacyPromptState.legacy_choice === 'hidden' && (
          <p role="status" className="mb-6 text-sm text-brown/70">
            Вы выбрали скрыть ранее созданные данные. Они сохранены в аккаунте и не удалены.
          </p>
        )}

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
