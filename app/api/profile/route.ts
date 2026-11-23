import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { updateProfileWithConsent, type UpdateProfileInput } from '@/lib/profile-consent-server'

export const dynamic = 'force-dynamic'

export async function PATCH(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.auth.getUser()

  if (error || !data.user) {
    return NextResponse.json(
      { error: 'Для редактирования профиля необходимо войти в аккаунт.' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'Не удалось прочитать данные профиля.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json(
      { error: 'Некорректные данные профиля.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const result = await updateProfileWithConsent(
    supabase,
    data.user.id,
    body as UpdateProfileInput,
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  )

  return NextResponse.json(result.body, {
    status: result.status,
    headers: { 'Cache-Control': 'no-store' },
  })
}
