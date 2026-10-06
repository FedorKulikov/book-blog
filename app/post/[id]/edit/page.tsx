'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { formatPostContent } from '@/lib/format'
import Comments from '@/app/components/Comments'
import LikeButton from '@/app/components/LikeButton'
import ReportButton from '@/app/components/ReportButton'
import ViewCounter from '@/app/components/ViewCounter'
import { ChevronLeft, Pencil, Trash2, Eye } from '@/app/components/icons'

export default function PostPage() {
  const params = useParams()
  const id = params.id as string
  const router = useRouter()

  const [post, setPost] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      setCurrentUser(user)

      const { data, error } = await supabase
        .from('posts')
        .select('*, profiles!posts_user_id_fkey(username, avatar_url), post_images(url), books(id, title, author, year)')
        .eq('id', id)
        .single()

      if (error || !data) {
        setNotFound(true)
      } else {
        setPost(data)
      }
      setLoading(false)
    }
    load()
  }, [id])

  async function handleDelete() {
    if (!confirm('Удалить этот пост? Действие нельзя отменить.')) return
    setDeleting(true)

    await supabase.from('post_images').delete().eq('post_id', id)
    await supabase.from('comments').delete().eq('post_id', id)
    await supabase.from('likes').delete().eq('post_id', id)
    await supabase.from('reports').delete().eq('post_id', id)

    const { error } = await supabase.from('posts').delete().eq('id', id)

    if (error) {
      alert('Ошибка удаления: ' + error.message)
      setDeleting(false)
      return
    }

    router.push('/news')
    router.refresh()
  }

  if (loading) {
    return <main className="p-4 md:p-8 max-w-4xl mx-auto">Загрузка…</main>
  }

  if (notFound || !post) {
    return (
      <main className="p-4 md:p-8 max-w-4xl mx-auto">
        <p className="text-wine">Пост не найден.</p>
        <Link
          href="/"
          className="text-wine hover:underline text-sm mt-3 inline-block"
        >
          ← На главную
        </Link>
      </main>
    )
  }

  const isAuthor = currentUser && currentUser.id === post.user_id

  return (
    <main className="p-4 md:p-8 max-w-4xl mx-auto">
      <ViewCounter postId={post.id} />

      <Link
        href={
          post.type === 'news'
            ? '/news'
            : post.type === 'creative'
            ? '/creative'
            : '/discussions'
        }
        className="flex items-center gap-1 text-sm text-brown/70 hover:text-wine mb-4 transition-colors"
      >
        <ChevronLeft size={15} strokeWidth={2} />
        <span>Назад</span>
      </Link>

      <article className="bg-cream-warm/30 border border-emerald-dark/10 rounded-2xl overflow-hidden">
        {post.post_images && post.post_images.length > 0 && (
          <img
            src={post.post_images[0].url}
            alt={post.title}
            className="w-full max-h-96 object-cover"
          />
        )}

        <div className="p-6 md:p-8">
          {isAuthor && (
            <div className="flex gap-3 justify-end mb-3">
              <Link
                href={`/post/${post.id}/edit`}
                className="flex items-center gap-1.5 text-sm text-brown/70 hover:text-emerald-mid transition-colors"
              >
                <Pencil size={14} strokeWidth={1.8} />
                <span>Редактировать</span>
              </Link>
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

          <h1 className="font-playfair text-3xl md:text-4xl font-bold text-emerald-dark mb-4 leading-tight">
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
            <span>
              {new Date(post.created_at).toLocaleString('ru-RU', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </span>

            <span className="ml-auto flex items-center gap-3">
              <span className="flex items-center gap-1 text-xs text-brown/50">
                <Eye size={13} strokeWidth={1.8} />
                <span>{post.views_count ?? 0}</span>
              </span>
              <LikeButton postId={post.id} />
              {!isAuthor && <ReportButton postId={post.id} />}
            </span>
          </div>

          <div className="post-content mb-6">
            {formatPostContent(post.content || '')}
          </div>

          {post.post_images && post.post_images.length > 1 && (
            <div className="flex flex-col gap-4 mt-6">
              {post.post_images.slice(1).map((img: any, i: number) => (
                <img
                  key={i}
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