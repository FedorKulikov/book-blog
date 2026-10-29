// lib/supabase/server.ts
// Клиент Supabase для Server Components / generateMetadata / route handlers.
// Читает куки текущего запроса, поэтому запросы к базе идут ОТ ИМЕНИ пользователя
// и RLS отдаёт ровно то, что ему разрешено (в т.ч. свой пост на модерации).
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Внимание: в Next.js 15/16 `cookies()` асинхронная — обязательно await.
 * Клиент создаётся на каждый вызов (он лёгкий), но благодаря cache() в getPost
 * за один запрос он создаётся один раз.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Не заданы NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY (см. .env.local)',
    )
  }

  const cookieStore = await cookies()

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options)
          }
        } catch {
          // Ожидаемый путь, а не ошибка: в Server Component писать куки нельзя
          // (они read-only). Продлением сессии занимается proxy.ts.
          // Этот try/catch обязателен — без него страница упадёт при первом
          // автоматическом обновлении токена во время рендера.
        }
      },
    },
  })
}
