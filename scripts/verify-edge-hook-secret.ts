// scripts/verify-edge-hook-secret.ts
//
// Read-only preflight: prove that the GitHub Actions AUTH_EMAIL_HOOK_SECRET
// matches the secret currently configured in the deployed auth-email-hook.
// Sends only a synthetic recovery event; it does not invoke Supabase Auth,
// create users, or send email. Never prints the secret or signature.

import { createHmac } from 'node:crypto'

const edgeFunctionsUrl = process.env.EDGE_FUNCTIONS_URL?.replace(/\/+$/, '') ?? ''
const secret = process.env.AUTH_EMAIL_HOOK_SECRET ?? ''

if (!edgeFunctionsUrl || !secret) {
  console.error('missing_preflight_configuration')
  process.exit(1)
}

function sign(id: string, timestamp: number, body: string): string {
  const withoutVersion = secret.startsWith('v1,') ? secret.slice(3) : secret
  const encodedKey = withoutVersion.startsWith('whsec_')
    ? withoutVersion.slice(6)
    : withoutVersion
  const key = Buffer.from(encodedKey, 'base64')

  return createHmac('sha256', key)
    .update(`${id}.${timestamp}.${body}`)
    .digest('base64')
}

async function main() {
  const id = `preflight_${Date.now()}`
  const timestamp = Math.floor(Date.now() / 1000)
  const body = JSON.stringify({
    user: { id: '00000000-0000-0000-0000-000000000000' },
    email_data: { email_action_type: 'recovery' },
  })

  let response: Response
  try {
    response = await fetch(`${edgeFunctionsUrl}/auth-email-hook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'webhook-id': id,
        'webhook-timestamp': String(timestamp),
        'webhook-signature': `v1,${sign(id, timestamp, body)}`,
      },
      body,
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    console.error('hook_secret_preflight_unreachable')
    process.exit(1)
  }

  if (response.status !== 200) {
    console.error(`hook_secret_preflight_failed_http_${response.status}`)
    process.exit(1)
  }

  const result = await response.text()
  if (result.trim() !== '{}') {
    console.error('hook_secret_preflight_unexpected_response')
    process.exit(1)
  }

  console.log('hook_secret_preflight: matched_existing_function_secret')
}

main().catch(() => {
  console.error('hook_secret_preflight_failed')
  process.exit(1)
})
