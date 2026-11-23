import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

type ConsentRow = {
  scope: string
  document_version: string
  granted_at: string
  revoked_at: string | null
}

type LegacyState = {
  has_approved_posts: boolean
  has_legacy_profile: boolean
  legacy_choice: 'granted' | 'hidden' | null
}

export const dynamic = 'force-dynamic'

function latestActiveConsent(rows: ConsentRow[], scope: string): ConsentRow | null {
  return rows
    .filter(row => row.scope === scope && row.revoked_at === null)
    .sort((a, b) => Date.parse(b.granted_at) - Date.parse(a.granted_at))[0] ?? null
}

export async function POST() {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.auth.getUser()

  if (error || !data.user) {
    return NextResponse.json(
      { error: 'Для восстановления ранее скрытых материалов необходимо войти в аккаунт.' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  // No body or user ID is accepted from the client. The authenticated server
  // client invokes a self-scoped RPC that derives the owner from auth.uid().
  const { data: restored, error: restoreError } = await supabase.rpc(
    'restore_my_hidden_legacy_distribution',
  )

  if (restoreError || !restored || restored.restored !== true) {
    const notRestorable = restoreError?.code === '22023' || restoreError?.code === 'P0002'
    return NextResponse.json(
      { error: notRestorable
        ? 'Нет материалов, которые можно вернуть, либо они уже не находятся в скрытом состоянии.'
        : 'Не удалось восстановить материалы. Ничего не изменено; попробуйте ещё раз.' },
      { status: notRestorable ? 409 : 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const [
    { data: consentRows, error: consentError },
    { data: legacyRows, error: legacyError },
  ] = await Promise.all([
    supabase.rpc('my_distribution_consents'),
    supabase.rpc('my_legacy_distribution_prompt_state'),
  ])

  if (consentError || !Array.isArray(consentRows) || legacyError || !Array.isArray(legacyRows)) {
    return NextResponse.json(
      { error: 'Материалы возвращены, но не удалось перечитать подтверждение. Обновите страницу.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const rows = consentRows as ConsentRow[]
  const state = legacyRows[0] as LegacyState | undefined
  if (!state || state.legacy_choice !== 'granted') {
    return NextResponse.json(
      { error: 'Не удалось подтвердить новое состояние материалов. Обновите страницу.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const publication = latestActiveConsent(rows, 'publication')
  const profilePublic = latestActiveConsent(rows, 'profile_public')
  if ((state.has_approved_posts && !publication) || (state.has_legacy_profile && !profilePublic)) {
    return NextResponse.json(
      { error: 'Не удалось подтвердить необходимые записи согласия. Обновите страницу.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  return NextResponse.json(
    {
      restored: true,
      legacyChoice: state.legacy_choice,
      publicationGrantedAt: publication?.granted_at ?? null,
      profilePublicGrantedAt: profilePublic?.granted_at ?? null,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
