// lib/text.ts
// Общая обработка текста для мета-тегов и превью в карточках.
// Раньше эти функции были продублированы в PostCard.tsx и post/[id]/layout.tsx —
// правка в одном месте не доезжала до другого.

/**
 * Markdown → плоский текст.
 * Мета-теги и карточки ленты разметку не рендерят, поэтому «**жирный**»,
 * «# Заголовок», «[текст](url)» и блоки кода там выглядят как мусор.
 */
export function toPlainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ') // блоки кода
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // ![alt](url)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // [текст](url) → текст
    .replace(/<[^>]*>/g, ' ') // html-теги
    .replace(/^#{1,6}\s+/gm, '') // заголовки
    .replace(/^\s*[-+*]\s+/gm, '') // списки
    .replace(/[*_~>`]+/g, '') // выделения, цитаты, инлайн-код
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Обрезка по границе слова, без висящих запятых и тире.
 * Если места до лимита мало (меньше 60% занимает последнее слово),
 * режем по самому лимиту — иначе получим одно слово и многоточие.
 */
export function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text

  const cut = text.slice(0, limit)
  const lastSpace = cut.lastIndexOf(' ')
  const safe = lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut

  return `${safe.replace(/[\s,.;:—–-]+$/u, '')}…`
}

/**
 * Обёртка «превью в N символов»: очистить markdown и обрезать.
 * Нужна там, где лимит задаётся в одном месте (например, og:description).
 */
export function toPlainTextWithLimit(markdown: string, limit: number): string {
  return truncate(toPlainText(markdown), limit)
}
