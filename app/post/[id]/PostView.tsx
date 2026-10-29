// app/post/[id]/PostView.tsx
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
// Сессия теперь в куках (см. lib/supabase/client.ts), поэтому лайки, комменты
// и проверка авторства видят того же пользователя, что и сервер.
import { supabase } from '@/lib/supabase/client'
import { formatPostContent } from '@/lib/format'
import Comments from '@/app/components/Comments'
import LikeButton from '@/app/components/LikeButton'
import BookmarkButton from '@/app/components/BookmarkButton'
import ReportButton from '@/app/components/ReportButton'
import ViewCounter from '@/app/components/ViewCounter'
import {
  ChevronLeft,
  Pencil,
  Trash2,
  Eye,
  BookOpen,
  Share2,
  Check,
} from '@/app/components/icons'
import type { PostDetail } from './getPost'

export default function PostView({ post }: { post: PostDetail }) {
  const router = useRouter()

  // Данные поста пришли с сервера, а «кто я» знает только браузер (сессия Supabase),
  // поэтому автора/модератора определяем на клиенте.
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [isStaff, setIsStaff] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    let alive = true

    async function loadViewer() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!alive) return
      setCurrentUser(user)
      if (!user) return

      const { data } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle()

      if (!alive) return
      const profile = data as { role: string | null } | null
      setIsStaff(profile?.role === 'admin' || profile?.role === 'moderator')
    }

    loadViewer()
    return () => {
      alive = false
    }
  }, [])

  const isAuthor = currentUser !== null && currentUser.id === post.user_id

  // Формат фиксирован по часовому поясу: сервер (UTC) и браузер (МСК)
  // иначе могут отдать разные даты и React ругнётся на рассинхрон гидратации.
  const createdAtLabel = post.created_at
    ? new Intl.DateTimeFormat('ru-RU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'Europe/Moscow',
      }).format(new Date(post.created_at))
    : ''

  const backHref =
    post.type === 'news'
      ? '/news'
      : post.type === 'creative'
      ? '/creative'
      : '/discussions'

  async function handleDelete() {
    if (!confirm('Удалить этот пост? Действие нельзя отменить.')) return
    setDeleting(true)

    await supabase.from('post_images').delete().eq('post_id', post.id)
    await supabase.from('comments').delete().eq('post_id', post.id)
    await supabase.from('likes').delete().eq('post_id', post.id)
    await supabase.from('reports').delete().eq('post_id', post.id)

    const { error } = await supabase.from('posts').delete().eq('id', post.id)

    if (error) {
      alert('Ошибка удаления: ' + error.message)
      setDeleting(false)
      return
    }

    router.push('/news')
    router.refresh()
  }

  const [cover, ...extraImages] = post.post_images

  return (
    <main className="p-4 md:p-8 max-w-4xl mx-auto">
      <Link
        href={backHref}
        className="flex items-center gap-1 text-sm text-brown/70 hover:text-wine mb-4 transition-colors"
      >
        <ChevronLeft size={15} strokeWidth={2} />
        <span>Назад</span>
      </Link>

      {/* Учёт просмотра: один раз за сессию (см. sessionStorage внутри) */}
      <ViewCounter postId={post.id} />

      <article className="bg-cream-warm/30 border border-emerald-dark/10 rounded-2xl overflow-hidden">
        {cover && (
          <div className="relative w-full aspect-[16/10] overflow-hidden">
            <img
              src={cover.url}
              alt={post.title}
              className="absolute inset-0 w-full h-full object-cover object-top"
            />
          </div>
        )}

        <div className="p-6 md:p-8">
          {(isAuthor || isStaff) && (
            <div className="flex gap-3 justify-end mb-3">
              {isAuthor && (
                <Link
                  href={`/post/${post.id}/edit`}
                  className="flex items-center gap-1.5 text-sm text-brown/70 hover:text-emerald-mid transition-colors"
                >
                  <Pencil size={14} strokeWidth={1.8} />
                  <span>Редактировать</span>
                </Link>
              )}
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex items-center gap-1.5 text-sm text-brown/70 hover:text-wine transition-colors disabled:opacity-50"
              >
                <Trash2 size={14} strokeWidth={1.8} />
                <span>{deleting ? 'Удаляем…' : 'Удалить'}</span>
              </button>
            </div>
          )}

          {post.status === 'pending' && (
            <div className="mb-3">
              <span className="text-xs bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full">
                На проверке модератором
              </span>
            </div>
          )}

          {post.books && (
            <Link
              href={`/book/${post.books.id}`}
              className="inline-flex items-center gap-2 bg-cream-warm/50 hover:bg-cream-warm border border-emerald-dark/10 rounded-full px-3 py-1.5 text-xs text-brown-dark hover:text-wine transition-colors mb-3"
            >
              <BookOpen size={13} strokeWidth={1.8} className="text-emerald-mid" />
              <span className="font-medium">{post.books.title}</span>
              {post.books.author && (
                <>
                  <span className="text-brown/40">·</span>
                  <span className="text-brown/60">{post.books.author}</span>
                </>
              )}
              {post.books.year && (
                <>
                  <span className="text-brown/40">·</span>
                  <span className="text-brown/60">{post.books.year}</span>
                </>
              )}
            </Link>
          )}

          <h1 className="font-playfair text-2xl md:text-4xl font-bold text-emerald-dark mb-4 leading-tight">
            {post.title}
          </h1>

          <div className="flex items-center gap-3 text-sm text-brown/60 mb-6 pb-6 border-b border-emerald-dark/10 flex-wrap">
            <Link
              href={
                post.profiles?.username
                  ? `/profile/${post.profiles.username}`
                  : '#'
              }
              className="flex items-center gap-3 hover:text-wine transition-colors"
            >
              {post.profiles?.avatar_url ? (
                <img
                  src={post.profiles.avatar_url}
                  alt=""
                  className="w-8 h-8 rounded-full object-cover"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-emerald-mid text-cream flex items-center justify-center text-sm font-bold">
                  {(post.profiles?.username || '?')[0].toUpperCase()}
                </div>
              )}
              <span className="font-medium text-brown-dark">
                {post.profiles?.username || 'Аноним'}
              </span>
            </Link>

            <span className="text-brown/30">·</span>
            <span>{createdAtLabel}</span>

            <span className="ml-auto flex items-center gap-3">
              <span className="flex items-center gap-1 text-xs text-brown/50">
                <Eye size={13} strokeWidth={1.8} />
                <span>{post.views_count ?? 0}</span>
              </span>
              <LikeButton postId={post.id} />
              <BookmarkButton postId={post.id} />
              <ShareButton title={post.title} />
              {!isAuthor && <ReportButton postId={post.id} />}
            </span>
          </div>

          <div className="post-content mb-6">
            {formatPostContent(post.content || '')}
          </div>

          {extraImages.length > 0 && (
            <div className="flex flex-col gap-4 mt-6">
              {extraImages.map((img) => (
                <img
                  key={img.url}
                  src={img.url}
                  alt=""
                  className="rounded-lg border border-emerald-dark/10 w-full"
                />
              ))}
            </div>
          )}

          <Comments postId={post.id} />
        </div>
      </article>
    </main>
  )
}

/* ------------------------------------------------------------------ */
/* Кнопка «Поделиться»: системный шер-шит на телефоне, иначе копия URL  */
/* ------------------------------------------------------------------ */

function ShareButton({ title }: { title: string }) {
  const [copied, setCopied] = useState(false)

  async function handleClick() {
    const url = window.location.href

    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, url })
        return
      } catch {
        // пользователь закрыл шер-шит — пробуем скопировать ссылку
      }
    }

    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt('Скопируйте ссылку:', url)
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      title="Поделиться постом"
      className="flex items-center gap-1 text-xs text-brown/50 hover:text-wine transition-colors"
    >
      {copied ? (
        <Check size={13} strokeWidth={1.8} />
      ) : (
        <Share2 size={13} strokeWidth={1.8} />
      )}
      <span>{copied ? 'Скопировано' : 'Поделиться'}</span>
    </button>
  )
}
