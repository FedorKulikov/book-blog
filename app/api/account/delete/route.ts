import { NextResponse } from 'next/server'
import { isPreviewRequest } from '@/lib/env-guard'
import {
  beginAccountDeletion,
  endAccountDeletion,
  executeAccountDeletion,
  inspectAccountDeletionBlockers,
  type ChatDeletionMode,
} from '@/lib/account-deletion'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { requiresMfaStepUp } from '@/lib/account-deletion-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }
const RECENT_AUTH_SECONDS = 5 * 60
const CONFIRMATION = 'УДАЛИТЬ АККАУНТ'

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE })
}

export async function POST(request: Request) {
  if (isPreviewRequest(request)) {
    return json({ error: 'Удаление аккаунта доступно только на основном сайте' }, 404)
  }

  const origin = request.headers.get('origin')
  let requestOrigin = ''
  try {
    requestOrigin = new URL(request.url).origin
  } catch {
    return json({ error: 'Некорректный запрос' }, 400)
  }

  if (!origin || origin !== requestOrigin) {
    return json({ error: 'Запрос отклонён' }, 403)
  }

  let body: Record<string, unknown>
  try {
    const value: unknown = await request.json()
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return json({ error: 'Некорректный запрос' }, 400)
    }
    body = value as Record<string, unknown>
  } catch {
    return json({ error: 'Некорректный запрос' }, 400)
  }

  if (body.confirmation !== CONFIRMATION) {
    return json({ error: 'Подтверждение удаления не совпадает' }, 400)
  }

  const chatMode = body.chatMode
  if (chatMode !== 'preserve' && chatMode !== 'delete_own_messages') {
    return json({ error: 'Не выбран режим обработки переписки' }, 400)
  }

  const userClient = await createSupabaseServerClient()
  const { data: userData, error: userError } = await userClient.auth.getUser()

  if (userError || !userData.user) {
    return json({ error: 'Требуется войти в аккаунт заново' }, 401)
  }

  // getClaims verifies the access token before auth_time is trusted. The UI
  // performs a password re-authentication immediately before this request.
  const { data: claimsData, error: claimsError } = await userClient.auth.getClaims()
  const authTime = Number(claimsData?.claims?.auth_time)
  const now = Math.floor(Date.now() / 1000)

  if (claimsError) {
    return json(
      { error: 'Не удалось проверить свежесть входа. Повторите аутентификацию.', code: 'RECENT_AUTH_REQUIRED' },
      403,
    )
  }

  const { data: assuranceData, error: assuranceError } =
    await userClient.auth.mfa.getAuthenticatorAssuranceLevel()

  if (assuranceError || !assuranceData) {
    return json(
      { error: 'Не удалось проверить второй фактор. Удаление временно недоступно.', code: 'MFA_CHECK_FAILED' },
      503,
    )
  }

  const isKnownAssuranceLevel = (value: unknown): value is 'aal1' | 'aal2' =>
    value === 'aal1' || value === 'aal2'

  if (
    !isKnownAssuranceLevel(assuranceData.currentLevel) ||
    !isKnownAssuranceLevel(assuranceData.nextLevel)
  ) {
    return json(
      { error: 'Supabase вернул неизвестный уровень аутентификации. Удаление остановлено.', code: 'MFA_CHECK_FAILED' },
      503,
    )
  }

  if (
    requiresMfaStepUp({
      currentLevel: assuranceData.currentLevel,
      nextLevel: assuranceData.nextLevel,
      jwtAssuranceLevel: claimsData?.claims?.aal as 'aal1' | 'aal2' | undefined,
    })
  ) {
    return json(
      { error: 'Для этого аккаунта требуется подтвердить второй фактор MFA.', code: 'MFA_REQUIRED' },
      403,
    )
  }

  if (
    !Number.isFinite(authTime) ||
    authTime <= 0 ||
    authTime > now + 30 ||
    now - authTime > RECENT_AUTH_SECONDS
  ) {
    return json(
      { error: 'Для удаления подтвердите пароль ещё раз', code: 'RECENT_AUTH_REQUIRED' },
      403,
    )
  }

  const admin = getAdminClient()
  if (!admin) {
    return json({ error: 'Сервис удаления временно недоступен' }, 503)
  }

  const userId = userData.user.id

  try {
    const lockedMode = await beginAccountDeletion(admin, userId, chatMode as ChatDeletionMode)
    if (lockedMode !== chatMode) {
      return json(
        {
          code: 'CHAT_MODE_LOCKED',
          requiredMode: lockedMode,
          error: 'Предыдущая попытка удаления началась в другом режиме переписки. Выбран прежний режим; повторите запрос.',
        },
        409,
      )
    }

    const blockers = await inspectAccountDeletionBlockers(admin, userId)
    if (blockers.length > 0) {
      // Blocked accounts remain fully usable. The lock is released only after
      // the no-change retention preflight has completed successfully.
      await endAccountDeletion(admin, userId)
      return json(
        {
          code: 'RETENTION_POLICY_REQUIRED',
          error: 'Сначала нужно решить, как сохранить связанные публикации и служебные записи.',
          blockers,
        },
        409,
      )
    }

    await executeAccountDeletion(admin, userId, chatMode as ChatDeletionMode)

    return json({
      ok: true,
      message: 'Аккаунт удалён',
    })
  } catch {
    // A lock is intentionally kept after an interrupted destructive attempt.
    // A retry uses the same lock and deterministic Storage paths; it must not
    // silently resume writes while cleanup is incomplete.
    console.error('[account-deletion] cleanup did not complete')
    return json(
      {
        code: 'DELETION_RETRY_REQUIRED',
        error:
          'Очистка не завершилась. Новые записи временно заблокированы. ' +
          'Повторите запрос с тем же режимом удаления; повторный запуск безопасен.',
      },
      503,
    )
  }
}
