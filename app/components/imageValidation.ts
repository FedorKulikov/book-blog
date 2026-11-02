// app/components/imageValidation.ts
// Одна проверка для всех загрузчиков картинок: размер, MIME-тип, расширение.
// Клиентская валидация — только UX. Настоящая защита живёт в Supabase Storage
// (лимит размера файла и allowed MIME types на бакете) + RLS-политиках.

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024 // 5 МБ

export const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const

export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number]

const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif']

export const IMAGE_ACCEPT_ATTR = ALLOWED_IMAGE_TYPES.join(',')

export type ImageValidationResult =
  | { ok: true }
  | { ok: false; message: string }

/** Расширение файла в нижнем регистре (без точки) */
function extensionOf(name: string): string {
  const parts = name.toLowerCase().split('.')
  return parts.length > 1 ? (parts[parts.length - 1] ?? '') : ''
}

/**
 * Проверяет файл перед загрузкой.
 * Порядок важен: сначала размер (дешевле всего), потом тип.
 */
export function validateImageFile(file: File): ImageValidationResult {
  if (file.size === 0) {
    return { ok: false, message: 'Файл пустой — выберите другое изображение.' }
  }

  if (file.size > MAX_IMAGE_BYTES) {
    return { ok: false, message: 'Файл слишком большой. Максимум 5 МБ.' }
  }

  // file.type может быть пустым (старые браузеры, некоторые ОС) —
  // тогда проверяем по расширению, но не ослабляем список форматов.
  const type = file.type.toLowerCase()
  if (type) {
    if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(type)) {
      return {
        ok: false,
        message: 'Можно загружать только изображения: JPG, PNG, WebP или GIF.',
      }
    }
    return { ok: true }
  }

  const ext = extensionOf(file.name)
  if (!ext || !ALLOWED_EXTENSIONS.includes(ext)) {
    return {
      ok: false,
      message: 'Можно загружать только изображения: JPG, PNG, WebP или GIF.',
    }
  }

  return { ok: true }
}
