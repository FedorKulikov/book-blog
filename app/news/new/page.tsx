'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import ImageUploader from '../../components/ImageUploader'
import BookSelect from '../../components/BookSelect'
import { humanizeError } from '@/lib/errors'
import { ChevronLeft } from '../../components/icons'

/**
 * Ошибки приходят из триггера БД (public.posts_before_insert).
 * Тексты RAISE EXCEPTION уже человекочитаемые, но на всякий случай
 * ловим ключевые слова — вдруг PostgREST добавит префикс.
 */
function explainInsertError(message: string): string {
  const lower = message.toLowerCase()

  if (lower.includes('заблокирован') || lower.includes('забанен')) {
    return 'Ваш аккаунт заблокирован — публикация постов недоступна.'
  }

  if (lower.includes('стоп-слов')) {
    return message
  }

  return humanizeError(message)
}

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
  // Профиль больше не грузим: бан, стоп-слова и статус проверяет БД (триггер).
  // Здесь нужен только факт авторизации.
  const [user, setUser] = useState<User | null>(null)
  const router = useRouter()

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        router.push('/login')
        return
      }
      setUser(data.user)
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

    // Единственное, что остаётся на клиенте, — валидация полей.
    const cleanTitle = title.trim()
    const cleanContent = content.trim()

    if (cleanTitle.length < 3) {
      setError('Заголовок — минимум 3 символа.')
      return
    }
    if (cleanContent.length < 10) {
      setError('Текст поста — минимум 10 символов.')
      return
    }

    // Rate limit: это RPC в БД, из консоли его не обойти
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

    // status НЕ передаём: его выставляет триггер posts_before_insert
    // (бан → отказ, стоп-слово → отказ, staff/доверенный автор → approved).
    const { data: created, error: insertError } = await supabase
      .from('posts')
      .insert({
        user_id: user.id,
        title: cleanTitle,
        content: cleanContent,
        type,
        book_id: bookId,
      })
      .select('id, status')
      .single()

    if (insertError) {
      console.error('[new-post] insert failed:', insertError.message)
      setError(explainInsertError(insertError.message))
      setLoading(false)
      return
    }

    const post = created as unknown as { id: string; status: string }

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

    // Статус вернула база — показываем честный результат
    if (post.status === 'pending') {
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
          disabled={loading || !user}
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
