/**
 * scripts/check-covers.ts
 *
 * Быстрая диагностика обложек внешних новостей: что реально лежит в базе.
 *
 * Запуск:
 *   npx tsx scripts/check-covers.ts            # последние 10 записей
 *   npx tsx scripts/check-covers.ts 30         # последние 30
 *
 * Нужны SUPABASE_URL (или NEXT_PUBLIC_SUPABASE_URL) и любой ключ:
 * для чтения достаточно anon, service_role не требуется.
 */
import { createClient } from '@supabase/supabase-js'

const LIMIT = Number(process.argv[2] ?? '10')

const url =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  ''

type Row = {
  id: string
  title: string
  source: string
  cover_url: string | null
  news_type: string | null
  created_at: string
}

async function main(): Promise<void> {
  if (!url || !key) {
    throw new Error(
      'не заданы SUPABASE_URL (или NEXT_PUBLIC_SUPABASE_URL) и ключ Supabase',
    )
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data, error } = await supabase
    .from('external_news')
    .select('id, title, source, cover_url, news_type, created_at')
    .order('created_at', { ascending: false })
    .limit(LIMIT)

  if (error) {
    throw new Error(`не удалось прочитать external_news: ${error.message}`)
  }

  const rows = (data ?? []) as unknown as Row[]

  console.log(`последние ${rows.length} записей external_news:\n`)

  for (const row of rows) {
    const cover = row.cover_url ?? 'нет'
    console.log(`  ${row.id}`)
    console.log(`    title:  ${row.title.slice(0, 70)}`)
    console.log(`    source: ${row.source} | тип: ${row.news_type ?? '—'}`)
    console.log(`    cover:  ${cover}`)
    console.log(`    дата:   ${row.created_at}`)
  }

  // Сводка, чтобы сразу видеть масштаб проблемы
  const withCover = rows.filter(row => row.cover_url)
  console.log(
    `\nитог по выборке: с обложкой ${withCover.length} из ${rows.length}`,
  )

  const { count: total } = await supabase
    .from('external_news')
    .select('id', { count: 'exact', head: true })

  const { count: withCoverTotal } = await supabase
    .from('external_news')
    .select('id', { count: 'exact', head: true })
    .not('cover_url', 'is', null)

  console.log(
    `итог по всей таблице: с обложкой ${withCoverTotal ?? 0} из ${total ?? 0}`,
  )
}

main().catch((error: unknown) => {
  console.error(
    '[check-covers] ОШИБКА:',
    error instanceof Error ? error.message : error,
  )
  process.exitCode = 1
})
