'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { X, ZoomIn, ZoomOut } from './icons'
import StorageImage from './StorageImage'

const MIN_SCALE = 1
const MAX_SCALE = 4
const STEP = 0.25

type Props = {
  src: string
  username: string
  onClose: () => void
}

/**
 * Полноэкранный просмотр фото профиля другого участника:
 * колёсико/кнопки — зум, перетаскивание — панорама, Esc/клик по фону — закрыть.
 */
export default function AvatarLightbox({ src, username, onClose }: Props) {
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)

  const stageRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{
    pointerX: number
    pointerY: number
    offsetX: number
    offsetY: number
  } | null>(null)

  const clampScale = (value: number) =>
    Math.min(MAX_SCALE, Math.max(MIN_SCALE, value))

  const zoomBy = useCallback((delta: number) => {
    setScale(prev => {
      const next = clampScale(prev + delta)
      // При возврате к 1× возвращаем картинку в центр
      if (next === 1) setOffset({ x: 0, y: 0 })
      return next
    })
  }, [])

  const reset = useCallback(() => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }, [])

  // Esc закрывает, скролл страницы под модалкой блокируем
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [onClose])

  // Колёсико: нужен non-passive listener, иначе браузер игнорирует preventDefault
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return

    function onWheel(event: WheelEvent) {
      event.preventDefault()
      zoomBy(event.deltaY > 0 ? -STEP : STEP)
    }

    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [zoomBy])

  function handlePointerDown(event: React.PointerEvent<HTMLImageElement>) {
    if (scale <= 1) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      offsetX: offset.x,
      offsetY: offset.y,
    }
    setDragging(true)
  }

  function handlePointerMove(event: React.PointerEvent<HTMLImageElement>) {
    const drag = dragRef.current
    if (!drag) return

    setOffset({
      x: drag.offsetX + (event.clientX - drag.pointerX),
      y: drag.offsetY + (event.clientY - drag.pointerY),
    })
  }

  function handlePointerUp() {
    dragRef.current = null
    setDragging(false)
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Фото профиля ${username}`}
      onClick={onClose}
    >
      {/* Верхняя панель: имя + действия */}
      <div
        className="absolute top-3 left-0 right-0 flex items-center justify-between px-4 text-cream"
        onClick={(event) => event.stopPropagation()}
      >
        <span className="text-sm font-medium truncate">{username}</span>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => zoomBy(-STEP)}
            disabled={scale <= MIN_SCALE}
            className="rounded-full p-2 text-cream/80 hover:text-cream hover:bg-white/10 transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
            aria-label="Уменьшить"
          >
            <ZoomOut size={18} strokeWidth={1.8} />
          </button>
          <span className="w-12 text-center text-xs tabular-nums text-cream/70">
            {Math.round(scale * 100)}%
          </span>
          <button
            type="button"
            onClick={() => zoomBy(STEP)}
            disabled={scale >= MAX_SCALE}
            className="rounded-full p-2 text-cream/80 hover:text-cream hover:bg-white/10 transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
            aria-label="Увеличить"
          >
            <ZoomIn size={18} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            onClick={reset}
            className="rounded-full px-3 py-1.5 text-xs text-cream/70 hover:text-cream hover:bg-white/10 transition-colors"
          >
            Сбросить
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-cream/80 hover:text-cream hover:bg-white/10 transition-colors"
            aria-label="Закрыть"
          >
            <X size={20} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      {/* Сцена: колесо мыши зумит, картинку можно тащить при scale > 1 */}
      <div
        ref={stageRef}
        className="relative flex h-full w-full items-center justify-center"
        onClick={(event) => event.stopPropagation()}
      >
        <StorageImage
          src={src}
          alt={`Фото профиля ${username}`}
          draggable={false}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onDoubleClick={() => (scale > 1 ? reset() : setScale(2))}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transition: dragging ? 'none' : 'transform 120ms ease-out',
            cursor: scale > 1 ? (dragging ? 'grabbing' : 'grab') : 'zoom-in',
          }}
          className="max-h-[85vh] max-w-[92vw] select-none rounded-xl object-contain shadow-2xl"
        />
      </div>

      <p className="absolute bottom-4 left-0 right-0 text-center text-[11px] text-cream/50 px-4">
        Колесо мыши или кнопки — масштаб · перетаскивание — сдвиг · Esc — закрыть
      </p>
    </div>
  )
}
