'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import ImageUploader from '../../components/ImageUploader'

export default function NewPostPage() {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [type, setType] = useState('news')
  const [images, setImages] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [user, setUser] = useState<any>(null)
  const router = useRouter()

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        router.push('/login')
      } else {
        setUser(data.user)
      }
    })
  }, [router])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return

    setLoading(true)
    setError(null)

    const { data: post, error: insertError } = await supabase
      .from('posts')
      .insert({ user_id: user.id, title, content, type })
      .select()
      .single()

    if (insertError) {
      setError(insertError.message)
      setLoading(false)
      return
    }

    if (images.length > 0) {
      const rows = images.map((url, i) => ({
        post_id: post.id,
        url,
        sort_order: i,
      }))
      const { error: imgError } = await supabase
        .from('post_images')
        .insert(rows)
      if (imgError) {
        setError('Пост создан, но фото не привязались: ' + imgError.message)
        setLoading(false)
        return
      }
    }

    router.push(
      type === 'news'
        ? '/news'
        : type === 'creative'
        ? '/creative'
        : '/discussions'
    )
    router.refresh()
  }

  return (
    <main className="p-8 max-w-2xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-emerald-dark">✍️ Новый пост</h1>
        <Link href="/news" className="text-sm text-brown/70 hover:text-wine">
          ← Назад
        </Link>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1 text-brown-dark">
            Тип
          </label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="w-full border border-emerald-dark/20 rounded px-3 py-2 bg-cream-warm/50"
          >
            <option value="news">📚 Книжная новинка</option>
            <option value="creative">✍️ Творчество</option>
            <option value="discussion">💬 Обсуждение</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1 text-brown-dark">
            Заголовок
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={200}
            className="w-full border border-emerald-dark/20 rounded px-3 py-2 bg-cream-warm/50"
            placeholder="Например: Обзор книги «Мастер и Маргарита»"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1 text-brown-dark">
            Текст
          </label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            required
            rows={8}
            className="w-full border border-emerald-dark/20 rounded px-3 py-2 bg-cream-warm/50 font-sans"
            placeholder="Поделись мыслями…"
          />
        </div>

        <ImageUploader onUploaded={setImages} />

        {error && <p className="text-wine text-sm">Ошибка: {error}</p>}

        <button
          type="submit"
          disabled={loading || !user}
          className="w-full bg-wine text-white py-2 rounded hover:bg-wine-dark disabled:opacity-50 transition-colors"
        >
          {loading ? 'Публикуем…' : 'Опубликовать'}
        </button>
      </form>
    </main>
  )
}