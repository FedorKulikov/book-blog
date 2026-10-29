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
import { Feather } from '../components/icons'

export default function CreativeClient({ initialPosts }: { initialPosts: any[] }) {
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
        title="Творчество"
        subtitle="Ваши истории, мысли, вдохновение. Делитесь, создавайте, находите отклик."
        image="/hero-creative.jpg"
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-8">
        <div>
          <div className="space-y-5 mb-6">
            <SortTabs value={sort} onChange={setSort} />
            <SectionStats type="creative" />
          </div>

          {sortedPosts.length === 0 && (
            <EmptyState
              icon={<Feather size={48} strokeWidth={1.2} />}
              title="Здесь пока мало творчества"
              description="Рассказ, стих или эссе — всё найдёт своего читателя."
              action={{ label: 'Опубликовать', href: '/news/new' }}
            />
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-start">
            {sortedPosts.map(post => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
        </div>

        <aside className="space-y-8 hidden lg:block bg-emerald-deep rounded-2xl p-6 text-cream">
          <TopAuthors type="creative" />
          <PopularPosts type="creative" />
          <TopTags type="creative" />

          <div className="pt-6 border-t border-cream/15">
            <div className="flex items-center gap-2 mb-3">
              <Feather size={15} strokeWidth={1.7} className="text-cream-warm" />
              <h3 className="font-playfair text-base font-bold text-cream">
                О разделе
              </h3>
            </div>
            <p className="text-xs text-cream/65 leading-relaxed">
              Здесь авторы делятся стихами, рассказами, эссе и размышлениями.
            </p>
          </div>

        </aside>
      </div>
    </main>
  )
}
