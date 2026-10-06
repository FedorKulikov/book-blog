'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import ImageUploader from '../../components/ImageUploader'
import BookSelect from '../../components/BookSelect'
import { findBadWord } from '@/lib/moderation'
import { humanizeError } from '@/lib/errors'
import { ChevronLeft } from '../../components/icons'

function NewPostContent() {
  const searchParams = useSearchParams()
  const preselectedBookId = searchParams.get('book')

  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [type, setType] = useState('news')
  const [tagsInput, setTagsInput] = useState('')
  const [bookId, setBookId] = useState<string | null>(preselectedBookId)
  const [images, setImages] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [user, setUser] = useState<any>(null)
  const [profile, setProfile] = useState<any>(null)
  const router = useRouter()

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) {
        router.push('/login')
        return
      }
      setUser(data.user)

      const { data: p } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', data.user.id)
        .single()
      setProfile(p)

      if (p?.is_banned) {
        setError('Ваш аккаунт заблокирован. Вы не можете публиковать посты.')
      }
    })
  }, [router])

  async function saveTagsForPost(postId: string, tagNames: string[]) {
    for (const rawName of tagNames) {
      const name = rawName.trim()
      if (!name) continue
      const slug = name
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-zа-яё0-9-]/gi, '')

      if (!slug) continue

      const { data: existing } = await supabase
        .from('tags')
        .select('id')
        .eq('slug', slug)
        .maybeSingle()

      let tagId = existing?.id

      if (!tagId) {
        const { data: created } = await supabase
          .from('tags')
          .insert({ name, slug })
          .select()
          .single()
        tagId = created?.id
      }

      if (tagId) {
        await supabase
          .from('post_tags')
          .insert({ post_id: postId, tag_id: tagId })
      }
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return

    if (profile?.is_banned) {
      setError('Ваш аккаунт заблокирован.')
      return
    }

    // Rate limit
    const { data: limitCheck } = await supabase.rpc('check_and_log_action', {
      action_input: 'post',
      max_per_hour: 10,
      max_per_minute: 3,
    })

    if (limitCheck && !limitCheck.ok) {
      if (limitCheck.reason === 'minute_limit') {
        setError('Слишком быстро. Подождите минуту перед следующим постом.')
      } else if (limitCheck.reason === 'hour_limit') {
        setError('Достигнут лимит постов на час (10). Попробуйте позже.')
      } else {
        setError('Войдите в аккаунт.')
      }
      return
    }

    setLoading(true)
    setError(null)

    const badWordTitle = await findBadWord(title)
    const badWordContent = await findBadWord(content)

    if (badWordTitle || badWordContent) {
      setError('В тексте есть недопустимые слова. Пожалуйста, переформулируйте.')
      setLoading(false)
      return
    }

    const { count } = await supabase
      .from('posts')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)

    const isNewbie = (count || 0) < 3
    const status = isNewbie && profile?.role !== 'admin' ? 'pending' : 'approved'

    const { data: post, error: insertError } = await supabase
      .from('posts')
      .insert({ user_id: user.id, title, content, type, status, book_id: bookId })
      .select()
      .single()

    if (insertError) {
      setError(humanizeError(insertError.message))
      setLoading(false)
      return
    }

    const tagNames = tagsInput
      .split(',')
      .map(t => t.trim())
      .filter(Boolean)
    if (tagNames.length > 0) {
      await saveTagsForPost(post.id, tagNames)
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
        setError('Пост создан, но фото не привязались. ' + humanizeError(imgError.message))
        setLoading(false)
        return
      }
    }

    if (status === 'pending') {
      alert('Пост отправлен на проверку модератору.')
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
    <main className="p-4 md:p-8 max-w-2xl mx-auto">
      <Link
        href="/news"
        className="flex items-center gap-1 text-sm text-brown/70 hover:text-wine mb-6 transition-colors"
      >
        <ChevronLeft size={15} strokeWidth={2} />
        <span>Назад</span>
      </Link>

      <h1 className="font-playfair text-2xl md:text-3xl font-bold text-emerald-dark mb-8">
        Новый пост
      </h1>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-sm font-medium mb-1 text-brown-dark">
            Тип
          </label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="w-full border border-emerald-dark/15 rounded-lg px-3 py-2 bg-cream-warm/40 focus:outline-none focus:border-emerald-mid"
          >
            <option value="news">Книжная новинка</option>
            <option value="creative">Творчество</option>
            <option value="discussion">Обсуждение</option>
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
            className="w-full border border-emerald-dark/15 rounded-lg px-3 py-2 bg-cream-warm/40 focus:outline-none focus:border-emerald-mid"
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
            className="w-full border border-emerald-dark/15 rounded-lg px-3 py-2 bg-cream-warm/40 font-sans focus:outline-none focus:border-emerald-mid"
            placeholder="Поделись мыслями…"
          />
          <p className="text-xs text-brown/50 mt-1">
            Форматирование: **жирный**, *курсив*, [spoil]спойлер[/spoil]. Ссылки вставляются автоматически.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1 text-brown-dark">
            Теги
          </label>
          <input
            type="text"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            className="w-full border border-emerald-dark/15 rounded-lg px-3 py-2 bg-cream-warm/40 focus:outline-none focus:border-emerald-mid"
            placeholder="фэнтези, классика, романтика"
          />
          <p className="text-xs text-brown/55 mt-1">
            Через запятую. Существующие и новые теги поддерживаются.
          </p>
        </div>

        <BookSelect value={bookId} onChange={setBookId} />

        <ImageUploader onUploaded={setImages} />

        {error && <p className="text-wine text-sm">Ошибка: {error}</p>}

        <button
          type="submit"
          disabled={loading || !user || !!profile?.is_banned}
          className="w-full bg-wine text-white py-2.5 rounded-full hover:bg-wine-dark disabled:opacity-50 transition-colors"
        >
          {loading ? 'Публикуем…' : 'Опубликовать'}
        </button>
      </form>
    </main>
  )
}

export default function NewPostPage() {
  return (
    <Suspense
      fallback={<main className="p-8 max-w-2xl mx-auto">Загрузка…</main>}
    >
      <NewPostContent />
    </Suspense>
  )
}