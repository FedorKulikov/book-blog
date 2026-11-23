// app/components/ExternalNewsCard.tsx
// Карточка внешней новости в стиле книжного портала: обложка 16:9,
// два бейджа (источник + тип материала), заголовок, дата с иконкой часов
// и кнопка «Читать» на первоисточник.
// Длинные описания и иностранные аннотации намеренно не выводим.
import { Clock, ExternalLink } from '@/app/components/icons'
import ExternalNewsCover from '@/app/components/ExternalNewsCover'
import {
  formatNewsDate,
  type ExternalNewsItem,
} from '@/app/external-news/externalNewsQuery'

/** Бейдж типа: другой цвет, чтобы не путался с бейджем источника */
const TYPE_BADGE: Record<string, string> = {
  Новость: 'bg-[#681F2D] text-[#E2E2E0]',
  Анонс: 'bg-[#493344] text-[#E2E2E0]',
  Статья: 'bg-[#493344] text-[#E2E2E0]',
}

export default function ExternalNewsCard({ item }: { item: ExternalNewsItem }) {
  const type = item.news_type || 'Статья'
  const typeClass = TYPE_BADGE[type] ?? TYPE_BADGE.Статья

  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-2xl border border-[#493344] bg-[#0E2931] transition-colors hover:border-[#014b32]">
      {/* Обложка 2:1 — карточка ниже, чем была при 16:9 */}
      <div className="relative aspect-[2/1] w-full overflow-hidden bg-[#12484C]">
        <ExternalNewsCover
          url={item.cover_url}
          alt=""
          fallbackLabel={item.source || 'Новости'}
        />

        <span className="absolute left-4 top-4 rounded-full bg-[#014b32] px-3 py-1 text-xs font-medium text-[#E2E2E0]">
          {item.source || 'Новости'}
        </span>

        <span
          className={`absolute right-4 top-4 rounded-full px-3 py-1 text-xs font-medium ${typeClass}`}
        >
          {type}
        </span>
      </div>

      <div className="flex flex-1 flex-col p-5">
        <h3 className="mb-2 font-playfair text-lg font-bold leading-snug text-[#E2E2E0] line-clamp-2 transition-colors group-hover:text-[#2B7574] md:text-xl">
          {item.title}
        </h3>

        {/* Краткое содержание: 3 строки, чтобы карточки были одной высоты */}
        {item.summary && (
          <p className="mb-4 text-sm leading-relaxed text-[#E2E2E0]/70 line-clamp-3">
            {item.summary}
          </p>
        )}

        <div className="mt-auto flex items-center justify-between gap-3 text-xs text-[#E2E2E0]/60">
          <span className="inline-flex items-center gap-1.5">
            <Clock size={13} strokeWidth={1.8} className="opacity-70" />
            {formatNewsDate(item.created_at)}
          </span>

          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full border border-[#493344] px-3 py-1.5 text-xs font-medium text-[#E2E2E0] transition-colors hover:border-[#014b32] hover:bg-[#014b32]"
          >
            Читать
            <ExternalLink size={12} strokeWidth={1.8} />
          </a>
        </div>
      </div>
    </article>
  )
}
