'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import Comments from '../components/Comments'
import LikeButton from '../components/LikeButton'
import Hero from '../components/Hero'

export default function DiscussionsPage() {
  const [posts, setPosts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadPosts() {
      const { data, error } = await supabase
        .from('posts')
        .select('*, profiles!posts_user_id_fkey(username), post_images(url)')
        .eq('type', 'discussion')
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

  return (
    <main className="p-8 max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-8">
      <div>
        <Hero
          title="Обсуждения"
          subtitle="Делитесь мнениями, задавайте вопросы, обсуждайте книги и находите единомышленников."
          image="https://images.unsplash.com/photo-1524995997946-a1c2e315a42f?w=1200&q=80"
        />

        <div className="flex justify-end mb-6">
          <Link
            href="/news/new"
            className="bg-wine text-white px-4 py-2 rounded hover:bg-wine-dark text-sm transition-colors"
          >
            + Создать тему
          </Link>
        </div>

        {loading && <p className="text-brown">Загрузка…</p>}
        {error && <p className="text-wine">Ошибка: {error}</p>}

        {!loading && !error && posts.length === 0 && (
          <p className="text-brown/70">
            Пока нет обсуждений. Начните первым!
          </p>
        )}

        {posts.map(post => (
          <article
            key={post.id}
            className="border border-emerald-dark/10 rounded-lg p-6 mb-4 bg-cream-warm/40"
          >
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs uppercase tracking-wide bg-brown/10 text-brown px-2 py-0.5 rounded">
                Обсуждение
              </span>
            </div>

            <h2 className="text-2xl font-bold text-emerald-dark mb-2">
              {post.title}
            </h2>

            <p className="text-brown-dark whitespace-pre-wrap mb-4">
              {post.content}
            </p>

            {post.post_images && post.post_images.length > 0 && (
              <div className="flex flex-wrap gap-3 mb-4">
                {post.post_images.map((img: any, i: number) => (
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
                      className="rounded-lg border border-emerald-dark/10 max-h-96 w-auto object-contain hover:opacity-90 transition-opacity"
                    />
                  </a>
                ))}
              </div>
            )}

            <div className="flex items-center gap-3 text-sm text-brown/60 border-t border-emerald-dark/5 pt-3">
              <div className="w-7 h-7 rounded-full bg-emerald-mid text-cream flex items-center justify-center text-xs font-bold">
                {(post.profiles?.username || '?')[0].toUpperCase()}
              </div>
              <span className="font-medium text-brown-dark">
                {post.profiles?.username || 'Аноним'}
              </span>
              <span>·</span>
              <span>
                {new Date(post.created_at).toLocaleString('ru-RU', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </span>
              <span className="ml-auto">
                <LikeButton postId={post.id} />
              </span>
            </div>

            <Comments postId={post.id} />
          </article>
        ))}
      </div>

      <aside className="space-y-6 hidden lg:block">
        <div className="bg-cream-warm/50 rounded-lg p-5 border border-emerald-dark/10">
          <h3 className="text-lg font-bold text-emerald-dark mb-3">
            💬 О разделе
          </h3>
          <p className="text-sm text-brown-dark/80 leading-relaxed">
            Задавайте вопросы, делитесь мнениями, спорьте о книгах — здесь
            собираются те, кто любит читать и обсуждать.
          </p>
        </div>

        <div className="bg-emerald-dark text-cream rounded-lg p-5">
          <p className="text-sm italic leading-relaxed">
            «Хорошие книги объединяют людей.»
          </p>
        </div>

        <div className="bg-cream-warm/50 rounded-lg p-5 border border-emerald-dark/10">
          <h3 className="text-lg font-bold text-emerald-dark mb-3">
            🔥 Начать тему
          </h3>
          <p className="text-sm text-brown-dark/80 mb-4">
            Есть вопрос или мысль? Поделитесь с сообществом.
          </p>
          <Link
            href="/news/new"
            className="block text-center bg-wine hover:bg-wine-dark text-white rounded py-2 text-sm transition-colors"
          >
            Создать тему
          </Link>
        </div>
      </aside>
    </main>
  )
}