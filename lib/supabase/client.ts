// lib/supabase/client.ts
// Клиент Supabase для браузера. Сессия хранится в КУКАХ, а не в localStorage —
// именно поэтому серверные компоненты (и RLS) смогут её прочитать.
import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Не заданы NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY (см. .env.local)',
  )
}

// В браузере createBrowserClient сам кэширует инстанс (синглтон),
// поэтому модульная константа не плодит лишних клиентов и подписок.
// На сервере (во время SSR клиентских компонентов) он безопасен:
// при отсутствии document cookie-storage подменяется на память.
export const supabase: SupabaseClient = createBrowserClient(
  supabaseUrl,
  supabaseAnonKey,
)
