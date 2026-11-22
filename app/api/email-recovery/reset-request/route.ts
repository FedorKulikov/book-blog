import { NextResponse } from 'next/server'
import { isPreviewRequest } from '@/lib/env-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NEUTRAL_RESPONSE = { ok: true }

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

/**
 * Email password-reset links are intentionally disabled.
 *
 * Keep this route as a neutral compatibility endpoint so stale clients do
 * not learn whether an account or verified mailbox exists. It performs no
 * account lookup, creates no Auth recovery token, and sends no email.
 * Password recovery remains available through backup codes and passkeys.
 */
export async function POST(request: Request) {
  if (isPreviewRequest(request)) {
    return json({ error: 'not_available_on_preview' }, 404)
  }

  return json(NEUTRAL_RESPONSE)
}
