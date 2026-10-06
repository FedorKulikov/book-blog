'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import {
  Home,
  BookOpen,
  Feather,
  MessageCircle,
  User,
  Search,
  Mail,
  Shield,
  PenLine,
  LogOut,
  LogIn,
  Menu,
  X as XIcon,
  Library,
} from './icons'
import UnreadMessagesBadge from './UnreadMessagesBadge'

export default function Sidebar() {
  const [user, setUser] = useState<any>(null)
  const [profile, setProfile] = useState<any>(null)
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  const router = useRouter()

  useEffect(() => {
    async function loadUser() {
      const { data: { user } } = await supabase.auth.getUser()
      setUser(user)
      if (user) {
        const { data } = await supabase
          .from('profiles')
          .select('username, role')
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
            .select('username, role')
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

  useEffect(() => {
    setOpen(false)
  }, [pathname])

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.body.style.overflow = open ? 'hidden' : ''
      return () => {
        document.body.style.overflow = ''
      }
    }
  }, [open])

  async function handleLogout() {
    await supabase.auth.signOut()
    setUser(null)
    setProfile(null)
    setOpen(false)
    router.push('/')
    router.refresh()
  }

  const navItems: {
    href: string
    label: string
    Icon: typeof Home
    badge?: boolean
  }[] = [
    { href: '/', label: 'Главная', Icon: Home },
    { href: '/books', label: 'Книги', Icon: BookOpen },
    { href: '/creative', label: 'Творчество', Icon: Feather },
    { href: '/discussions', label: 'Обсуждения', Icon: MessageCircle },
    { href: '/messages', label: 'Сообщения', Icon: Mail, badge: true },
  ]

  const isStaff = profile?.role === 'admin' || profile?.role === 'moderator'

  return (
    <>
      {/* Верхняя полоса — только на мобильных */}
      <header className="mobile-header bg-emerald-dark text-cream px-4 py-3">
        <button
          onClick={() => setOpen(true)}
          className="text-cream"
          aria-label="Открыть меню"
        >
          <Menu size={22} strokeWidth={1.8} />
        </button>
        <Link
          href="/"
          className="font-playfair font-bold flex items-center gap-2"
        >
          <Library size={20} strokeWidth={1.8} />
          <span>Хлеба и букв</span>
        </Link>
        <div className="flex items-center gap-3">
          <Link href="/search" className="text-cream" aria-label="Поиск">
            <Search size={20} strokeWidth={1.8} />
          </Link>
          <Link
            href="/messages"
            className="relative text-cream"
            aria-label="Сообщения"
          >
            <Mail size={20} strokeWidth={1.8} />
            <span className="absolute -top-1 -right-1.5">
              <UnreadMessagesBadge />
            </span>
          </Link>
        </div>
      </header>

      {/* Затемнение под мобильным меню */}
      {open && (
        <div className="sidebar-backdrop" onClick={() => setOpen(false)} />
      )}

      {/* Сайдбар */}
      <aside
        className={`sidebar bg-emerald-dark text-cream ${
          open ? 'open' : 'closed'
        }`}
      >
        <button
          onClick={() => setOpen(false)}
          className="sidebar-close-btn absolute top-3 right-3 text-cream/70 hover:text-cream transition-colors"
          aria-label="Закрыть меню"
        >
          <XIcon size={20} strokeWidth={1.8} />
        </button>

        {/* Логотип */}
        <Link href="/" className="px-6 py-6 border-b border-cream/10">
          <div className="text-xl font-playfair font-bold flex items-center gap-2">
            <Library size={22} strokeWidth={1.6} />
            <span>Хлеба и букв</span>
          </div>
          <div className="text-[11px] tracking-[0.2em] uppercase text-cream/45 mt-2">
            Книги · Люди · Идеи
          </div>
        </Link>

        {/* Навигация */}
        <nav className="flex-1 py-4 overflow-y-auto">
          {navItems.map(({ href, label, Icon, badge }) => {
            const isActive = pathname === href
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 px-6 py-3 text-sm transition-colors ${
                  isActive
                    ? 'bg-wine text-white font-medium'
                    : 'text-cream/75 hover:text-cream hover:bg-emerald-mid/40'
                }`}
              >
                <Icon size={18} strokeWidth={1.7} />
                <span>{label}</span>
                {badge && <UnreadMessagesBadge className="ml-auto" />}
              </Link>
            )
          })}
        </nav>

        {/* Поиск */}
        <div className="px-4 pb-3">
          <Link
            href="/search"
            className="flex items-center justify-center gap-2 bg-cream/5 hover:bg-cream/10 text-cream/90 rounded py-2.5 text-sm transition-colors border border-cream/10"
          >
            <Search size={16} strokeWidth={1.8} />
            <span>Поиск</span>
          </Link>
        </div>

        {/* Создать пост */}
        <div className="px-4 pb-3">
          <Link
            href="/news/new"
            className="flex items-center justify-center gap-2 bg-emerald-mid hover:bg-emerald-light text-cream rounded py-2.5 text-sm transition-colors"
          >
            <PenLine size={16} strokeWidth={1.8} />
            <span>Создать пост</span>
          </Link>
        </div>

        {/* Админ-панель */}
        {isStaff && (
          <div className="px-4 pb-3">
            <Link
              href="/admin"
              className="flex items-center justify-center gap-2 bg-brown hover:bg-brown-dark text-cream rounded py-2 text-sm transition-colors"
            >
              <Shield size={16} strokeWidth={1.8} />
              <span>Админ-панель</span>
            </Link>
          </div>
        )}

        {/* Пользователь или вход */}
        <div className="px-4 pb-4 border-t border-cream/10 pt-4">
          {user ? (
            <div className="flex flex-col gap-2">
              <Link
                href="/profile"
                className="flex items-center gap-2 text-sm truncate hover:text-cream-warm transition-colors"
              >
                <User size={14} strokeWidth={1.8} />
                <span className="truncate">
                  {profile?.username || user.email}
                </span>
              </Link>
              <Link
                href="/profile/edit"
                className="text-[11px] text-cream/40 hover:text-cream-warm transition-colors pl-5"
              >
                Редактировать профиль
              </Link>
              <button
                onClick={handleLogout}
                className="flex items-center gap-2 text-xs text-cream/50 hover:text-wine text-left transition-colors"
              >
                <LogOut size={13} strokeWidth={1.8} />
                <span>Выйти</span>
              </button>
            </div>
          ) : (
            <Link
              href="/login"
              className="flex items-center justify-center gap-2 bg-wine hover:bg-wine-dark text-white rounded py-2 text-sm transition-colors"
            >
              <LogIn size={15} strokeWidth={1.8} />
              <span>Войти</span>
            </Link>
          )}
        </div>

        {/* Цитата */}
        <div className="px-6 pb-6 pt-4 border-t border-cream/10">
          <p className="font-playfair text-xs italic text-cream/40 leading-relaxed">
            «Хорошие книги —<br />
            это часть жизни,<br />
            которая вдохновляет.»
          </p>
        </div>
      </aside>
    </>
  )
}