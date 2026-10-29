'use client'

import { useState } from 'react'
import PostCard from '../components/PostCard'
import Hero from '../components/Hero'
import TopAuthors from '../components/TopAuthors'
import PopularPosts from '../components/PopularPosts'
import TopTags from '../components/TopTags'
import SortTabs, { SortKey } from '../components/SortTabs'
import EmptyState from '../components/EmptyState'
import SectionStats from '../components/SectionStats'
import { Library, BookOpen } from '../components/icons'

export default function NewsClient({ initialPosts }: { initialPosts: any[] }) {
  const [sort, setSort] = useState<SortKey>('new')

  const sortedPosts = [...initialPosts].sort((a, b) => {
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

          {sortedPosts.length === 0 && (
            <EmptyState
              icon={<BookOpen size={48} strokeWidth={1.2} />}
              title="Пока здесь тихо"
              description="Станьте первым, кто расскажет о книге, которую сейчас читает."
              action={{ label: 'Написать пост', href: '/news/new' }}
            />
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-start">
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

        </aside>
      </div>
    </main>
  )
}
