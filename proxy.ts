// proxy.ts (корень проекта)
// В Next.js 16 файл `middleware.ts` объявлен устаревшим — его заменил `proxy.ts`
// (Next сам печатает deprecation-варнинг и предлагает кодмод).
// Здесь Next ищет экспорт `proxy` (или default).
//
// Две задачи:
//  1) обновлять сессию Supabase (getAccessToken живёт час — без продления
//     серверные компоненты начинали бы видеть анонима при живом пользователе);
//  2) защищать /admin на сервере: клиентская проверка роли обходится
//     прямым запросом и ничего не гарантирует.
import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import type { User } from '@supabase/supabase-js' // только тип, в бандл не тянет код

const ADMIN_PREFIX = '/admin'

function isAdminRoute(pathname: string): boolean {
  return pathname === ADMIN_PREFIX || pathname.startsWith(`${ADMIN_PREFIX}/`)
}

/**
 * Редирект, который переносит в ответ свежие куки сессии.
 * Без этого обновлённый в этом же проходе токен терялся бы: браузер получил бы
 * redirect без Set-Cookie и остался со старым (или без) токеном.
 */
function redirectWithCookies(
  to: string,
  request: NextRequest,
  from: NextResponse,
): NextResponse {
  const url = new URL(to, request.url)
  const redirectResponse = NextResponse.redirect(url)

  for (const cookie of from.cookies.getAll()) {
    redirectResponse.cookies.set(cookie)
  }

  return redirectResponse
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const adminRoute = isAdminRoute(pathname)

  let response = NextResponse.next({ request })

  // Оптимизация: у анонимного читателя куки сессии нет вообще. Не создаём клиент
  // и не делаем сетевой запрос в Auth — иначе каждый просмотр гостем (а это
  // основная доля трафика блога) платил бы за лишний round-trip.
  const hasAuthCookie = request.cookies
    .getAll()
    .some(({ name }) => name.includes('-auth-token'))

  if (!hasAuthCookie) {
    // Гость на /admin уходит на логин сразу: ни клиента, ни запроса к БД.
    // (Пускать его на страницу «чтобы сработала клиентская проверка» — лишний
    // рендер админки в HTML плюс круг до Auth; редирект и безопаснее, и дешевле.)
    if (adminRoute) return NextResponse.redirect(new URL('/login', request.url))
    return response
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('[proxy] нет env для Supabase — сессия не обновится')
    // Fail closed: без конфигурации /admin открывать нельзя
    return adminRoute ? NextResponse.redirect(new URL('/', request.url)) : response
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        // 1) обновляем куки в запросе, чтобы их увидели серверные компоненты
        //    этого же прохода;
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value)
        }
        // 2) пересоздаём ответ и проставляем куки уже в него — они уйдут в браузер.
        response = NextResponse.next({ request })
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options)
        }
      },
    },
  })

  // ВАЖНО: именно getUser(), а не getSession().
  // getSession() лишь читает куку и может вернуть протухший токен;
  // getUser() ходит в Auth-сервер, валидирует токен и заодно продлевает сессию.
  //
  // try/catch обязателен: proxy.ts стоит перед ВСЕМИ страницами, и если Auth
  // недоступен (сеть/авария), необёрнутая ошибка уронит весь сайт в 500.
  let user: User | null = null

  try {
    const { data } = await supabase.auth.getUser()
    user = data.user
  } catch (error) {
    console.error(
      '[proxy] не удалось обновить сессию:',
      error instanceof Error ? error.message : error,
    )
    // Fail closed: не смогли проверить пользователя — в /admin не пускаем
    if (adminRoute) return redirectWithCookies('/', request, response)
    return response
  }

  // ---- Защита /admin (только для этих маршрутов, чтобы не тратить запрос к БД) ----
  if (!adminRoute) return response

  if (!user) {
    // Кука есть, но токен невалиден/просрочен — как аноним
    return redirectWithCookies('/login', request, response)
  }

  const { data: profile, error: roleError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  if (roleError) {
    console.error('[proxy] не удалось прочитать роль:', roleError.message)
    // Не знаем роль — не пускаем (иначе ошибка БД = открытая админка)
    return redirectWithCookies('/', request, response)
  }

  const role = (profile as { role: string | null } | null)?.role
  const isStaff = role === 'admin' || role === 'moderator'

  if (!isStaff) {
    console.warn('[proxy] отказ в доступе к /admin для роли:', role ?? 'нет профиля')
    return redirectWithCookies('/', request, response)
  }

  return response
}

export const config = {
  // Пропускаем только «живые» страницы и API.
  // Статика (/_next/static, /_next/image), картинки, шрифты, sitemap.xml,
  // robots.txt и файлы верификации *.html сессию не требуют — их не трогаем,
  // иначе зря тратим миллисекунды на каждый ассет.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|css|js|map|txt|xml|html|woff|woff2|ttf)$).*)',
  ],
}
