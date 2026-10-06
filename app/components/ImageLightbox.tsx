'use client'

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X } from './icons'

const OVERLAY_STYLE: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  zIndex: 2147483647,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: 'rgba(0, 0, 0, 0.95)',
  // ~16px на мобиле, ~32px на десктопе — без зависимости от media-классов
  padding: 'clamp(1rem, 2.5vw, 2rem)',
}

export default function ImageLightbox({
  src,
  onClose,
}: {
  src: string | null
  onClose: () => void
}) {
  useEffect(() => {
    if (!src) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [src, onClose])

  if (!src) return null
  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      // Критичные для перекрытия стили — инлайном, чтобы не зависеть от Tailwind-кэша
      style={OVERLAY_STYLE}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Просмотр фото"
    >
      <button
        type="button"
        onClick={onClose}
        style={{
          position: 'absolute',
          top: '1rem',
          right: '1rem',
          zIndex: 2147483647,
        }}
        className="w-11 h-11 rounded-full bg-black/50 hover:bg-black/70 border border-white/20 backdrop-blur flex items-center justify-center text-white shadow-lg transition-colors"
        aria-label="Закрыть"
      >
        <X size={24} strokeWidth={1.8} />
      </button>

      <img
        src={src}
        alt=""
        className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
      />
    </div>,
    document.body
  )
}
