import type { SupabaseClient } from '@supabase/supabase-js'

type CurrentProfile = {
  username: string
  bio: string | null
  avatar_url: string | null
}

export type UpdateProfileInput = {
  username: unknown
  bio: unknown
  avatarUrl: unknown
  notificationsMuted: unknown
}

export type UpdateProfileResult = {
  status: number
  body: { ok: true } | { error: string }
}

type ConsentRow = {
  scope: string
  document_version: string
  data_categories: string[]
  granted_at: string
  revoked_at: string | null
}

function belongsToOwnAvatarBucket(
  value: string,
  verifiedUserId: string,
  supabaseUrl: string,
): boolean {
  try {
    const base = new URL(supabaseUrl)
    const avatar = new URL(value)
    const ownPath = `/storage/v1/object/public/avatars/${verifiedUserId}/`

    return avatar.origin === base.origin &&
      avatar.pathname.startsWith(ownPath) &&
      avatar.search === '' &&
      avatar.hash === ''
  } catch {
    return false
  }
}

/**
 * This function is called only after the route verifies auth.getUser().
 * It never accepts or reads a user_id from the request body.
 *
 * Private preferences can be saved without a profile_public grant. The
 * notifications_muted value is obtained from the auth.uid()-scoped RPC,
 * not the public profiles table. Public-field changes require an active grant.
 */
export async function updateProfileWithConsent(
  supabase: SupabaseClient,
  verifiedUserId: string,
  input: UpdateProfileInput,
  supabaseUrl: string,
): Promise<UpdateProfileResult> {
  const username = typeof input.username === 'string' ? input.username.trim() : ''
  const bio =
    input.bio === null
      ? null
      : typeof input.bio === 'string'
        ? input.bio.trim() || null
        : undefined
  const avatarUrl =
    input.avatarUrl === null || typeof input.avatarUrl === 'string'
      ? input.avatarUrl
      : undefined
  const notificationsMuted = input.notificationsMuted

  if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
    return { status: 422, body: { error: 'Имя пользователя: от 3 до 30 символов, только латиница, цифры и подчёркивание.' } }
  }
  if (bio === undefined || (bio !== null && bio.length > 300)) {
    return { status: 422, body: { error: 'Описание профиля должно быть не длиннее 300 символов.' } }
  }
  if (avatarUrl === undefined) {
    return { status: 422, body: { error: 'Некорректное значение аватара.' } }
  }
  if (typeof notificationsMuted !== 'boolean') {
    return { status: 422, body: { error: 'Некорректная настройка уведомлений.' } }
  }

  const [
    { data: current, error: readError },
    { data: currentNotificationsMuted, error: settingsError },
  ] = await Promise.all([
    supabase
      .from('profiles')
      .select('username, bio, avatar_url')
      .eq('id', verifiedUserId)
      .single(),
    supabase.rpc('my_profile_notification_settings'),
  ])

  if (readError || !current) {
    return {
      status: readError?.code === 'PGRST116' ? 404 : 503,
      body: { error: 'Не удалось загрузить текущие настройки профиля. Попробуйте ещё раз.' },
    }
  }

  if (settingsError || typeof currentNotificationsMuted !== 'boolean') {
    return {
      status: 503,
      body: { error: 'Не удалось загрузить приватную настройку уведомлений. Изменения не сохранены.' },
    }
  }

  const profile = current as unknown as CurrentProfile
  const usernameChanged = username !== profile.username
  const bioChanged = bio !== profile.bio
  const avatarChanged = avatarUrl !== profile.avatar_url
  const publicFieldsChanged = usernameChanged || bioChanged || avatarChanged
  const notificationsChanged = notificationsMuted !== currentNotificationsMuted

  if (avatarChanged && avatarUrl !== null &&
      !belongsToOwnAvatarBucket(avatarUrl, verifiedUserId, supabaseUrl)) {
    return { status: 422, body: { error: 'Можно использовать только аватар, загруженный в свой раздел хранилища сайта.' } }
  }

  if (publicFieldsChanged) {
    const { data: consentRows, error: consentError } = await supabase.rpc('my_distribution_consents')

    if (consentError || !Array.isArray(consentRows)) {
      return {
        status: 503,
        body: { error: 'Не удалось проверить согласие на распространение данных профиля. Изменения не сохранены.' },
      }
    }

    const hasActiveConsent = (consentRows as ConsentRow[]).some(row =>
      row.scope === 'profile_public' && row.revoked_at === null,
    )

    if (!hasActiveConsent) {
      return {
        status: 422,
        body: {
          error: 'Чтобы изменить имя, описание или аватар публичного профиля, сначала дайте отдельное согласие на их распространение. Отметьте пункт согласия ниже.',
        },
      }
    }
  }

  const updates: Record<string, string | boolean | null> = {}
  if (usernameChanged) updates.username = username
  if (bioChanged) updates.bio = bio
  if (avatarChanged) updates.avatar_url = avatarUrl
  if (notificationsChanged) updates.notifications_muted = notificationsMuted

  if (Object.keys(updates).length === 0) {
    return { status: 200, body: { ok: true } }
  }

  const { error: updateError } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', verifiedUserId)

  if (updateError) {
    if (updateError.code === '23505') {
      return { status: 422, body: { error: 'Это имя уже занято. Попробуйте другое.' } }
    }
    if (updateError.code === '42501') {
      return {
        status: 422,
        body: { error: 'Изменение публичных полей отклонено: требуется активное согласие на распространение данных профиля.' },
      }
    }
    return { status: 500, body: { error: 'Не удалось сохранить профиль. Попробуйте ещё раз.' } }
  }

  return { status: 200, body: { ok: true } }
}
