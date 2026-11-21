// lib/auth-navigation.ts
//
// Принимаем только относительный путь внутри текущего сайта.
// Это не позволяет использовать параметр next для внешнего open redirect.
export function safeInternalPath(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return '/'
  }

  try {
    const target = new URL(value, 'https://internal.invalid')
    if (target.origin !== 'https://internal.invalid') return '/'

    const output = `${target.pathname}${target.search}${target.hash}`
    // URL нормализует сегменты пути и обратные слеши. Проверяем именно
    // результат нормализации: он тоже не должен стать protocol-relative URL.
    const decodedPath = decodeURIComponent(target.pathname)
    if (
      !output.startsWith('/') ||
      output.startsWith('//') ||
      output.startsWith('/\\') ||
      decodedPath.startsWith('//') ||
      decodedPath.startsWith('/\\')
    ) {
      return '/'
    }

    return output
  } catch {
    return '/'
  }
}

export function getPostAuthPath(search: string): string {
  const params = new URLSearchParams(search)
  const next = params.get('next')
  if (!next) return '/welcome'

  const destination = safeInternalPath(next)
  const pathname = new URL(destination, 'https://internal.invalid').pathname.replace(/\\/+$/, '') || '/'
  const authOnlyPaths = new Set([
    '/login',
    '/signup',
    '/forgot-password',
    '/recover-account',
  ])

  // После успешной авторизации нельзя возвращать пользователя на экран,
  // который снова требует авторизацию или начинает recovery-flow.
  if (authOnlyPaths.has(pathname) || pathname.startsWith('/auth/')) {
    return '/welcome'
  }

  return destination
}
