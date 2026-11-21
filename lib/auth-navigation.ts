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
    return `${target.pathname}${target.search}${target.hash}`
  } catch {
    return '/'
  }
}

export function getPostAuthPath(search: string): string {
  const params = new URLSearchParams(search)
  const next = params.get('next')
  return next ? safeInternalPath(next) : '/welcome'
}
