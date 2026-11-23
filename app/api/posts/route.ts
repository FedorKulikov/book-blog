import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createPostWithDistributionConsent, type CreatePostBody } from '@/lib/distribution-consent-server'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.auth.getUser()

  if (error || !data.user) {
    return NextResponse.json(
      { error: 'Для публикации необходимо войти в аккаунт.' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'Не удалось прочитать данные публикации.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json(
      { error: 'Некорректные данные публикации.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const result = await createPostWithDistributionConsent(
    supabase,
    data.user.id,
    body as CreatePostBody,
  )

  return NextResponse.json(result.body, {
    status: result.status,
    headers: { 'Cache-Control': 'no-store' },
  })
}
