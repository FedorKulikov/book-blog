import { createClient } from '@supabase/supabase-js'
import BooksClient from './BooksClient'

// Отключаем кэширование, чтобы каталог всегда показывал свежие книги
export const dynamic = 'force-dynamic'

export default async function BooksPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  // В Next.js 15/16 searchParams — это Promise, его нужно await'ить
  const { q } = await searchParams

  // Создаем чистый клиент Supabase для сервера (анонимный доступ)
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  // Запрашиваем каталог книг.
  // Если RLS не разрешает анонимное чтение, тут будет ошибка.
  const { data: books, error: booksError } = await supabase
    .from('books')
    .select('*')
    .order('created_at', { ascending: false })

  if (booksError) {
    // Выводим ошибку в терминал, чтобы увидеть причину
    console.error("ОШИБКА SUPABASE:", booksError)

    return (
      <div className="p-8 text-center text-wine">
        Не удалось загрузить каталог книг. Попробуйте позже.
      </div>
    )
  }

  // Сколько одобренных постов написано о каждой книге
  const { data: rows } = await supabase
    .from('posts')
    .select('book_id')
    .eq('status', 'approved')
    .not('book_id', 'is', null)

  const counts: Record<string, number> = {}
  for (const row of (rows as { book_id: string | null }[] | null) ?? []) {
    if (!row.book_id) continue
    counts[row.book_id] = (counts[row.book_id] ?? 0) + 1
  }

  // Передаем данные в клиентский компонент
  return (
    <BooksClient
      initialBooks={books || []}
      initialPostsCountByBook={counts}
      initialQuery={q || ''}
    />
  )
}
