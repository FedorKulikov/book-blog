import { createClient } from '@supabase/supabase-js'
import HomeClient from './HomeClient'

// Отключаем кэширование, чтобы лента всегда показывала свежие посты
export const dynamic = 'force-dynamic'

export default async function HomePage() {
  // Создаем чистый клиент Supabase для сервера (анонимный доступ)
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  // Запрашиваем последние одобренные посты всех типов.
  // Если RLS не разрешает анонимное чтение, тут будет ошибка.
  const { data, error } = await supabase
    .from('posts')
    .select('*, profiles!posts_user_id_fkey(username, avatar_url), post_images(url), comments(count), post_tags(tags(name, slug)), books(id, title, author, year)')
    .eq('status', 'approved')
    .order('created_at', { ascending: false })
    .limit(6)

  if (error) {
    // Выводим ошибку в терминал, чтобы увидеть причину
    console.error("ОШИБКА SUPABASE:", error)

    return (
      <div className="p-8 text-center text-wine">
        Не удалось загрузить ленту постов. Попробуйте позже.
      </div>
    )
  }

  // Передаем данные в клиентский компонент
  return <HomeClient initialPosts={data || []} />
}
