'use client'

'use client'

import { useState } from 'react'
import { BookOpen } from './icons'

/**
 * Внешние изображения приходят с произвольных медиахостов.
 * Не прогоняем их через next/image: оптимизатор отклоняет хосты,
 * отсутствующие в remotePatterns, и создаёт лишние запросы /_next/image.
 */
export default function ExternalNewsCover({
  url,
  alt,
  iconSize = 36,
  fallbackLabel,
}: {
  url: string | null
  alt: string
  iconSize?: number
  fallbackLabel?: string | null
}) {
  const [failed, setFailed] = useState(false)
  const label = fallbackLabel?.trim()

  if (!url || failed) {
    return (
      <span
        role="img"
        aria-label={label ? 'Изображение источника: ' + label : 'Изображение недоступно'}
        className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-[#014b32] to-[#0E2931] px-3 text-center"
      >
        <BookOpen
          size={iconSize}
          strokeWidth={1.2}
          className="text-[#E2E2E0]/45"
        />
        {label && iconSize >= 24 && (
          <span className="max-w-full truncate text-[10px] font-medium uppercase tracking-[0.14em] text-[#E2E2E0]/55">
            {label}
          </span>
        )}
      </span>
    )
  }

  return (
    <span className="relative block h-full w-full overflow-hidden">
      <img
        src={url}
        alt={alt}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="h-full w-full object-cover"
      />
    </span>
  )
}
