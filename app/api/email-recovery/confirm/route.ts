import { NextResponse } from 'next/server'
import { isPreviewRequest } from '@/lib/env-guard'
import { getAdminClient } from '@/lib/supabase/admin'
import {
  emailRecoveryHmac,
  getEmailRecoverySecret,
  isEmailRecoveryConfigured,
  isValidEmailRecoveryToken,
} from '@/lib/email-recovery'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function redirectToProfile(request: Request, result: 'verified' | 'invalid') {
  const target = new URL('/profile/edit', request.url)
  target.searchParams.set('emailRecovery', result)

  return NextResponse.redirect(target, {
    status: 303,
    headers: {
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  })
}

export async function GET(request: Request) {
  if (isPreviewRequest(request)) {
    return new NextResponse('not_available_on_preview', {
      status: 404,
      headers: { 'Cache-Control': 'no-store' },
    })
  }

  if (!isEmailRecoveryConfigured()) {
    return redirectToProfile(request, 'invalid')
  }

  const token = new URL(request.url).searchParams.get('token') ?? ''
  if (!isValidEmailRecoveryToken(token)) {
    return redirectToProfile(request, 'invalid')
  }

  const admin = getAdminClient()
  const secret = getEmailRecoverySecret()

  if (!admin || !secret) return redirectToProfile(request, 'invalid')

  const { data, error } = await admin.rpc('consume_email_recovery_token', {
    p_token_hash: emailRecoveryHmac(token, secret),
  })

  if (error) {
    console.error('[email-recovery] token confirmation failed')
    return redirectToProfile(request, 'invalid')
  }

  return redirectToProfile(request, data === true ? 'verified' : 'invalid')
}
