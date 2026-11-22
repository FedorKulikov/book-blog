'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import ImageUploader from '../../components/ImageUploader'
import BookSelect from '../../components/BookSelect'
import NewsFields, {
  SOURCE_URL_RE,
  deadlineDateToIso,
  hasDeadline,
} from '../../components/NewsFields'
import type { NewsCategory } from '../newsQuery'
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
  const [imagesUploading, setImagesUploading] = useState(false)
  const [distributionConsent, setDistributionConsent] = useState(false)
  // Поля новостного портала (актуальны только для type === 'news')
  const [newsCategory, setNewsCategory] = useState<NewsCategory>('news')
  const [deadline, setDeadline] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Профиль больше не грузим: бан, стоп-слова и статус проверяет БД (триггер).
  // Здесь нужен только факт авторизации.
  const [user, setUser] = useState<User | null>(null)
  const router = useRouter()

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        const currentPath = `${window.location.pathname}${window.location.search}`
        router.push(`/login?next=${encodeURIComponent(currentPath)}`)
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

    // Поля портала проверяем только для новостей: у творчества/обсуждений их нет
    const cleanSourceUrl = sourceUrl.trim()
    const needsDeadline = hasDeadline(newsCategory)

    if (type === 'news' && cleanSourceUrl && !SOURCE_URL_RE.test(cleanSourceUrl)) {
      setError('Ссылка на источник должна начинаться с http:// или https://')
      return
    }

    if (type === 'news' && needsDeadline && !deadline) {
      setError('Укажите дату дедлайна — без неё карточка конкурса неинформативна.')
      return
    }

    setLoading(true)
    setError(null)

    // Создание публикации и фиксация согласия выполняются серверным маршрутом.
    // Маршрут повторно проверяет сессию, данные формы и checkbox; user_id из
    // браузера не передаётся и не используется.
    try {
      const response = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: cleanTitle,
          content: cleanContent,
          type,
          bookId,
          newsCategory,
          deadlineAt: type === 'news' && needsDeadline ? deadlineDateToIso(deadline) : null,
          sourceUrl: type === 'news' && cleanSourceUrl ? cleanSourceUrl : null,
          distributionConsent,
        }),
      })

      const result = (await response.json()) as {
        error?: string
        post?: { id: string; status: string }
      }

      if (!response.ok || !result.post?.id) {
        setError(result.error ?? 'Не удалось создать публикацию.')
        setLoading(false)
        return
      }

      const post = result.post

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
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ошибка сети'
      console.error('[new-post] request failed:', message)
      setError('Не удалось отправить публикацию. Проверьте соединение и попробуйте ещё раз.')
      setLoading(false)
    }

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
          <label
            htmlFor="news-type"
            className="block text-sm font-medium mb-1 text-brown-dark"
          >
            Тип
          </label>
          <select
            id="news-type"
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="w-full border border-emerald-dark/15 rounded-lg px-3 py-2 bg-cream-warm/40 focus:outline-none focus:border-emerald-mid"
          >
            <option value="news">Книжная новинка</option>
            <option value="creative">Творчество</option>
            <option value="discussion">Обсуждение</option>
          </select>
        </div>

        {type === 'news' && (
          <NewsFields
            category={newsCategory}
            onCategoryChange={setNewsCategory}
            deadline={deadline}
            onDeadlineChange={setDeadline}
            sourceUrl={sourceUrl}
            onSourceUrlChange={setSourceUrl}
          />
        )}

        <div>
          <label
            htmlFor="news-title"
            className="block text-sm font-medium mb-1 text-brown-dark"
          >
            Заголовок
          </label>
          <input
            id="news-title"
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
          <label
            htmlFor="news-content"
            className="block text-sm font-medium mb-1 text-brown-dark"
          >
            Текст
          </label>
          <textarea
            id="news-content"
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
          <label
            htmlFor="news-tags"
            className="block text-sm font-medium mb-1 text-brown-dark"
          >
            Теги
          </label>
          <input
            id="news-tags"
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

        <div className="rounded-xl border border-emerald-dark/15 bg-cream-warm/20 p-4">
          <div className="flex items-start gap-3">
            <input
              id="distribution-consent"
              type="checkbox"
              checked={distributionConsent}
              onChange={(event) => setDistributionConsent(event.target.checked)}
              disabled={loading || imagesUploading || images.length > 0}
              className="mt-1 h-4 w-4 accent-wine disabled:opacity-50"
            />
            <label htmlFor="distribution-consent" className="text-sm leading-relaxed text-brown-dark">
              Я отдельно соглашаюсь на распространение персональных данных,
              указанных в этой публикации, среди посетителей сайта и в интернете.
              {' '}
              <Link
                href="/consent-distribution"
                target="_blank"
                rel="noopener noreferrer"
                className="text-wine underline hover:text-wine-dark"
              >
                Какие данные будут доступны и как отозвать согласие
              </Link>
              .
            </label>
          </div>
          {images.length > 0 && (
            <p className="mt-2 text-xs text-brown/60">
              Чтобы снять согласие, сначала удалите все прикреплённые фотографии кнопкой «×». Пока фото загружены в публичное хранилище, пункт согласия нельзя снять.
            </p>
          )}
        </div>

        <ImageUploader
          onUploaded={setImages}
          onUploadingChange={setImagesUploading}
          enabled={distributionConsent && !loading}
        />

        {error && <p className="text-wine text-sm">Ошибка: {error}</p>}

        <button
          type="submit"
          disabled={loading || !user || imagesUploading}
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
