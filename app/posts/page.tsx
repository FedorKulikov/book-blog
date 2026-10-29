// app/posts/page.tsx
// Общая лента: ВСЕ посты без фильтра по типу (news / creative / discussion).
// Первую порцию рендерит сервер (для поисковиков), дальше — «Показать ещё»
// в клиентском PostList (курсорная пагинация по created_at).
import type { Metadata } from 'next'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { fetchPostsPage, PAGE_SIZE } from './postsQuery'
import PostList from './PostList'
import Hero from '../components/Hero'
import EmptyState from '../components/EmptyState'
import { Library } from '../components/icons'

// Лента всегда свежая: не кешируем (как и главную/новости).
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Все посты',
  description:
    'Вся лента книжного сообщества «Хлеба и букв»: книжные новинки, авторское творчество и обсуждения — без фильтра по разделу.',
  alternates: { canonical: '/posts' },
}

export default async function AllPostsPage() {
  const supabase = await createSupabaseServerClient()
  const { posts, hasMore, error } = await fetchPostsPage(supabase, null)

  if (error) {
    console.error('[posts] не удалось загрузить ленту:', error)

    return (
      <main className="p-8 text-center text-wine max-w-3xl mx-auto">
        Не удалось загрузить посты. Попробуйте позже.
      </main>
    )
  }

  return (
    <main className="p-4 md:p-8 max-w-7xl mx-auto">
      <Hero
        title="Все посты"
        subtitle="Вся лента сообщества: книжные новинки, авторское творчество и обсуждения."
        image="/hero-home.jpg"
      />

      {posts.length === 0 ? (
        <EmptyState
          icon={<Library size={48} strokeWidth={1.2} />}
          title="Пока пусто"
          description="Посты появятся, как только авторы их опубликуют."
          action={{ label: 'Написать пост', href: '/news/new' }}
        />
      ) : (
        <>
          <div className="flex items-baseline justify-between mb-5">
            <h2 className="font-playfair text-2xl font-bold text-emerald-dark">
              Свежее
            </h2>
            <span className="text-xs text-brown/50">по {PAGE_SIZE} на порцию</span>
          </div>

          <PostList initialPosts={posts} initialHasMore={hasMore} />
        </>
      )}
    </main>
  )
}
