// app/components/ExternalNewsCard.tsx
// Карточка внешней новости в стиле книжного портала: обложка 16:9,
// заголовок, источник с датой и кнопка «Читать» на первоисточник.
// Длинные описания и иностранные аннотации намеренно не выводим.
import { ExternalLink } from '@/app/components/icons'
import ExternalNewsCover from '@/app/components/ExternalNewsCover'
import {
  formatNewsDate,
  type ExternalNewsItem,
} from '@/app/external-news/externalNewsQuery'

export default function ExternalNewsCard({ item }: { item: ExternalNewsItem }) {
  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-2xl border border-[#493344] bg-[#0E2931] transition-colors hover:border-[#014b32]">
      {/* Обложка всегда 16:9 — сетка карточек остаётся ровной */}
      <div className="relative aspect-video w-full overflow-hidden bg-[#12484C]">
        <ExternalNewsCover url={item.cover_url} alt="" />

        <span className="absolute left-4 top-4 rounded-full bg-[#014b32] px-3 py-1 text-xs font-medium text-[#E2E2E0]">
          {item.source || 'Новости'}
        </span>
      </div>

      <div className="flex flex-1 flex-col p-5">
        <h3 className="mb-3 font-playfair text-lg font-bold leading-snug text-[#E2E2E0] line-clamp-2 transition-colors group-hover:text-[#2B7574] md:text-xl">
          {item.title}
        </h3>

        <div className="mt-auto flex items-center justify-between gap-3 text-xs text-[#E2E2E0]/60">
          <span>{formatNewsDate(item.created_at)}</span>

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
