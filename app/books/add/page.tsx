// app/books/add/page.tsx
// Server Component: только для авторизованных. Гостя отправляем на логин.
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { ChevronLeft } from '@/app/components/icons'
import AddBookForm from './AddBookForm'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Добавить книгу',
  robots: { index: false, follow: false },
}

export default async function AddBookPage() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  return (
    <main className="p-4 md:p-8 max-w-2xl mx-auto">
      <Link
        href="/books"
        className="flex items-center gap-1 text-sm text-brown/70 hover:text-wine mb-6 transition-colors"
      >
        <ChevronLeft size={15} strokeWidth={2} />
        <span>К каталогу книг</span>
      </Link>

      <h1 className="font-playfair text-2xl md:text-3xl font-bold text-emerald-dark mb-2">
        Добавить книгу
      </h1>
      <p className="text-sm text-brown/60 mb-8">
        Книга появится в каталоге сразу. После этого к ней можно привязать посты.
      </p>

      <AddBookForm />
    </main>
  )
}
