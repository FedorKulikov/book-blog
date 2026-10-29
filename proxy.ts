// proxy.ts (корень проекта)
// В Next.js 16 файл `middleware.ts` объявлен устаревшим — его заменил `proxy.ts`
// (Next сам печатает deprecation-варнинг и предлагает кодмод).
// Здесь Next ищет экспорт `proxy` (или default).
//
// Задача proxy.ts — ТОЛЬКО обновлять сессию Supabase: getAccessToken становится
// протухшим через час, и если его не продлевать, серверные компоненты начнут
// видеть анонима при живом пользователе. Никакой защиты роутов здесь нет.
import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  // Оптимизация: у анонимного читателя куки сессии нет вообще. Не создаём клиент
  // и не делаем сетевой запрос в Auth — иначе каждый просмотр гостем (а это
  // основная доля трафика блога) платил бы за лишний round-trip.
  const hasAuthCookie = request.cookies
    .getAll()
    .some(({ name }) => name.includes('-auth-token'))

  if (!hasAuthCookie) return response

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('[proxy] нет env для Supabase — сессия не обновится')
    return response
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
  // Правильное поведение — отдать страницу как анониму и записать в лог.
  try {
    await supabase.auth.getUser()
  } catch (error) {
    console.error(
      '[proxy] не удалось обновить сессию:',
      error instanceof Error ? error.message : error,
    )
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
