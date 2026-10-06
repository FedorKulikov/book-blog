'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import PostCard from '../components/PostCard'
import Hero from '../components/Hero'
import TopAuthors from '../components/TopAuthors'
import PopularPosts from '../components/PopularPosts'
import TopTags from '../components/TopTags'
import SortTabs, { SortKey } from '../components/SortTabs'
import EmptyState from '../components/EmptyState'
import SectionStats from '../components/SectionStats'
import { PostGridSkeleton } from '../components/Skeleton'
import { Library, BookOpen } from '../components/icons'

export default function NewsPage() {
  const [posts, setPosts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sort, setSort] = useState<SortKey>('new')

  useEffect(() => {
    async function loadPosts() {
      const { data: { user } } = await supabase.auth.getUser()
      const userId = user?.id || '00000000-0000-0000-0000-000000000000'

      const { data, error } = await supabase
        .from('posts')
        .select('*, profiles!posts_user_id_fkey(username, avatar_url), post_images(url), comments(count), likes(count), post_tags(tags(name, slug)), books(id, title, author, year)')
        .eq('type', 'news')
        .or(`status.eq.approved,user_id.eq.${userId}`)
        .order('created_at', { ascending: false })

      if (error) {
        setError(error.message)
      } else {
        setPosts(data || [])
      }
      setLoading(false)
    }
    loadPosts()
  }, [])

  const sortedPosts = [...posts].sort((a, b) => {
    if (sort === 'popular') {
      const la = a.likes?.[0]?.count ?? 0
      const lb = b.likes?.[0]?.count ?? 0
      return lb - la
    }
    if (sort === 'discussed') {
      const ca = a.comments?.[0]?.count ?? 0
      const cb = b.comments?.[0]?.count ?? 0
      return cb - ca
    }
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })

  return (
    <main className="p-4 md:p-8 max-w-7xl mx-auto">
      <Hero
        title="Книжные новинки"
        subtitle="Свежие книги, которые уже вышли или выйдут совсем скоро"
        image="/hero-news.jpg"
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-8">
        <div>
          <div className="space-y-5 mb-6">
            <SortTabs value={sort} onChange={setSort} />
            <SectionStats type="news" />
          </div>

          {loading && <PostGridSkeleton count={4} />}
          {error && <p className="text-wine">Ошибка: {error}</p>}

          {!loading && !error && sortedPosts.length === 0 && (
            <EmptyState
              icon={<BookOpen size={48} strokeWidth={1.2} />}
              title="Пока здесь тихо"
              description="Станьте первым, кто расскажет о книге, которую сейчас читает."
              action={{ label: 'Написать пост', href: '/news/new' }}
            />
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {sortedPosts.map(post => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
        </div>

        <aside className="space-y-8 hidden lg:block bg-emerald-deep rounded-2xl p-6 text-cream">
          <TopAuthors />
          <PopularPosts />
          <TopTags />

          <div className="pt-6 border-t border-cream/15">
            <div className="flex items-center gap-2 mb-3">
              <Library size={15} strokeWidth={1.7} className="text-cream-warm" />
              <h3 className="font-playfair text-base font-bold text-cream">
                О проекте
              </h3>
            </div>
            <p className="text-xs text-cream/65 leading-relaxed">
              «Хлеба и букв» — место, где читатели и авторы делятся книжными
              новинками, обсуждают прочитанное и публикуют своё творчество.
            </p>
          </div>

          <div className="pt-6 border-t border-cream/15">
            <p className="font-playfair text-xs italic text-cream/55 leading-relaxed">
              «Хорошие книги — это не просто страницы, это часть жизни,
              которая вдохновляет.»
            </p>
          </div>
        </aside>
      </div>
    </main>
  )
}
