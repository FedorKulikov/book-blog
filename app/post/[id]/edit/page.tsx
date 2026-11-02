// app/post/[id]/edit/page.tsx
// Server Component: грузит пост через getPost(), проверяет права на сервере
// и отдаёт данные в клиентскую форму EditPostForm.
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { ChevronLeft } from '@/app/components/icons'
import { getPost } from '../getPost'
import EditPostForm from './EditPostForm'

// Права зависят от сессии — страницу нельзя кешировать
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Редактирование поста',
  robots: { index: false, follow: false },
}

export default async function EditPostPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  // RLS уже отсекает чужие непубличные посты: вернётся null → 404
  const post = await getPost(id)
  if (!post) notFound()

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Гостя отправляем логиниться, а не показываем 404 — так понятнее
  if (!user) redirect('/login')

  const isAuthor = user.id === post.user_id

  let isStaff = false
  if (!isAuthor) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()

    const role = (profile as { role: string | null } | null)?.role ?? null
    isStaff = role === 'admin' || role === 'moderator'
  }

  // Чужим и не-staff — не раскрываем даже существование формы
  if (!isAuthor && !isStaff) notFound()

  return (
    <main className="p-4 md:p-8 max-w-2xl mx-auto">
      <Link
        href={`/post/${post.id}`}
        className="flex items-center gap-1 text-sm text-brown/70 hover:text-wine mb-6 transition-colors"
      >
        <ChevronLeft size={15} strokeWidth={2} />
        <span>Назад к посту</span>
      </Link>

      <h1 className="font-playfair text-2xl md:text-3xl font-bold text-emerald-dark mb-2">
        Редактирование поста
      </h1>
      <p className="text-sm text-brown/60 mb-8">
        {isAuthor
          ? 'Изменения появятся сразу после сохранения.'
          : 'Вы редактируете чужой пост как представитель редакции.'}
      </p>

      <EditPostForm post={post} />
    </main>
  )
}
