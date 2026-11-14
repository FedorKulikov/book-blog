// app/admin/news/page.tsx
// Внешние новости (например, с «Читай-города») добавляются вручную редакцией.
// Доступ к /admin/* закрыт в proxy.ts (роль admin/moderator), плюс RLS в БД.
import type { Metadata } from 'next'
import Link from 'next/link'
import ExternalNewsManager from './ExternalNewsManager'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Внешние новости',
  robots: { index: false, follow: false },
}

export default function AdminNewsPage() {
  return (
    <main className="p-4 md:p-8 max-w-7xl mx-auto">
      <Link
        href="/admin"
        className="text-sm text-brown/70 hover:text-wine mb-4 inline-block transition-colors"
      >
        ← В панель модератора
      </Link>

      <h1 className="font-playfair text-2xl md:text-3xl font-bold text-emerald-dark mb-2">
        📰 Внешние новости
      </h1>
      <p className="text-sm text-brown/60 mb-8">
        Новости книжных магазинов и медиа. В карточке публикуются заголовок,
        короткое описание и ссылка на источник.
      </p>

      <ExternalNewsManager />
    </main>
  )
}
