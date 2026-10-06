'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, BookOpen, PenLine, User, Search } from './icons'

export default function MobileNav() {
  const pathname = usePathname()

  const items = [
    { href: '/', Icon: Home, label: 'Главная' },
    { href: '/books', Icon: BookOpen, label: 'Книги' },
    { href: '/news/new', Icon: PenLine, label: 'Создать', accent: true },
    { href: '/search', Icon: Search, label: 'Поиск' },
    { href: '/profile', Icon: User, label: 'Профиль' },
  ]

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-emerald-dark text-cream border-t border-cream/10">
      <div className="flex items-center justify-around h-16">
        {items.map(({ href, Icon, label, accent }) => {
          const isActive = pathname === href
          return (
            <Link
              key={href}
              href={href}
              className={`flex flex-col items-center gap-1 px-3 py-2 text-[10px] transition-colors ${
                isActive
                  ? 'text-wine'
                  : accent
                  ? 'text-wine/80'
                  : 'text-cream/60 hover:text-cream'
              }`}
            >
              <Icon
                size={accent ? 22 : 20}
                strokeWidth={1.7}
                fill={isActive && !accent ? 'currentColor' : 'none'}
              />
              <span className={isActive ? 'font-medium' : ''}>{label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
