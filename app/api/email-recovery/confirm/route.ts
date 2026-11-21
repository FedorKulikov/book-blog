import { NextResponse } from 'next/server'
import { isPreviewRequest } from '@/lib/env-guard'
import { getAdminClient } from '@/lib/supabase/admin'
import {
  emailRecoveryHmac,
  getAuthEmailSiteUrl,
  getEmailRecoverySecret,
  isEmailRecoveryConfigured,
  isValidEmailRecoveryToken,
} from '@/lib/email-recovery'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
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

  let token = ''
  try {
    const body: unknown = await request.json()
    if (body && typeof body === 'object') {
      const candidate = (body as Record<string, unknown>).token
      if (typeof candidate === 'string') token = candidate
    }
  } catch {
    return json({ error: 'Некорректный запрос' }, 400)
  }

  if (!isValidEmailRecoveryToken(token)) {
    return json({ error: 'Ссылка недействительна или устарела' }, 400)
  }

  const admin = getAdminClient()
  const secret = getEmailRecoverySecret()

  if (!admin || !secret) {
    return json({ error: 'Подтверждение email временно недоступно' }, 503)
  }

  const { data, error } = await admin.rpc('consume_email_recovery_token', {
    p_token_hash: emailRecoveryHmac(token, secret),
  })

  if (error) {
    console.error('[email-recovery] token confirmation failed')
    return json({ error: 'Не удалось подтвердить email' }, 503)
  }

  if (data !== true) {
    return json({ error: 'Ссылка недействительна, уже использована или устарела' }, 400)
  }

  return json({ ok: true })
}
