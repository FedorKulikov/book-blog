'use client'

import Link from 'next/link'
import LikeButton from './LikeButton'
import BookmarkButton from './BookmarkButton'
import { MessageCircle, Hash, BookOpen, Eye } from './icons'
import { toPlainText } from '@/lib/text'

export type PostCardData = {
  id: string
  title: string
  content: string
  type: string
  status?: string
  created_at: string
  views_count?: number | null
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

/**
 * Фиксированная таймзона обязательна: PostCard рендерится и на сервере (SSR),
 * и в браузере. Без timeZone сервер (UTC) и клиент (Москва) дают разные строки —
 * именно из-за этого React ругался «Hydration failed» (minified error #418).
 */
const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  timeZone: 'Europe/Moscow',
})

export default function PostCard({ post }: { post: PostCardData }) {
  const cover = post.post_images?.[0]?.url
  const type = TYPE_LABEL[post.type] || TYPE_LABEL.news
  const commentsCount = post.comments?.[0]?.count ?? 0
  const viewsCount = post.views_count ?? 0
  const tags = (post.post_tags || [])
    .map(pt => pt.tags)
    .filter((t): t is { name: string; slug: string } => !!t)
    .slice(0, 3)

  return (
    <article className="bg-cream-warm/25 border border-emerald-dark/8 rounded-2xl overflow-hidden hover:border-emerald-dark/20 transition-colors group flex flex-col md:flex-row">
      {cover && (
        <Link
          href={`/post/${post.id}`}
          // Мобильные: картинка на всю ширину, пропорция 16:10, текст под ней.
          // md+: картинка слева фиксированной ширины 256px.
          // self-stretch + min-h-56 вместо жёсткого h-56: если текст выше 224px,
          // картинка дотянется до низа карточки и под ней не будет пустой полосы.
          className="relative block w-full aspect-[16/10] shrink-0 overflow-hidden bg-emerald-mid/10 md:aspect-auto md:w-64 md:self-stretch md:min-h-56"
        >
          <img
            src={cover}
            alt={post.title}
            className="absolute inset-0 w-full h-full object-cover object-center group-hover:opacity-95 transition-opacity"
          />
          <span
            className={`absolute top-2 left-2 text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full backdrop-blur-sm sm:text-[10px] sm:tracking-widest sm:px-2.5 sm:py-1 ${type.color} bg-cream/85`}
          >
            {type.text}
          </span>
        </Link>
      )}

      <div className="p-4 md:p-5 flex flex-col flex-1 min-w-0">
        {/* Без обложки тип поста показываем в тексте (с обложкой он на картинке).
            «На проверке» всегда живёт здесь: на узкой мобильной обложке
            два бейджа не помещаются и наезжают друг на друга. */}
        {(!cover || post.status === 'pending') && (
          <div className="flex flex-wrap items-center gap-2 mb-1.5">
            {!cover && (
              <span
                className={`text-[10px] uppercase tracking-widest px-2.5 py-1 rounded-full ${type.color}`}
              >
                {type.text}
              </span>
            )}
            {post.status === 'pending' && (
              <span className="text-[10px] uppercase tracking-widest px-2.5 py-1 rounded-full bg-yellow-100 text-yellow-800">
                На проверке
              </span>
            )}
          </div>
        )}

        <Link href={`/post/${post.id}`}>
          {/* Заголовок — максимум 2 строки: длинные названия не растягивают карточку */}
          <h3 className="font-playfair text-lg md:text-xl font-bold text-emerald-dark mb-1 leading-snug hover:text-wine transition-colors line-clamp-2">
            {post.title}
          </h3>
        </Link>

        {post.books && (
          <Link
            href={`/book/${post.books.id}`}
            className="inline-flex items-center gap-1.5 text-[11px] text-emerald-mid hover:text-wine transition-colors mb-1.5"
            onClick={(e) => e.stopPropagation()}
          >
            <BookOpen size={11} strokeWidth={1.8} />
            <span className="line-clamp-1">{post.books.title}</span>
            {post.books.author && (
              <>
                <span className="text-brown/30">·</span>
                <span className="text-brown/50 line-clamp-1">
                  {post.books.author}
                </span>
              </>
            )}
          </Link>
        )}

        {/* Превью + явный вход в пост. Markdown вычищаем через toPlainText (lib/text.ts).
            Текст обрезаем: 3 строки на мобильных, 4 на десктопе — карточка остаётся
            компактной, полный текст читается на странице поста.
            Ссылка «Читать далее» стоит сразу под текстом, поэтому видна всегда. */}
        <div className="min-w-0">
          <p className="text-brown-dark/65 text-sm mb-2 leading-relaxed line-clamp-3 md:line-clamp-4">
            {toPlainText(post.content ?? '')}
          </p>
          <Link
            href={`/post/${post.id}`}
            className="inline-flex items-center gap-1 text-xs font-medium text-wine hover:gap-1.5 transition-all mb-3"
          >
            <span>Читать далее</span>
            <span aria-hidden="true">→</span>
          </Link>
        </div>

        {/* Теги на мобильных скрыты: в узкой колонке они добавляют строк
            и растягивают карточку по высоте. */}
        {tags.length > 0 && (
          <div className="hidden sm:flex flex-wrap gap-2 mb-3">
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

        {/* mt-auto прижимает футер к низу карточки; flex-wrap не даёт
            статистике выдавить ник и дату за границу на мобильных */}
        <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-brown/50 border-t border-emerald-dark/6 pt-2">
          <Link
            href={
              post.profiles?.username
                ? `/profile/${post.profiles.username}`
                : '#'
            }
            className="flex items-center gap-2 min-w-0 hover:text-wine transition-colors"
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
            <span className="font-medium text-brown-dark text-[11px] truncate">
              {post.profiles?.username || 'Аноним'}
            </span>
          </Link>
          <span className="text-brown/20">·</span>
          <span className="text-[11px] whitespace-nowrap">
            {dateFormatter.format(new Date(post.created_at))}
          </span>

          <span className="ml-auto flex items-center gap-2.5">
            {/* Нулевые счётчики не показываем: «0 0» рядом выглядит как «00» */}
            {viewsCount > 0 && (
              <span className="flex items-center gap-1" title="Просмотров">
                <Eye size={12} strokeWidth={1.8} />
                <span>{viewsCount}</span>
              </span>
            )}
            {commentsCount > 0 && (
              <span className="flex items-center gap-1" title="Комментариев">
                <MessageCircle size={12} strokeWidth={1.8} />
                <span>{commentsCount}</span>
              </span>
            )}
            <BookmarkButton postId={post.id} size={12} />
            <LikeButton postId={post.id} />
          </span>
        </div>
      </div>
    </article>
  )
}
