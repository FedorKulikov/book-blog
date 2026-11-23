import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  DISTRIBUTION_CONSENT_VERSION,
  PROFILE_PUBLIC_CONSENT_CATEGORIES,
} from '@/lib/distribution-consent'

type ConsentRow = {
  scope: string
  document_version: string
  data_categories: string[]
  granted_at: string
  revoked_at: string | null
}

export const dynamic = 'force-dynamic'

function latestActiveProfileConsent(rows: ConsentRow[]): ConsentRow | null {
  return rows
    .filter(row => row.scope === 'profile_public' && row.revoked_at === null)
    .sort((a, b) => Date.parse(b.granted_at) - Date.parse(a.granted_at))[0] ?? null
}

export async function POST() {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.auth.getUser()

  if (error || !data.user) {
    return NextResponse.json(
      { error: 'Для согласия на распространение данных профиля необходимо войти в аккаунт.' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  // An existing active grant is enough; do not create duplicate audit rows.
  const { data: existingRows, error: readError } = await supabase.rpc('my_distribution_consents')
  if (readError || !Array.isArray(existingRows)) {
    return NextResponse.json(
      { error: 'Не удалось проверить историю согласий. Попробуйте ещё раз.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const existing = latestActiveProfileConsent(existingRows as ConsentRow[])
  if (existing) {
    return NextResponse.json(
      { active: true, grantedAt: existing.granted_at, documentVersion: existing.document_version },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  }

  // No user_id or caller-supplied categories/version: all values are fixed here,
  // while the RPC derives the only permitted owner from auth.uid().
  const { data: consentId, error: recordError } = await supabase.rpc(
    'record_my_distribution_consent',
    {
      p_scope: 'profile_public',
      p_data_categories: [...PROFILE_PUBLIC_CONSENT_CATEGORIES],
      p_document_version: DISTRIBUTION_CONSENT_VERSION,
    },
  )

  if (recordError || !consentId) {
    return NextResponse.json(
      { error: 'Не удалось записать согласие. Публичные поля профиля пока не изменены.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const { data: updatedRows, error: updatedReadError } = await supabase.rpc('my_distribution_consents')
  if (updatedReadError || !Array.isArray(updatedRows)) {
    return NextResponse.json(
      { error: 'Согласие записано, но не удалось перечитать его дату. Обновите страницу.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const created = latestActiveProfileConsent(updatedRows as ConsentRow[])
  return NextResponse.json(
    {
      active: true,
      grantedAt: created?.granted_at ?? new Date().toISOString(),
      documentVersion: created?.document_version ?? DISTRIBUTION_CONSENT_VERSION,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
