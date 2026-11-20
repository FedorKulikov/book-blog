// lib/supabase/admin.ts
//
// Клиент с ключом service_role — только для серверных маршрутов.
//
// Правила, которые нельзя нарушать:
//   • ключ берётся из SUPABASE_SERVICE_ROLE_KEY, без префикса NEXT_PUBLIC_;
//   • модуль импортируется только из route handlers / серверного кода;
//   • при отсутствии ключа возвращаем null, а маршрут отвечает 503 —
//     никаких «обходных» путей без прав.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let cached: SupabaseClient | null = null

export function getAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) return null
  if (cached) return cached

  cached = createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })

  return cached
}
