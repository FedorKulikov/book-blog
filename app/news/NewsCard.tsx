// app/news/NewsCard.tsx
// Карточка новости портала. Палитра — наши HEX-токены:
// тёмный фон #0E2931, изумруд #014b32, вино #681F2D, крем #E2E2E0, рамка #493344.
//
// Карточка обслуживает обе части ленты: посты пользователей и автоматически
// импортированные новости из медиа (у них ссылка ведёт на первоисточник,
// поэтому карточка рендерится как <a target="_blank">, а не как <Link>).
//
// Серверный компонент: карточки попадают в HTML сразу, их видят поисковики.
import Link from 'next/link'
import { ExternalLink } from '@/app/components/icons'
import ExternalNewsCover from '@/app/components/ExternalNewsCover'
import {
  NEWS_CATEGORY_BADGE,
  NEWS_CATEGORY_LABEL,
  formatDeadline,
  formatNewsDate,
  isDeadlinePassed,
  isNewsCategory,
  type PortalNewsItem,
} from './newsQuery'

function categoryLabel(item: PortalNewsItem): string {
  return item.category ? NEWS_CATEGORY_LABEL[item.category] : 'Новость'
}

function badgeClass(item: PortalNewsItem): string {
  return item.category
    ? NEWS_CATEGORY_BADGE[item.category]
    : NEWS_CATEGORY_BADGE.news
}

/** Обложка: у внешних новостей — через next/image (http-источники чинятся там) */
function CardCover({
  item,
  className,
}: {
  item: PortalNewsItem
  className: string
}) {
  if (!item.cover) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <span className="font-playfair text-xl text-[#E2E2E0]/25">
          Хлеба и букв
        </span>
      </div>
    )
  }

  if (item.external) {
    return <ExternalNewsCover url={item.cover} alt="" />
  }

  return <img src={item.cover} alt="" loading="lazy" className={className} />
}

/** Дата + дедлайн (посты) или источник и кнопка «Читать» (внешние новости) */
function CardMeta({
  item,
  size,
}: {
  item: PortalNewsItem
  size: 'hero' | 'grid'
}) {
  const deadline =
    !item.external &&
    (item.category === 'contest' || item.category === 'event') &&
    item.deadline_at
      ? item.deadline_at
      : null
  const passed = deadline ? isDeadlinePassed(deadline) : false

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2 ${
        size === 'hero' ? 'text-sm' : 'text-xs'
      } text-[#E2E2E0]/60`}
    >
      <span className="flex items-center gap-2">
        {formatNewsDate(item.created_at)}
        {item.external && item.source && (
          <>
            <span className="text-[#E2E2E0]/25">·</span>
            <span className="text-[#E2E2E0]/70">{item.source}</span>
          </>
        )}
      </span>

      <span className="flex items-center gap-3">
        {!item.external && item.source_url && (
          <span
            className="flex items-center gap-1 text-[#E2E2E0]/45"
            title="Есть ссылка на первоисточник"
          >
            <ExternalLink size={12} strokeWidth={1.8} />
            <span className={size === 'hero' ? '' : 'sr-only'}>Источник</span>
          </span>
        )}

        {item.external && (
          <span className="flex items-center gap-1 text-[#E2E2E0]/70">
            Читать
            <ExternalLink size={12} strokeWidth={1.8} />
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

function CardShell({
  item,
  className,
  children,
}: {
  item: PortalNewsItem
  className: string
  children: React.ReactNode
}) {
  if (item.external) {
    return (
      <a href={item.href} target="_blank" rel="noopener noreferrer" className={className}>
        {children}
      </a>
    )
  }

  return (
    <Link href={item.href} className={className}>
      {children}
    </Link>
  )
}

export default function NewsCard({
  item,
  variant = 'grid',
}: {
  item: PortalNewsItem
  variant?: 'hero' | 'grid'
}) {
  if (variant === 'hero') {
    return (
      <CardShell
        item={item}
        className="group block overflow-hidden rounded-3xl border border-[#493344] bg-[#0E2931] transition-colors hover:border-[#014b32]"
      >
        <div className="relative aspect-video w-full overflow-hidden bg-[#12484C]">
          <CardCover
            item={item}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0E2931] via-[#0E2931]/20 to-transparent" />

          <span
            className={`absolute left-4 top-4 rounded-full px-3 py-1 text-sm font-medium ${badgeClass(item)}`}
          >
            {categoryLabel(item)}
          </span>
        </div>

        <div className="p-5 md:p-7">
          <h2 className="mb-2 font-playfair text-2xl font-bold leading-tight text-[#E2E2E0] transition-colors group-hover:text-[#2B7574] line-clamp-3 md:text-4xl">
            {item.title}
          </h2>

          {item.excerpt && (
            <p className="mb-4 max-w-3xl text-sm leading-relaxed text-[#E2E2E0]/65 line-clamp-2 md:text-base">
              {item.excerpt}
            </p>
          )}

          <CardMeta item={item} size="hero" />
        </div>
      </CardShell>
    )
  }

  return (
    <CardShell
      item={item}
      className="group flex h-full flex-col overflow-hidden rounded-2xl border border-[#493344] bg-[#0E2931] transition-colors hover:border-[#014b32]"
    >
      <div className="relative aspect-[16/9] w-full overflow-hidden bg-[#12484C]">
        <CardCover
          item={item}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
        />

        <span
          className={`absolute left-4 top-4 rounded-full px-3 py-1 text-xs font-medium ${badgeClass(item)}`}
        >
          {categoryLabel(item)}
        </span>
      </div>

      <div className="flex flex-1 flex-col p-5">
        <h3 className="mb-2 font-playfair text-xl font-bold leading-snug text-[#E2E2E0] transition-colors group-hover:text-[#2B7574] line-clamp-2">
          {item.title}
        </h3>

        {item.excerpt && (
          <p className="mb-4 text-xs leading-relaxed text-[#E2E2E0]/55 line-clamp-2">
            {item.excerpt}
          </p>
        )}

        <div className="mt-auto">
          <CardMeta item={item} size="grid" />
        </div>
      </div>
    </CardShell>
  )
}
