'use client'

// app/components/ExternalNewsCover.tsx
// Обложка внешней новости. Три задачи:
//   1) картинки может не быть вовсе (cover_url = null);
//   2) ссылка может быть битой (404) — тогда срабатывает onError;
//   3) часть источников (litkarta.ru) отдаёт картинки ТОЛЬКО по http,
//      а сайт работает по https. Браузер вырезал бы такую картинку как
//      Mixed Content, поэтому она идёт через next/image: оптимизатор
//      скачивает её на сервере и отдаёт уже по https.
import { useState } from 'react'
import Image from 'next/image'
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
    <span className="relative block h-full w-full overflow-hidden">
      <Image
        src={url}
        alt={alt}
        fill
        // Карточки шириной примерно в половину экрана на десктопе
        sizes="(max-width: 768px) 100vw, 50vw"
        onError={() => setFailed(true)}
        className="object-cover"
      />
    </span>
  )
}
