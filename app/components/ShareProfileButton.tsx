'use client'

import { useEffect, useRef, useState } from 'react'
import { Share2, Check } from './icons'

export default function ShareProfileButton({
  username,
  className = '',
}: {
  username: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [])

  function showCopied() {
    setCopied(true)
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setCopied(false), 2000)
  }

  async function handleShare() {
    const url = `${window.location.origin}/profile/${username}`

    // Нативное окно «Поделиться» (мобильные браузеры, часть десктопов).
    // Гонка с таймаутом: в некоторых окружениях share() может зависнуть
    // без системного диалога — тогда через 2 с fallback'имся на копирование.
    if (typeof navigator.share === 'function') {
      try {
        await Promise.race([
          navigator.share({
            title: `${username} · Хлеба и букв`,
            url,
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('share-timeout')), 2000)
          ),
        ])
        return
      } catch {
        // Пользователь закрыл окно, таймаут или нет поддержки — копируем
      }
    }

    try {
      await navigator.clipboard.writeText(url)
    } catch {
      // Старые браузеры или нет разрешения — фолбэк через execCommand
      const ta = document.createElement('textarea')
      ta.value = url
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try {
        document.execCommand('copy')
      } catch {
        // ничего не поделаем — покажем ссылку текстом в консоли
        console.info('Ссылка на профиль:', url)
      }
      document.body.removeChild(ta)
    }
    showCopied()
  }

  return (
    <button
      type="button"
      onClick={handleShare}
      className={`flex items-center gap-2 bg-cream-warm border border-emerald-dark/15 text-brown-dark px-4 py-2 rounded-full text-sm hover:bg-cream transition-colors ${className}`}
      aria-label="Поделиться профилем"
    >
      {copied ? (
        <>
          <Check size={15} strokeWidth={2} />
          <span>Скопировано</span>
        </>
      ) : (
        <>
          <Share2 size={15} strokeWidth={1.8} />
          <span>Поделиться профилем</span>
        </>
      )}
    </button>
  )
}
