// app/news/NewsFilterBar.tsx
// Фильтры — обычные ссылки: состояние живёт в URL, страница остаётся
// серверной (никакого клиентского JS ради переключения категории).
import Link from 'next/link'
import { NEWS_FILTERS, newsHref, type NewsFilter } from './newsQuery'

export default function NewsFilterBar({ active }: { active: NewsFilter }) {
  return (
    <nav aria-label="Категории новостей" className="flex flex-wrap gap-2">
      {NEWS_FILTERS.map(({ value, label }) => {
        const isActive = value === active

        return (
          <Link
            key={value}
            href={newsHref(value)}
            aria-current={isActive ? 'page' : undefined}
            className={
              isActive
                ? 'rounded-full border border-[#014b32] bg-[#014b32] px-4 py-2 text-sm font-medium text-[#E2E2E0]'
                : 'rounded-full border border-[#493344] bg-[#0E2931] px-4 py-2 text-sm text-[#E2E2E0]/75 transition-colors hover:border-[#014b32] hover:text-[#E2E2E0]'
            }
          >
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
