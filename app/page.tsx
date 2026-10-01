'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import Hero from './components/Hero'
import LikeButton from './components/LikeButton'

export default function HomePage() {
  const [posts, setPosts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('posts')
        .select('*, profiles!posts_user_id_fkey(username), post_images(url)')
        .order('created_at', { ascending: false })
        .limit(5)
      setPosts(data || [])
      setLoading(false)
    }
    load()
  }, [])

  return (
    <main className="p-8 max-w-6xl mx-auto">
      <Hero
        title="Хлеба и букв"
        subtitle="Книги. Люди. Идеи. Творчество."
        image="https://images.unsplash.com/photo-1507842217343-583bb7270b66?w=1200&q=80"
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">
        <Link
          href="/news"
          className="bg-cream-warm/50 hover:bg-cream-warm border border-emerald-dark/10 rounded-lg p-5 transition-colors"
        >
          <div className="text-3xl mb-2">📚</div>
          <h3 className="text-lg font-bold text-emerald-dark">
            Книжные новинки
          </h3>
          <p className="text-sm text-brown/70 mt-1">
            Свежие книги и обзоры
          </p>
        </Link>

        <Link
          href="/creative"
          className="bg-cream-warm/50 hover:bg-cream-warm border border-emerald-dark/10 rounded-lg p-5 transition-colors"
        >
          <div className="text-3xl mb-2">✍️</div>
          <h3 className="text-lg font-bold text-emerald-dark">Творчество</h3>
          <p className="text-sm text-brown/70 mt-1">
            Рассказы, стихи, эссе
          </p>
        </Link>

        <Link
          href="/discussions"
          className="bg-cream-warm/50 hover:bg-cream-warm border border-emerald-dark/10 rounded-lg p-5 transition-colors"
        >
          <div className="text-3xl mb-2">💬</div>
          <h3 className="text-lg font-bold text-emerald-dark">Обсуждения</h3>
          <p className="text-sm text-brown/70 mt-1">
            Мнения и диалоги
          </p>
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-8">
        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-2xl font-bold text-emerald-dark">
              Свежие посты
            </h2>
            <Link
              href="/news"
              className="text-sm text-wine hover:underline"
            >
              Все посты →
            </Link>
          </div>

          {loading && <p className="text-brown">Загрузка…</p>}

          {!loading && posts.length === 0 && (
            <p className="text-brown/70">
              Постов пока нет.{' '}
              <Link href="/news/new" className="text-wine hover:underline">
                Создать первый
              </Link>
              ?
            </p>
          )}

          {posts.map(post => (
            <article
              key={post.id}
              className="border border-emerald-dark/10 rounded-lg p-5 mb-4 bg-cream-warm/40"
            >
              <div className="flex items-center gap-2 mb-2">
                <span
                  className={`text-xs uppercase tracking-wide px-2 py-0.5 rounded ${
                    post.type === 'news'
                      ? 'bg-wine/10 text-wine'
                      : post.type === 'creative'
                      ? 'bg-emerald-mid/10 text-emerald-mid'
                      : 'bg-brown/10 text-brown'
                  }`}
                >
                  {post.type === 'news'
                    ? 'Новинка'
                    : post.type === 'creative'
                    ? 'Творчество'
                    : 'Обсуждение'}
                </span>
              </div>

              <h3 className="text-xl font-bold text-emerald-dark mb-1">
                {post.title}
              </h3>

              <p className="text-brown-dark/80 text-sm mb-3 line-clamp-2">
                {post.content}
              </p>

              {post.post_images && post.post_images.length > 0 && (
                <div className="flex flex-wrap gap-3 mb-3">
                  {post.post_images.slice(0, 2).map((img: any, i: number) => (
                    <a
                      key={i}
                      href={img.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block"
                    >
                      <img
                        src={img.url}
                        alt=""
                        className="rounded-lg border border-emerald-dark/10 max-h-48 w-auto object-contain hover:opacity-90 transition-opacity"
                      />
                    </a>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-3 text-xs text-brown/60">
                <div className="w-6 h-6 rounded-full bg-emerald-mid text-cream flex items-center justify-center text-xs font-bold">
                  {(post.profiles?.username || '?')[0].toUpperCase()}
                </div>
                <span>{post.profiles?.username || 'Аноним'}</span>
                <span>·</span>
                <span>
                  {new Date(post.created_at).toLocaleString('ru-RU', {
                    day: 'numeric',
                    month: 'short',
                  })}
                </span>
                <span className="ml-auto">
                  <LikeButton postId={post.id} />
                </span>
              </div>
            </article>
          ))}
        </div>

        <aside className="space-y-6 hidden lg:block">
          <div className="bg-emerald-dark text-cream rounded-lg p-5">
            <h3 className="text-lg font-bold mb-3">📖 О проекте</h3>
            <p className="text-sm text-cream/80 leading-relaxed">
              «Хлеба и букв» — место, где читатели и авторы делятся книжными
              новинками, обсуждают прочитанное и публикуют творчество.
            </p>
          </div>

          <div className="bg-cream-warm/50 rounded-lg p-5 border border-emerald-dark/10">
            <h3 className="text-lg font-bold text-emerald-dark mb-3">
              ✨ Начните сейчас
            </h3>
            <p className="text-sm text-brown-dark/80 mb-4">
              Зарегистрируйтесь, чтобы публиковать посты, ставить лайки
              и комментировать.
            </p>
            <Link
              href="/signup"
              className="block text-center bg-wine hover:bg-wine-dark text-white rounded py-2 text-sm transition-colors"
            >
              Зарегистрироваться
            </Link>
            <Link
              href="/login"
              className="block text-center text-sm text-wine hover:underline mt-3"
            >
              Уже есть аккаунт? Войти
            </Link>
          </div>
        </aside>
      </div>
    </main>
  )
}