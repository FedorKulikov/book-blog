'use client'

export default function CookieSettingsButton() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event('bookblog:manage-analytics'))}
      className="inline-flex min-h-10 items-center justify-center rounded-full border border-emerald-dark/25 px-4 py-2 text-sm font-medium text-emerald-dark transition-colors hover:bg-cream-warm/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-dark"
    >
      Изменить настройки
    </button>
  )
}
