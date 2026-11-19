'use client'

// app/components/ExternalNewsCover.tsx
// Обложка внешней новости с двумя защитами:
//   1) картинки может не быть вовсе (cover_url = null);
//   2) ссылка может быть битой (404 у Open Library) — тогда срабатывает onError.
// В обоих случаях показываем градиентную заглушку с иконкой книги,
// а не «сломанную картинку» браузера.
import { useState } from 'react'
import { BookOpen } from './icons'

export default function ExternalNewsCover({
  url,
  alt,
  iconSize = 36,
}: {
  url: string | null
  alt: string
  iconSize?: number
}) {
  const [failed, setFailed] = useState(false)

  if (!url || failed) {
    return (
      <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#014b32] to-[#0E2931]">
        <BookOpen
          size={iconSize}
          strokeWidth={1.2}
          className="text-[#E2E2E0]/35"
        />
      </span>
    )
  }

  return (
    <img
      src={url}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className="h-full w-full object-cover"
    />
  )
}
