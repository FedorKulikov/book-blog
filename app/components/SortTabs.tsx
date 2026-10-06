'use client'

export type SortKey = 'new' | 'popular' | 'discussed'

type Props = {
  value: SortKey
  onChange: (v: SortKey) => void
}

const TABS: { key: SortKey; label: string }[] = [
  { key: 'new', label: 'Новые' },
  { key: 'popular', label: 'Популярные' },
  { key: 'discussed', label: 'Обсуждаемые' },
]

export default function SortTabs({ value, onChange }: Props) {
  return (
    <div className="flex flex-wrap gap-2 mb-6">
      {TABS.map(t => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`px-4 py-1.5 rounded-full text-sm transition-colors ${
            value === t.key
              ? 'bg-wine text-white'
              : 'bg-cream-warm/40 text-brown-dark hover:bg-cream-warm/70 border border-emerald-dark/10'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}