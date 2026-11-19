'use client'

// app/components/NewsFields.tsx
// Поля новостного портала. Вынесены в один компонент, чтобы форма создания
// и форма редактирования не разъезжались в поведении и валидации.
import {
  NEWS_CATEGORIES,
  NEWS_CATEGORY_LABEL,
  type NewsCategory,
} from '@/app/news/newsQuery'

/** Категории, у которых есть дедлайн (конкурсы и мероприятия). */
export function hasDeadline(category: NewsCategory): boolean {
  return category === 'contest' || category === 'event'
}

/**
 * Дата из <input type="date"> → ISO с концом дня по Москве.
 * Дедлайн «15 декабря» логично трактовать как «до конца 15 декабря».
 */
export function deadlineDateToIso(value: string): string | null {
  if (!value) return null
  const date = new Date(`${value}T23:59:59+03:00`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** ISO из базы → значение для <input type="date"> (в московской зоне). */
export function isoToDeadlineDate(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''

  // en-CA даёт ровно YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

export const SOURCE_URL_RE = /^https?:\/\/[^\s]+$/i

type Props = {
  category: NewsCategory
  onCategoryChange: (value: NewsCategory) => void
  deadline: string
  onDeadlineChange: (value: string) => void
  sourceUrl: string
  onSourceUrlChange: (value: string) => void
}

const inputClass =
  'w-full border border-emerald-dark/15 rounded-lg px-3 py-2 bg-cream-warm/40 focus:outline-none focus:border-emerald-mid'

const labelClass = 'block text-sm font-medium mb-1 text-brown-dark'

export default function NewsFields({
  category,
  onCategoryChange,
  deadline,
  onDeadlineChange,
  sourceUrl,
  onSourceUrlChange,
}: Props) {
  return (
    <div className="space-y-4 rounded-xl border border-emerald-dark/10 bg-cream-warm/20 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.15em] text-emerald-mid">
        Для новостного портала
      </p>

      <div>
        <label className={labelClass} htmlFor="news-category">
          Категория новости
        </label>
        <select
          id="news-category"
          value={category}
          onChange={event => onCategoryChange(event.target.value as NewsCategory)}
          className={inputClass}
        >
          {NEWS_CATEGORIES.map(value => (
            <option key={value} value={value}>
              {NEWS_CATEGORY_LABEL[value]}
            </option>
          ))}
        </select>
      </div>

      {hasDeadline(category) && (
        <div>
          <label className={labelClass} htmlFor="news-deadline">
            Дедлайн
          </label>
          <input
            id="news-deadline"
            type="date"
            value={deadline}
            onChange={event => onDeadlineChange(event.target.value)}
            className={inputClass}
          />
          <p className="text-xs text-brown/55 mt-1">
            Показывается на карточке как «До 15 декабря». Дедлайн действует до
            конца выбранного дня.
          </p>
        </div>
      )}

      <div>
        <label className={labelClass} htmlFor="news-source">
          Ссылка на источник{' '}
          <span className="font-normal text-brown/45">(необязательно)</span>
        </label>
        <input
          id="news-source"
          type="url"
          value={sourceUrl}
          onChange={event => onSourceUrlChange(event.target.value)}
          className={inputClass}
          placeholder="https://example.com/news/..."
        />
        {sourceUrl.trim() && !SOURCE_URL_RE.test(sourceUrl.trim()) && (
          <p className="text-xs text-wine mt-1">
            Ссылка должна начинаться с http:// или https://
          </p>
        )}
      </div>
    </div>
  )
}
