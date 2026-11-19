// app/news/NewsCard.tsx
// Карточка новости портала. Палитра — наши HEX-токены:
// тёмный фон #0E2931, изумруд #014b32, вино #681F2D, крем #E2E2E0, рамка #493344.
//
// Серверный компонент: карточки попадают в HTML сразу, их видят поисковики.
import Link from 'next/link'
import { toPlainText, truncate } from '@/lib/text'
import { ExternalLink } from '@/app/components/icons'
import {
  NEWS_CATEGORY_BADGE,
  NEWS_CATEGORY_LABEL,
  coverOf,
  formatDeadline,
  formatNewsDate,
  isDeadlinePassed,
  isNewsCategory,
  showsDeadline,
  type NewsPost,
} from './newsQuery'

function categoryLabel(post: NewsPost): string {
  return isNewsCategory(post.news_category)
    ? NEWS_CATEGORY_LABEL[post.news_category]
    : 'Новость'
}

function badgeClass(post: NewsPost): string {
  return isNewsCategory(post.news_category)
    ? NEWS_CATEGORY_BADGE[post.news_category]
    : NEWS_CATEGORY_BADGE.news
}

/** Дата + дедлайн: общий подвал для обоих вариантов карточки. */
function CardMeta({ post, size }: { post: NewsPost; size: 'hero' | 'grid' }) {
  const deadline = showsDeadline(post) ? post.deadline_at : null
  const passed = deadline ? isDeadlinePassed(deadline) : false

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2 ${
        size === 'hero' ? 'text-sm' : 'text-xs'
      } text-[#E2E2E0]/60`}
    >
      <span>{formatNewsDate(post.created_at)}</span>

      <span className="flex items-center gap-3">
        {post.source_url && (
          <span
            className="flex items-center gap-1 text-[#E2E2E0]/45"
            title="Есть ссылка на первоисточник"
          >
            <ExternalLink size={12} strokeWidth={1.8} />
            <span className={size === 'hero' ? '' : 'sr-only'}>Источник</span>
          </span>
        )}

        {deadline && (
          <span
            className={
              passed
                ? 'font-bold text-[#E2E2E0]/40'
                : 'font-bold text-[#E2E2E0] bg-[#681F2D] px-2 py-0.5 rounded-full'
            }
          >
            {passed ? 'Дедлайн прошёл' : formatDeadline(deadline)}
          </span>
        )}
      </span>
    </div>
  )
}

export default function NewsCard({
  post,
  variant = 'grid',
}: {
  post: NewsPost
  variant?: 'hero' | 'grid'
}) {
  const cover = coverOf(post)
  const excerpt = post.content ? truncate(toPlainText(post.content), variant === 'hero' ? 220 : 140) : ''

  if (variant === 'hero') {
    return (
      <Link
        href={`/post/${post.id}`}
        className="group block overflow-hidden rounded-3xl border border-[#493344] bg-[#0E2931] transition-colors hover:border-[#014b32]"
      >
        <div className="relative aspect-video w-full overflow-hidden bg-[#12484C]">
          {cover ? (
            <img
              src={cover}
              alt=""
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-[#12484C]">
              <span className="font-playfair text-4xl text-[#E2E2E0]/25">
                Хлеба и букв
              </span>
            </div>
          )}

          <div className="absolute inset-0 bg-gradient-to-t from-[#0E2931] via-[#0E2931]/20 to-transparent" />

          <span
            className={`absolute left-4 top-4 rounded-full px-3 py-1 text-sm font-medium ${badgeClass(post)}`}
          >
            {categoryLabel(post)}
          </span>
        </div>

        <div className="p-5 md:p-7">
          <h2 className="mb-2 font-playfair text-2xl font-bold leading-tight text-[#E2E2E0] transition-colors group-hover:text-[#2B7574] line-clamp-3 md:text-4xl">
            {post.title}
          </h2>

          {excerpt && (
            <p className="mb-4 max-w-3xl text-sm leading-relaxed text-[#E2E2E0]/65 line-clamp-2 md:text-base">
              {excerpt}
            </p>
          )}

          <CardMeta post={post} size="hero" />
        </div>
      </Link>
    )
  }

  return (
    <Link
      href={`/post/${post.id}`}
      className="group flex h-full flex-col overflow-hidden rounded-2xl border border-[#493344] bg-[#0E2931] transition-colors hover:border-[#014b32]"
    >
      <div className="relative aspect-[16/9] w-full overflow-hidden bg-[#12484C]">
        {cover ? (
          <img
            src={cover}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="font-playfair text-xl text-[#E2E2E0]/25">
              Хлеба и букв
            </span>
          </div>
        )}

        <span
          className={`absolute left-4 top-4 rounded-full px-3 py-1 text-xs font-medium ${badgeClass(post)}`}
        >
          {categoryLabel(post)}
        </span>
      </div>

      <div className="flex flex-1 flex-col p-5">
        <h3 className="mb-2 font-playfair text-xl font-bold leading-snug text-[#E2E2E0] transition-colors group-hover:text-[#2B7574] line-clamp-2">
          {post.title}
        </h3>

        {excerpt && (
          <p className="mb-4 text-xs leading-relaxed text-[#E2E2E0]/55 line-clamp-2">
            {excerpt}
          </p>
        )}

        <div className="mt-auto">
          <CardMeta post={post} size="grid" />
        </div>
      </div>
    </Link>
  )
}
