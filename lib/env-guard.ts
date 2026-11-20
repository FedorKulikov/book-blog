// lib/env-guard.ts
//
// Отсечение preview-развёртываний от привилегированных API.
//
// Layero может отдавать переменные окружения одного проекта и основному
// сайту, и превью веток. Если это так, то серверные секреты
// (SUPABASE_SERVICE_ROLE_KEY, RECOVERY_CODE_SECRET) окажутся доступны
// и на book-blog-dev.layero.app — а значит, оттуда можно дёргать
// /api/recovery/* с полными правами.
//
// Проверка намеренно узкая: блокируем только хосты Layero. Production-домен
// и localhost проходят, внутренние имена прокси — тоже (fail-open), чтобы
// переписывание заголовка Host на стороне платформы не сломало боевой сайт.
const PREVIEW_HOST_RE = /(^|\.)layero\.(app|ru)$/i

export function isPreviewRequest(request: Request): boolean {
  const candidates = [
    request.headers.get('x-forwarded-host'),
    request.headers.get('host'),
  ]

  return candidates.some(value => {
    if (!value) return false
    const host = value.split(':')[0].trim()
    return PREVIEW_HOST_RE.test(host)
  })
}
