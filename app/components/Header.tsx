'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function Sidebar() {
  const [user, setUser] = useState<any>(null)
  const [profile, setProfile] = useState<any>(null)
  const pathname = usePathname()
  const router = useRouter()

  useEffect(() => {
    async function loadUser() {
      const { data: { user } } = await supabase.auth.getUser()
      setUser(user)
      if (user) {
        const { data } = await supabase
          .from('profiles')
          .select('username')
          .eq('id', user.id)
          .single()
        setProfile(data)
      }
    }
    loadUser()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null)
        if (session?.user) {
          supabase
            .from('profiles')
            .select('username')
            .eq('id', session.user.id)
            .single()
            .then(({ data }) => setProfile(data))
        } else {
          setProfile(null)
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  async function handleLogout() {
    await supabase.auth.signOut()
    setUser(null)
    setProfile(null)
    router.push('/')
    router.refresh()
  }

  const navItems = [
    { href: '/', label: 'Главная', icon: '🏠' },
    { href: '/news', label: 'Новинки', icon: '📚' },
    { href: '/creative', label: 'Творчество', icon: '✍️' },
    { href: '/discussions', label: 'Обсуждения', icon: '💬' },
    { href: '/profile', label: 'Профиль', icon: '👤' },
  ]

  return (
    <aside className="w-64 bg-emerald-dark text-cream flex flex-col min-h-screen">
      {/* Логотип */}
      <Link href="/" className="px-6 py-6 border-b border-cream/10">
        <div className="text-xl font-bold flex items-center gap-2">
          📖 <span>Хлеба и букв</span>
        </div>
        <div className="text-xs text-cream/60 mt-1">
          Книги. Люди. Идеи. Творчество.
        </div>
      </Link>

      {/* Навигация */}
      <nav className="flex-1 py-4">
        {navItems.map(item => {
          const isActive = pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-6 py-3 text-sm transition-colors ${
                isActive
                  ? 'bg-wine text-white font-medium'
                  : 'text-cream/80 hover:text-cream hover:bg-emerald-mid/40'
              }`}
            >
              <span className="text-base">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          )
        })}
      </nav>

      {/* Кнопка «Создать пост» */}
      <div className="px-4 pb-4">
        <Link
          href="/news/new"
          className="block text-center bg-emerald-mid hover:bg-emerald-light text-cream rounded py-2.5 text-sm transition-colors"
        >
          ✏️ Создать пост
        </Link>
      </div>

      {/* Пользователь или вход */}
      <div className="px-4 pb-4 border-t border-cream/10 pt-4">
        {user ? (
          <div className="flex flex-col gap-2">
            <Link
              href="/profile"
              className="text-sm truncate hover:text-cream-warm"
            >
              👤 {profile?.username || user.email}
            </Link>
            <button
              onClick={handleLogout}
              className="text-xs text-cream/60 hover:text-wine text-left"
            >
              Выйти
            </button>
          </div>
        ) : (
          <Link
            href="/login"
            className="block text-center bg-wine hover:bg-wine-dark text-white rounded py-2 text-sm transition-colors"
          >
            Войти
          </Link>
        )}
      </div>

      {/* Цитата */}
      <div className="px-6 pb-6 pt-3 border-t border-cream/10">
        <p className="text-xs italic text-cream/50 leading-relaxed">
              «Хорошие книги —<br />
              это часть жизни,<br />
              которая вдохновляет.»
        </p>
      </div>
    </aside>
  )
}