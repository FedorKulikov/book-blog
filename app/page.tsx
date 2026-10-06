'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import Hero from './components/Hero'
import PostCard from './components/PostCard'
import TopAuthors from './components/TopAuthors'
import PopularPosts from './components/PopularPosts'
import TopTags from './components/TopTags'
import EmptyState from './components/EmptyState'
import { PostGridSkeleton } from './components/Skeleton'
import {
  BookOpen,
  Feather,
  MessageCircle,
  Library,
  PenLine,
  Sparkles,
  ChevronRight,
} from './components/icons'

type FeedFilter = 'all' | 'news' | 'creative' | 'discussion'

const FEED_FILTERS: { key: FeedFilter; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'news', label: 'Книги' },
  { key: 'creative', label: 'Творчество' },
  { key: 'discussion', label: 'Обсуждения' },
]

const FEED_HEADINGS: Record<FeedFilter, string> = {
  all: 'Свежие посты',
  news: 'Новые книги',
  creative: 'Новое творчество',
  discussion: 'Новые обсуждения',
}

export default function HomePage() {
  const [posts, setPosts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<any>(undefined)
  const [filter, setFilter] = useState<FeedFilter>('all')

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      setUser(user)
      const userId = user?.id || '00000000-0000-0000-0000-000000000000'

      let query = supabase
        .from('posts')
        .select('*, profiles!posts_user_id_fkey(username, avatar_url), post_images(url), comments(count), post_tags(tags(name, slug)), books(id, title, author, year)')
        .or(`status.eq.approved,user_id.eq.${userId}`)

      if (filter !== 'all') {
        query = query.eq('type', filter)
      }

      const { data } = await query
        .order('created_at', { ascending: false })
        .limit(6)

      setPosts(data || [])
      setLoading(false)
    }
    load()
  }, [filter])

  return (
    <main className="p-4 md:p-8 max-w-7xl mx-auto">
      <Hero
        title="Хлеба и букв"
        subtitle="Книги. Люди. Идеи. Творчество."
        image="/hero-home.jpg"
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">
        <Link
          href="/books"
          className="group bg-cream-warm/25 hover:bg-cream-warm/50 border border-emerald-dark/8 hover:border-emerald-dark/20 rounded-2xl p-6 transition-colors"
        >
          <BookOpen
            size={26}
            strokeWidth={1.4}
            className="text-emerald-mid mb-3"
          />
          <h3 className="font-playfair text-lg font-bold text-emerald-dark flex items-center gap-2">
            Книги
            <ChevronRight
              size={16}
              strokeWidth={1.8}
              className="opacity-0 group-hover:opacity-100 -ml-1 group-hover:ml-0 transition-all"
            />
          </h3>
          <p className="text-sm text-brown/65 mt-2 leading-relaxed">
            Все книги сообщества
          </p>
        </Link>

        <Link
          href="/creative"
          className="group bg-cream-warm/25 hover:bg-cream-warm/50 border border-emerald-dark/8 hover:border-emerald-dark/20 rounded-2xl p-6 transition-colors"
        >
          <Feather
            size={26}
            strokeWidth={1.4}
            className="text-emerald-mid mb-3"
          />
          <h3 className="font-playfair text-lg font-bold text-emerald-dark flex items-center gap-2">
            Творчество
            <ChevronRight
              size={16}
              strokeWidth={1.8}
              className="opacity-0 group-hover:opacity-100 -ml-1 group-hover:ml-0 transition-all"
            />
          </h3>
          <p className="text-sm text-brown/65 mt-2 leading-relaxed">
            Рассказы, стихи, эссе
          </p>
        </Link>

        <Link
          href="/discussions"
          className="group bg-cream-warm/25 hover:bg-cream-warm/50 border border-emerald-dark/8 hover:border-emerald-dark/20 rounded-2xl p-6 transition-colors"
        >
          <MessageCircle
            size={26}
            strokeWidth={1.4}
            className="text-emerald-mid mb-3"
          />
          <h3 className="font-playfair text-lg font-bold text-emerald-dark flex items-center gap-2">
            Обсуждения
            <ChevronRight
              size={16}
              strokeWidth={1.8}
              className="opacity-0 group-hover:opacity-100 -ml-1 group-hover:ml-0 transition-all"
            />
          </h3>
          <p className="text-sm text-brown/65 mt-2 leading-relaxed">
            Мнения и диалоги
          </p>
        </Link>
      </div>

      {/* Фильтры ленты */}
      <div className="flex flex-wrap gap-2 mb-5">
        {FEED_FILTERS.map(f => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`px-4 py-1.5 rounded-full text-sm transition-colors ${
              filter === f.key
                ? 'bg-wine text-white'
                : 'bg-cream-warm/40 text-brown-dark hover:bg-cream-warm/70 border border-emerald-dark/10'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-8">
        <div>
          <div className="flex justify-between items-center mb-5">
            <h2 className="font-playfair text-2xl font-bold text-emerald-dark">
              {FEED_HEADINGS[filter]}
            </h2>
            <Link
              href="/news"
              className="text-sm text-wine hover:underline flex items-center gap-1"
            >
              Все посты
              <ChevronRight size={14} strokeWidth={2} />
            </Link>
          </div>

          {loading && <PostGridSkeleton count={4} />}

          {!loading && posts.length === 0 && (
            filter === 'all' ? (
              <EmptyState
                icon={<Library size={48} strokeWidth={1.2} />}
                title="Добро пожаловать в Хлеба и букв"
                description="Пока здесь тихо — мы только начинаем. Станьте первым, кто расскажет о книге."
                action={{ label: 'Написать первый пост', href: '/news/new' }}
              />
            ) : (
              <p className="text-sm text-brown/60 py-8 text-center">
                В этом разделе пока нет постов.
              </p>
            )
          )}

          {!loading && posts.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {posts.map(post => (
                <PostCard key={post.id} post={post} />
              ))}
            </div>
          )}
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
              новинками, обсуждают прочитанное и публикуют творчество.
            </p>
          </div>

          {user === null && (
            <div className="pt-6 border-t border-cream/15">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles
                  size={15}
                  strokeWidth={1.7}
                  className="text-cream-warm"
                />
                <h3 className="font-playfair text-base font-bold text-cream">
                  Начните сейчас
                </h3>
              </div>
              <p className="text-xs text-cream/65 mb-4 leading-relaxed">
                Зарегистрируйтесь, чтобы публиковать посты, ставить лайки
                и комментировать.
              </p>
              <Link
                href="/signup"
                className="flex items-center justify-center gap-2 bg-wine hover:bg-wine-dark text-white rounded-full py-2 text-sm transition-colors"
              >
                <PenLine size={14} strokeWidth={1.8} />
                <span>Зарегистрироваться</span>
              </Link>
              <Link
                href="/login"
                className="block text-center text-xs text-cream-warm hover:underline mt-3"
              >
                Уже есть аккаунт? Войти
              </Link>
            </div>
          )}
        </aside>
      </div>
    </main>
  )
}