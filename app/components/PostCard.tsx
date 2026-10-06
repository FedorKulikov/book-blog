'use client'

import Link from 'next/link'
import LikeButton from './LikeButton'
import { MessageCircle, Hash, BookOpen, Eye } from './icons'

type Post = {
  id: string
  title: string
  content: string
  type: string
  status?: string
  created_at: string
  views_count?: number
  profiles?: { username: string; avatar_url?: string | null } | null
  post_images?: { url: string }[] | null
  comments?: { count: number }[] | null
  post_tags?: { tags: { name: string; slug: string } | null }[] | null
  books?: { id: string; title: string; author: string | null; year: number | null } | null
}

const TYPE_LABEL: Record<string, { text: string; color: string }> = {
  news: { text: 'Новинка', color: 'bg-wine/8 text-wine' },
  creative: { text: 'Творчество', color: 'bg-emerald-mid/8 text-emerald-mid' },
  discussion: { text: 'Обсуждение', color: 'bg-brown/8 text-brown' },
}

export default function PostCard({ post }: { post: Post }) {
  const cover = post.post_images?.[0]?.url
  const type = TYPE_LABEL[post.type] || TYPE_LABEL.news
  const commentsCount = post.comments?.[0]?.count ?? 0
  const tags = (post.post_tags || [])
    .map(pt => pt.tags)
    .filter((t): t is { name: string; slug: string } => !!t)
    .slice(0, 3)

  return (
    <article className="bg-cream-warm/25 border border-emerald-dark/8 rounded-2xl overflow-hidden hover:border-emerald-dark/20 transition-colors group flex flex-col">
      <Link
        href={`/post/${post.id}`}
        className="block relative aspect-[16/10]"
      >
        {cover ? (
          <img
            src={cover}
            alt={post.title}
            className="absolute inset-0 w-full h-full object-cover group-hover:opacity-95 transition-opacity"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-mid/6 to-cream-warm/50 flex items-center justify-center">
            <BookOpen
              size={44}
              strokeWidth={1.2}
              className="text-emerald-mid/25"
            />
          </div>
        )}
        <span
          className={`absolute top-3 left-3 text-[10px] uppercase tracking-widest px-2.5 py-1 rounded-full backdrop-blur-sm ${type.color} bg-cream/85`}
        >
          {type.text}
        </span>
        {post.status === 'pending' && (
          <span className="absolute top-3 right-3 text-[10px] uppercase tracking-widest px-2.5 py-1 rounded-full bg-yellow-100/95 text-yellow-800">
            На проверке
          </span>
        )}
      </Link>

      <div className="p-5 flex flex-col flex-1">
        <Link href={`/post/${post.id}`}>
          <h3 className="font-playfair text-lg md:text-xl font-bold text-emerald-dark mb-2 leading-snug hover:text-wine transition-colors line-clamp-2">
            {post.title}
          </h3>
        </Link>

        {post.books && (
          <Link
            href={`/book/${post.books.id}`}
            className="inline-flex items-center gap-1.5 text-[11px] text-emerald-mid hover:text-wine transition-colors mb-2"
            onClick={(e) => e.stopPropagation()}
          >
            <BookOpen size={11} strokeWidth={1.8} />
            <span>{post.books.title}</span>
            {post.books.author && (
              <>
                <span className="text-brown/30">·</span>
                <span className="text-brown/50">{post.books.author}</span>
              </>
            )}
          </Link>
        )}

        <p className="text-brown-dark/65 text-sm line-clamp-3 mb-3 flex-1 leading-relaxed">
          {post.content}
        </p>

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {tags.map(t => (
              <Link
                key={t.slug}
                href={`/tag/${t.slug}`}
                className="flex items-center gap-0.5 text-[11px] text-brown/45 hover:text-emerald-mid transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                <Hash size={10} strokeWidth={2} />
                <span>{t.name}</span>
              </Link>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 text-xs text-brown/50 border-t border-emerald-dark/6 pt-3 mt-auto">
          <Link
            href={
              post.profiles?.username
                ? `/profile/${post.profiles.username}`
                : '#'
            }
            className="flex items-center gap-2 hover:text-wine transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            {post.profiles?.avatar_url ? (
              <img
                src={post.profiles.avatar_url}
                alt=""
                className="w-5 h-5 rounded-full object-cover"
              />
            ) : (
              <div className="w-5 h-5 rounded-full bg-emerald-mid text-cream flex items-center justify-center text-[10px] font-bold">
                {(post.profiles?.username || '?')[0].toUpperCase()}
              </div>
            )}
            <span className="font-medium text-brown-dark text-[11px]">
              {post.profiles?.username || 'Аноним'}
            </span>
          </Link>
          <span className="text-brown/20">·</span>
          <span className="text-[11px]">
            {new Date(post.created_at).toLocaleString('ru-RU', {
              day: 'numeric',
              month: 'short',
            })}
          </span>

          <span className="ml-auto flex items-center gap-3">
            <span className="flex items-center gap-1">
              <Eye size={12} strokeWidth={1.8} />
              <span>{post.views_count ?? 0}</span>
            </span>
            <span className="flex items-center gap-1">
              <MessageCircle size={12} strokeWidth={1.8} />
              <span>{commentsCount}</span>
            </span>
            <LikeButton postId={post.id} />
          </span>
        </div>
      </div>
    </article>
  )
}