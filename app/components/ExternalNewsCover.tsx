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
  sizes = '(max-width: 768px) 100vw, 50vw',
}: {
  url: string | null
  alt: string
  iconSize?: number
  /** Подсказка оптимизатору: какую ширину занимает картинка */
  sizes?: string
}) {
  // Две независимые «ступени» деградации:
  //   next/image → обычный <img referrerPolicy="no-referrer"> → заглушка
  const [optimizerFailed, setOptimizerFailed] = useState(false)
  const [plainFailed, setPlainFailed] = useState(false)

  if (!url || plainFailed) {
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

  // Оптимизатор не смог отдать картинку (403 от источника или таймаут):
  // показываем обычный <img> без referrer — часть сайтов режет именно его
  if (optimizerFailed) {
    return (
      <span className="relative block h-full w-full overflow-hidden">
        <img
          src={url}
          alt={alt}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setPlainFailed(true)}
          className="h-full w-full object-cover"
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
        sizes={sizes}
        onError={() => setOptimizerFailed(true)}
        className="object-cover"
      />
    </span>
  )
}
