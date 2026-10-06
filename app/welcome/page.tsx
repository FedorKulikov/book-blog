'use client'

import { useState } from 'react'
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
