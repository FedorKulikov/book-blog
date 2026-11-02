'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { humanizeError } from '@/lib/errors'
import ImageUploader from '@/app/components/ImageUploader'
import BookSelect from '@/app/components/BookSelect'
import type { PostDetail } from '../getPost'

/**
 * Ошибки прилетают из триггеров БД (стоп-слова, бан) и из RLS.
 * Тексты RAISE EXCEPTION уже человекочитаемые, остальное переводим сами.
 */
function explainUpdateError(message: string): string {
  const lower = message.toLowerCase()

  if (lower.includes('заблокирован') || lower.includes('забанен')) {
    return 'Ваш аккаунт заблокирован — редактирование недоступно.'
  }

  if (lower.includes('стоп-слов')) {
    return message
  }

  if (
    lower.includes('row-level security') ||
    lower.includes('permission denied') ||
    lower.includes('policy')
  ) {
    return 'Нет прав на редактирование этого поста.'
  }

  return humanizeError(message)
}

type RawTagRow = {
  tags: { name: string | null } | { name: string | null }[] | null
}

export default function EditPostForm({ post }: { post: PostDetail }) {
  const router = useRouter()

  const [title, setTitle] = useState(post.title)
  const [content, setContent] = useState(post.content ?? '')
  const [type, setType] = useState(post.type)
  const [bookId, setBookId] = useState<string | null>(post.books?.id ?? null)
  const [tagsInput, setTagsInput] = useState('')
  const [newImages, setNewImages] = useState<string[]>([])

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // getPost() не возвращает теги — подтягиваем их отдельным запросом,
  // чтобы поле «Теги» было заполнено текущими значениями.
  useEffect(() => {
    let alive = true

    void (async () => {
      const { data, error: tagsError } = await supabase
        .from('post_tags')
        .select('tags(name)')
        .eq('post_id', post.id)

      if (!alive || tagsError) return

      const names = ((data ?? []) as unknown as RawTagRow[])
        .map(row => (Array.isArray(row.tags) ? row.tags[0]?.name : row.tags?.name))
        .filter((n): n is string => typeof n === 'string' && n.trim().length > 0)

      setTagsInput(names.join(', '))
    })()

    return () => {
      alive = false
    }
  }, [post.id])

  /** Находит тег по slug или создаёт новый и привязывает к посту */
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

      let tagId = existing?.id as string | undefined

      if (!tagId) {
        const { data: created } = await supabase
          .from('tags')
          .insert({ name, slug })
          .select('id')
          .single()
        tagId = (created as { id: string } | null)?.id
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

    setLoading(true)
    setError(null)

    // status НЕ отправляем: его охраняет триггер posts_guard_status_update.
    const { error: updateError } = await supabase
      .from('posts')
      .update({
        title: cleanTitle,
        content: cleanContent,
        type,
        book_id: bookId,
      })
      .eq('id', post.id)

    if (updateError) {
      console.error('[edit-post] update failed:', updateError.message)
      setError(explainUpdateError(updateError.message))
      setLoading(false)
      return
    }

    // Теги пересобираем полностью: старые связи удаляем, новые создаём
    const tagNames = tagsInput
      .split(',')
      .map(t => t.trim())
      .filter(Boolean)

    const { error: clearTagsError } = await supabase
      .from('post_tags')
      .delete()
      .eq('post_id', post.id)

    if (clearTagsError) {
      console.error('[edit-post] clear tags failed:', clearTagsError.message)
    }
    if (tagNames.length > 0) {
      await saveTagsForPost(post.id, tagNames)
    }

    // Фото заменяем только если загрузили новые — иначе оставляем прежние
    if (newImages.length > 0) {
      const { error: clearImagesError } = await supabase
        .from('post_images')
        .delete()
        .eq('post_id', post.id)

      if (clearImagesError) {
        console.error('[edit-post] clear images failed:', clearImagesError.message)
      }

      const rows = newImages.map((url, i) => ({
        post_id: post.id,
        url,
        sort_order: i,
      }))

      const { error: imgError } = await supabase.from('post_images').insert(rows)

      if (imgError) {
        setError(
          'Пост обновлён, но фото не привязались: ' +
            humanizeError(imgError.message),
        )
        setLoading(false)
        return
      }
    }

    router.push(`/post/${post.id}`)
    router.refresh()
  }

  return (
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
          rows={10}
          className="w-full border border-emerald-dark/15 rounded-lg px-3 py-2 bg-cream-warm/40 font-sans focus:outline-none focus:border-emerald-mid"
        />
        <p className="text-xs text-brown/50 mt-1">
          Форматирование: **жирный**, *курсив*, [spoil]спойлер[/spoil].
          Ссылки вставляются автоматически.
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

      <div>
        <ImageUploader onUploaded={setNewImages} />
        <p className="text-xs text-brown/55 mt-1">
          {post.post_images.length > 0
            ? 'Новые фото заменят текущие. Если ничего не выбирать — останутся прежние.'
            : 'Если ничего не выбирать, пост останется без фото.'}
        </p>
      </div>

      {error && <p className="text-wine text-sm">Ошибка: {error}</p>}

      <div className="flex flex-col sm:flex-row gap-3">
        <button
          type="submit"
          disabled={loading}
          className="flex-1 bg-wine text-white py-2.5 rounded-full hover:bg-wine-dark disabled:opacity-50 transition-colors"
        >
          {loading ? 'Сохраняем…' : 'Сохранить изменения'}
        </button>
        <button
          type="button"
          onClick={() => router.push(`/post/${post.id}`)}
          disabled={loading}
          className="flex-1 bg-cream-warm border border-emerald-dark/15 text-brown-dark py-2.5 rounded-full hover:bg-cream disabled:opacity-50 transition-colors"
        >
          Отмена
        </button>
      </div>
    </form>
  )
}
