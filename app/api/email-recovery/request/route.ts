import { NextResponse } from 'next/server'
import { isPreviewRequest } from '@/lib/env-guard'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'
import {
  EMAIL_RECOVERY_TOKEN_TTL_MINUTES,
  buildEmailVerificationUrl,
  escapeEmailHtml,
  generateEmailRecoveryToken,
  getAuthEmailSiteUrl,
  getEmailRecoverySecret,
  hashEmailForRecovery,
  isEmailRecoveryConfigured,
  sendEmailViaResend,
} from '@/lib/email-recovery'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

export async function POST(request: Request) {
  if (isPreviewRequest(request)) {
    return json({ error: 'not_available_on_preview' }, 404)
  }

  if (!isEmailRecoveryConfigured()) {
    return json({ error: 'Подтверждение email пока не настроено' }, 503)
  }

  const expectedOrigin = getAuthEmailSiteUrl()
  if (request.headers.get('origin') !== expectedOrigin) {
    return json({ error: 'Запрос отклонён' }, 403)
  }

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return json({ error: 'Требуется вход в аккаунт' }, 401)
  if (!user.email) return json({ error: 'У аккаунта нет email' }, 400)

  const admin = getAdminClient()
  const secret = getEmailRecoverySecret()

  if (!admin || !secret) {
    return json({ error: 'Подтверждение email пока недоступно' }, 503)
  }

  const token = generateEmailRecoveryToken(secret)
  const emailHash = hashEmailForRecovery(user.email, secret)
  const expiresAt = new Date(
    Date.now() + EMAIL_RECOVERY_TOKEN_TTL_MINUTES * 60 * 1000,
  ).toISOString()

  const { data: issued, error: issueError } = await admin.rpc(
    'issue_email_recovery_token',
    {
      p_user_id: user.id,
      p_email_hash: emailHash,
      p_token_hash: token.tokenHash,
      p_expires_at: expiresAt,
    },
  )

  if (issueError) {
    console.error('[email-recovery] token issuance failed')
    return json({ error: 'Не удалось подготовить письмо. Попробуйте позже.' }, 503)
  }

  if (issued !== true) {
    return json(
      { error: 'Письмо уже запрашивали недавно. Повторите попытку через минуту.' },
      429,
    )
  }

  let verificationUrl: string
  try {
    verificationUrl = buildEmailVerificationUrl(getAuthEmailSiteUrl(), token.token)
  } catch {
    return json({ error: 'Адрес подтверждения email настроен неверно' }, 503)
  }

  const safeUrl = escapeEmailHtml(verificationUrl)
  const expiresText = `${EMAIL_RECOVERY_TOKEN_TTL_MINUTES} минут`

  try {
    await sendEmailViaResend({
      to: user.email,
      subject: 'Подтвердите email для восстановления аккаунта',
      html: [
        '<!doctype html><html lang="ru"><body>',
        '<h2>Подтверждение email</h2>',
        '<p>Вы запросили подтверждение адреса для восстановления аккаунта «Хлеба и букв».</p>',
        `<p><a href="${safeUrl}">Подтвердить email</a></p>`,
        `<p>Ссылка действует ${expiresText}. Если это были не вы, просто проигнорируйте письмо.</p>`,
        '</body></html>',
      ].join(''),
      text: [
        'Подтверждение email для восстановления аккаунта «Хлеба и букв».',
        verificationUrl,
        `Ссылка действует ${expiresText}.`,
        'Если это были не вы, проигнорируйте письмо.',
      ].join('\n\n'),
      idempotencyKey: `email-recovery-verify/${user.id}/${token.tokenHash.slice(0, 20)}`,
    })
  } catch {
    console.error('[email-recovery] verification email delivery failed')
    return json(
      { error: 'Не удалось отправить письмо. Проверьте настройки почты или попробуйте позже.' },
      502,
    )
  }

  return json({ ok: true })
}
