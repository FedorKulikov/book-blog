import { createClient } from '@supabase/supabase-js'
import NewsClient from './NewsClient'

// Отключаем кэширование, чтобы всегда показывать свежие новости
export const dynamic = 'force-dynamic'

export default async function NewsPage() {
  // Создаем чистый клиент Supabase для сервера (анонимный доступ)
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  // Запрашиваем только одобренные посты.
  // Если RLS не разрешает анонимное чтение, тут будет ошибка.
  const { data, error } = await supabase
    .from('posts')
    .select('*, profiles!posts_user_id_fkey(username, avatar_url), post_images(url), comments(count), likes(count), post_tags(tags(name, slug)), books(id, title, author, year)')
    .eq('type', 'news')
    .eq('status', 'approved')
    .order('created_at', { ascending: false })

  if (error) {
    // Выводим ошибку в терминал VS Code, чтобы увидеть причину
    console.error("ОШИБКА SUPABASE:", error)

    return (
      <div className="p-8 text-center text-wine">
        Не удалось загрузить новости. Попробуйте позже.
      </div>
    )
  }

  // Передаем данные в клиентский компонент
  return <NewsClient initialPosts={data || []} />
}
