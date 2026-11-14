import { BookOpen, Calendar, ExternalLink } from '@/app/components/icons'
import { formatNewsDate, type ExternalNewsItem } from '@/app/external-news/externalNewsQuery'

/**
 * Карточка книжной новости: обложка слева, справа — заголовок, автор,
 * краткое описание, год и источник. Чисто презентационный компонент,
 * поэтому без 'use client' (рендерится внутри клиентского списка).
 */
export default function ExternalNewsCard({ item }: { item: ExternalNewsItem }) {
  const hasCover = Boolean(item.cover_url)

  return (
    <article className="bg-cream-warm/25 border border-emerald-dark/8 rounded-2xl p-4 flex gap-4 hover:border-emerald-dark/20 transition-colors">
      {/* Обложка или стильная заглушка */}
      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        className="w-20 shrink-0 self-start"
        aria-label={item.title}
        tabIndex={-1}
      >
        <div className="w-20 h-28 rounded-lg overflow-hidden bg-emerald-mid/10 border border-emerald-dark/8 flex items-center justify-center">
          {hasCover ? (
            <img
              src={item.cover_url ?? ''}
              alt=""
              loading="lazy"
              className="w-full h-full object-cover"
            />
          ) : (
            <BookOpen
              size={26}
              strokeWidth={1.3}
              className="text-emerald-mid/35"
            />
          )}
        </div>
      </a>

      <div className="min-w-0 flex flex-col flex-1">
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-playfair text-base md:text-lg font-bold leading-snug text-emerald-dark hover:text-wine transition-colors line-clamp-2"
        >
          {item.title}
        </a>

        {item.author && (
          <p className="mt-0.5 text-xs text-brown/65 line-clamp-1">
            {item.author}
          </p>
        )}

        {item.summary && (
          <p className="mt-1 text-xs leading-snug text-brown-dark/65 line-clamp-3">
            {item.summary}
          </p>
        )}

        <div className="mt-auto pt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-brown/50">
          <span className="font-medium text-brown/70">{item.source}</span>
          {item.published_year && (
            <>
              <span className="text-brown/20">·</span>
              <span>{item.published_year}</span>
            </>
          )}
          <span className="text-brown/20">·</span>
          <span className="flex items-center gap-1">
            <Calendar size={11} strokeWidth={1.8} />
            {formatNewsDate(item.created_at)}
          </span>
          <ExternalLink
            size={11}
            strokeWidth={1.8}
            className="ml-auto opacity-40"
          />
        </div>
      </div>
    </article>
  )
}
