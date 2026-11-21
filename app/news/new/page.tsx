// app/news/new/page.tsx
// Серверная обёртка формы создания новости.
//
// Почему сервер, а не клиентская проверка в useEffect: Layero отдаёт
// предрендеренные копии маршрутов из S3 (заголовок X-Layero-Prerender: s3),
// минуя proxy.ts. Гость и краулер получали страницу «Загрузка…» с кодом 200.
// Здесь вход проверяется до рендера, и маршрут перестаёт быть статическим:
// он читает куки сессии.
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import NewPostPage from './NewsForm'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Новая новость',
  description: 'Опубликовать новость книжного мира.',
  // Форма доступна только авторизованным — в поиске ей делать нечего
  robots: { index: false, follow: false },
}

export default async function NewNewsPage() {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.auth.getUser()

  if (!data.user) redirect('/login?next=%2Fnews%2Fnew')

  return <NewPostPage />
}