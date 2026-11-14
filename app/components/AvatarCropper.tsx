'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Cropper, { type Area } from 'react-easy-crop'
import 'react-easy-crop/react-easy-crop.css'
import { X } from './icons'

type Props = {
  /** Выбранный пользователем файл (уже прошедший валидацию размера/типа) */
  file: File
  /** Пока идёт загрузка в Storage — блокируем кнопки */
  uploading?: boolean
  onCancel: () => void
  onSave: (blob: Blob) => void | Promise<void>
}

/** Итоговый размер аватара: 512×512 хватит и для retina, и для веса файла */
const OUTPUT_SIZE = 512

const MAX_ZOOM = 3

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Не удалось прочитать изображение'))
    img.src = src
  })
}

/**
 * Вырезает квадрат из исходника по области кроппера и отдаёт JPEG-Blob.
 * Круглая маска — это только визуальный слой: в Storage кладём квадрат,
 * а круглым аватар делает CSS (rounded-full), поэтому обрезка по квадрату.
 */
async function cropToBlob(src: string, area: Area): Promise<Blob> {
  const image = await loadImage(src)
  const side = Math.min(area.width, area.height)

  const canvas = document.createElement('canvas')
  canvas.width = OUTPUT_SIZE
  canvas.height = OUTPUT_SIZE

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D недоступен в этом браузере')

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image, area.x, area.y, side, side, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE)

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      blob =>
        blob
          ? resolve(blob)
          : reject(new Error('Не удалось подготовить изображение')),
      'image/jpeg',
      0.9,
    )
  })
}

export default function AvatarCropper({
  file,
  uploading = false,
  onCancel,
  onSave,
}: Props) {
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [area, setArea] = useState<Area | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Object URL живёт, пока открыт кроппер — не течёт между открытиями
  const objectUrl = useMemo(() => URL.createObjectURL(file), [file])
  useEffect(() => {
    return () => URL.revokeObjectURL(objectUrl)
  }, [objectUrl])

  const handleCropComplete = useCallback((_cropped: Area, pixels: Area) => {
    setArea(pixels)
  }, [])

  async function handleSave() {
    if (!area || saving) return

    setSaving(true)
    setError(null)

    try {
      const blob = await cropToBlob(objectUrl, area)
      await onSave(blob)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось обрезать изображение')
    } finally {
      setSaving(false)
    }
  }

  const busy = saving || uploading

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Обрезка аватара"
    >
      <div className="w-full max-w-md rounded-2xl bg-cream-warm p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-playfair text-lg font-bold text-emerald-dark">
            Обрезка аватара
          </h2>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="text-brown/50 hover:text-wine transition-colors disabled:opacity-50"
            aria-label="Закрыть"
          >
            <X size={20} strokeWidth={1.8} />
          </button>
        </div>

        {/* Контейнер обязателен: у Cropper абсолютное позиционирование внутри */}
        <div className="relative h-72 w-full overflow-hidden rounded-xl bg-black">
          <Cropper
            image={objectUrl}
            crop={crop}
            zoom={zoom}
            aspect={1}
            cropShape="round"
            showGrid={false}
            minZoom={1}
            maxZoom={MAX_ZOOM}
            restrictPosition
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={handleCropComplete}
          />
        </div>

        <div className="mt-4">
          <label className="mb-1 flex items-center justify-between text-xs text-brown/60">
            <span>Масштаб</span>
            <span>{zoom.toFixed(1)}×</span>
          </label>
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            disabled={busy}
            className="w-full accent-emerald-mid"
          />
          <p className="mt-1 text-xs text-brown/50">
            Двигайте фото мышью, масштаб — колёсиком или ползунком.
          </p>
        </div>

        {error && <p className="mt-2 text-xs text-wine">{error}</p>}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex-1 rounded-full border border-emerald-dark/15 bg-cream px-4 py-2 text-sm text-brown-dark transition-colors hover:bg-cream-warm disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={busy || !area}
            className="flex-1 rounded-full bg-emerald-mid px-4 py-2 text-sm text-cream transition-colors hover:bg-emerald-dark disabled:opacity-50"
          >
            {busy ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  )
}
