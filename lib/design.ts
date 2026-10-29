// lib/design.ts
/**
 * Детерминированные «обложки» для постов без картинки.
 *
 * Один и тот же пост всегда получает один и тот же градиент — иначе при каждом
 * рендере/навигации лента «мерцала» бы разными цветами.
 *
 * ВАЖНО (Tailwind 4/JIT): классы записаны ЦЕЛИКОМ строками в массиве, а не
 * собираются из частей (`'from-' + color`). Сканер Tailwind ищет полные имена
 * классов в исходниках — склейка из частей попала бы в CSS только случайно.
 */

const COVER_GRADIENTS = [
  'from-emerald-dark via-emerald-mid to-emerald-light',
  'from-wine via-wine-dark to-brown-dark',
  'from-brown via-plum to-wine',
  'from-emerald-mid via-emerald-light to-plum',
  'from-plum via-brown to-emerald-dark',
  'from-wine-dark via-plum to-emerald-mid',
] as const

export type CoverGradient = (typeof COVER_GRADIENTS)[number]

/** Стабильный 32-битный хеш строки (FNV-1a). */
function hashSeed(seed: string): number {
  let hash = 2166136261
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/**
 * Классы градиента обложки-заглушки. Использовать вместе с `bg-gradient-to-br`:
 *
 *   <div className={`bg-gradient-to-br ${coverGradient(post.id)}`} />
 */
export function coverGradient(seed: string): CoverGradient {
  if (!seed) return COVER_GRADIENTS[0]
  return COVER_GRADIENTS[hashSeed(seed) % COVER_GRADIENTS.length]
}

/** Первая буква заголовка — крупная монограмма на обложке. */
export function coverInitial(title: string): string {
  const first = title.trim().charAt(0)
  return first ? first.toUpperCase() : '·'
}
