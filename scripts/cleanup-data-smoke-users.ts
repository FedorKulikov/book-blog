import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  assertNoForeignContentWouldBeCascadeDeleted,
  getAuthUsersByIds,
  cleanupSmokeUsers,
  getDataSmokeInventory,
  listDataSmokeUsers,
  verifySmokeCleanup,
} from './lib/data-smoke-cleanup'
import { SMOKE_ACCOUNT_EMAIL_PREFIXES } from './lib/smoke-account-config'

const URL = process.env.SUPABASE_URL ?? ''
const SECRET = process.env.SUPABASE_SECRET_KEY ?? ''

for (const [name, value] of Object.entries({
  SUPABASE_URL: URL,
  SUPABASE_SECRET_KEY: SECRET,
})) {
  if (!value) throw new Error(`missing environment variable: ${name}`)
}

const deleteRequested = process.argv.includes('--delete')
const dryRunRequested = process.argv.includes('--dry-run')
const verifyRequested = process.argv.includes('--verify-manifest')
const manifestFlag = process.argv.indexOf('--manifest')
const manifestPath = manifestFlag >= 0 ? process.argv[manifestFlag + 1] : undefined
if (manifestFlag >= 0 && (!manifestPath || manifestPath.startsWith('--'))) {
  throw new Error('--manifest requires a JSON file path')
}
if ([deleteRequested, dryRunRequested, verifyRequested].filter(Boolean).length !== 1) {
  throw new Error('pass exactly one mode: --dry-run, --delete or --verify-manifest')
}

const INVENTORY_FIELDS = [
  'profiles',
  'posts',
  'books',
  'reports',
  'notifications',
  'consents',
  'active_consents',
  'revoked_consents',
  'storage_objects',
  'external_news',
  'conversations',
  'messages',
  'comments',
  'likes',
  'bookmarks',
  'follows',
  'tickets',
  'ticket_messages',
  'post_images',
] as const

function apiKeyOnlyFetch(key: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers)
    if (headers.get('authorization') === 'Bearer ' + key) headers.delete('authorization')
    return fetch(input, { ...init, headers })
  }
}

async function main() {
  const admin = createClient(URL, SECRET, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: apiKeyOnlyFetch(SECRET) },
  })
  const discoveredUsers = await listDataSmokeUsers(admin)
  let users = discoveredUsers

  if (manifestPath) {
    if (!deleteRequested && !verifyRequested) throw new Error('--manifest is accepted only with --delete or --verify-manifest')
    const manifest = JSON.parse(readFileSync(resolve(process.cwd(), manifestPath), 'utf8')) as {
      snapshot?: { count?: number }
      accounts?: Array<{ email: string; id: string }>
    }
    if (manifest.snapshot?.count !== 63 || manifest.accounts?.length !== 63) {
      throw new Error('cleanup manifest must contain exactly the approved 63-account snapshot')
    }
    const manifestIds = new Set<string>()
    for (const entry of manifest.accounts) {
      if (!entry.email || !entry.id || manifestIds.has(entry.id)) {
        throw new Error('cleanup manifest contains a missing or duplicate account')
      }
      manifestIds.add(entry.id)
    }
    const authUsersById = await getAuthUsersByIds(admin, manifest.accounts.map(entry => entry.id))
    const currentByEmail = new Map(discoveredUsers.map(user => [user.email.toLowerCase(), user]))
    users = manifest.accounts.map(entry => {
      const current = authUsersById.get(entry.id.toLowerCase())
      if (!current) {
        const sameEmail = currentByEmail.get(entry.email.toLowerCase())
        if (sameEmail && sameEmail.id.toLowerCase() !== entry.id.toLowerCase()) {
          console.log('SAME EMAIL DIFFERENT AUTH ID — out of manifest scope: ' + sameEmail.email + ' :: ' + sameEmail.id)
        } else {
          console.log('MANIFEST ACCOUNT ALREADY ABSENT — ' + entry.email + ' :: ' + entry.id)
        }
      } else if (current.email.toLowerCase() !== entry.email.toLowerCase()) {
        throw new Error('cleanup manifest Auth email mismatch for ID ' + entry.id + '; refusing deletion')
      }
      return { id: entry.id, email: entry.email }
    })
    console.log('EXACT MANIFEST MODE — only the 63 reviewed Auth IDs below are eligible for deletion')
  }

  const inventory = await getDataSmokeInventory(admin, users)

  if (inventory.length !== users.length) {
    throw new Error(`Auth/SQL inventory mismatch: ${users.length} users, ${inventory.length} inventory rows`)
  }

  console.log(`SMOKE ACCOUNT PREFIXES — ${SMOKE_ACCOUNT_EMAIL_PREFIXES.join(', ')}`)
  console.log(`${manifestPath ? 'EXACT DELETE TARGETS' : 'DRY-RUN — found matching Auth accounts'} — ${users.length}`)

  const totals = Object.fromEntries(INVENTORY_FIELDS.map(field => [
    field,
    inventory.reduce((sum, row) => sum + row[field], 0),
  ]))
  for (const row of inventory) {
    const counts = INVENTORY_FIELDS.map(field => `${field}=${row[field]}`).join(' ')
    console.log(`- ${row.email} :: ${row.id} :: ${counts}`)
  }
  console.log(`TOTAL RELATED RECORDS — ${JSON.stringify(totals)}`)
  if (deleteRequested) {
    console.log('AUDIT DELETE TARGET EMAILS —')
    for (const user of users) console.log(`DELETE TARGET — ${user.email} :: ${user.id}`)
  }

  await assertNoForeignContentWouldBeCascadeDeleted(admin, users)
  console.log('CLEANUP SAFETY PASS — no non-smoke content is linked in a way that would be cascade-deleted')

  if (dryRunRequested) {
    console.log('DRY-RUN ONLY — no production data was changed. Deletion was not run.')
    return
  }

  if (verifyRequested) {
    const residuals = await verifySmokeCleanup(admin, users)
    console.log('EXACT MANIFEST VERIFICATION — ' + JSON.stringify(residuals))
    const targetFields = Object.entries(residuals).filter(([key]) => key !== 'smoke_users_remaining')
    const targetResidualCount = targetFields.reduce((sum, [, count]) => sum + count, 0)
    for (const user of discoveredUsers) {
      if (!users.some(target => target.id.toLowerCase() === user.id.toLowerCase())) {
        console.log('OUT-OF-MANIFEST SMOKE ACCOUNT — ' + user.email + ' :: ' + user.id)
      }
    }
    if (targetResidualCount !== 0) {
      throw new Error('exact manifest still has residual Auth or related records')
    }
    console.log('EXACT MANIFEST CLEANUP PASS — all 63 approved Auth IDs and their related records are absent')
    if (residuals.smoke_users_remaining > 0) {
      console.log('OUT-OF-MANIFEST RESIDUE — ' + residuals.smoke_users_remaining + ' smoke Auth account(s) remain; not included in the approved manifest')
    }
    return
  }

  console.log(`DELETE — removing ${users.length} explicitly matched smoke accounts`)
  const residuals = await cleanupSmokeUsers(admin, users)
  const remaining = Object.values(residuals).reduce((sum, count) => sum + count, 0)
  console.log(`CLEANUP RESULT — ${JSON.stringify(residuals)}`)
  if (remaining !== 0) {
    throw new Error('smoke-account cleanup finished with residual records')
  }
  console.log(`CLEANUP PASS — deleted ${users.length} smoke Auth accounts; verified zero residuals`)
}

main().catch(error => {
  console.error('Smoke-account cleanup failed:', error instanceof Error ? error.message : 'unknown error')
  process.exit(1)
})
