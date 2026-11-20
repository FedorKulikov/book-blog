// lib/site.ts
//
// Канонический адрес сайта — один источник правды для metadataBase,
// sitemap и robots.
//
// Тонкость: NEXT_PUBLIC_SITE_URL на платформе может указывать на превью
// Layero вида book-blog-main.layero.app. Такое значение отдавать поисковикам
// нельзя: Layero помечает превью заголовком X-Robots-Tag: noindex, и карта
// сайта со ссылками на него только вредит. Поэтому превью-хост игнорируем
// и всегда считаем боевым доменом bukleb.ru.
//
// Любое другое значение переменной (реальный домен) используется как есть.

const FALLBACK = 'https://bukleb.ru'

/** Хост Layero — превью и основной адрес платформы, для канонических ссылок не годится */
const PLATFORM_HOST_RE = /(^|\.)layero\.(app|ru)$/i

function resolveSiteUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_SITE_URL ?? '').trim()
  if (!raw) return FALLBACK

  try {
    if (PLATFORM_HOST_RE.test(new URL(raw).hostname)) return FALLBACK
  } catch {
    return FALLBACK
  }

  return raw.replace(/\/+$/, '')
}

/** Канонический адрес без завершающего слэша */
export const SITE_URL = resolveSiteUrl()

/** Абсолютная ссылка от корня сайта: siteUrl('/news') → https://bukleb.ru/news */
export function siteUrl(path = '/'): string {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `${SITE_URL}${normalized}`
}