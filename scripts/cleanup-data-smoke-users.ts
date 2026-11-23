import { createClient } from '@supabase/supabase-js'
import {
  assertNoForeignContentWouldBeCascadeDeleted,
  cleanupSmokeUsers,
  getDataSmokeInventory,
  listDataSmokeUsers,
} from './lib/data-smoke-cleanup'
import { SMOKE_ACCOUNT_EMAIL_PREFIXES } from './lib/smoke-account-config'

const URL = process.env.SUPABASE_URL ?? ''
const SECRET = process.env.SUPABASE_SECRET_KEY ?? ''
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN ?? ''
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF ?? ''

for (const [name, value] of Object.entries({
  SUPABASE_URL: URL,
  SUPABASE_SECRET_KEY: SECRET,
  SUPABASE_ACCESS_TOKEN: ACCESS_TOKEN,
  SUPABASE_PROJECT_REF: PROJECT_REF,
})) {
  if (!value) throw new Error(`missing environment variable: ${name}`)
}

const deleteRequested = process.argv.includes('--delete')
const dryRunRequested = process.argv.includes('--dry-run')
if (deleteRequested === dryRunRequested) {
  throw new Error('pass exactly one mode: --dry-run or --delete')
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

async function main() {
  const admin = createClient(URL, SECRET, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const users = await listDataSmokeUsers(admin)
  const inventory = await getDataSmokeInventory(PROJECT_REF, ACCESS_TOKEN, users)

  if (inventory.length !== users.length) {
    throw new Error(`Auth/SQL inventory mismatch: ${users.length} users, ${inventory.length} inventory rows`)
  }

  console.log(`SMOKE ACCOUNT PREFIXES — ${SMOKE_ACCOUNT_EMAIL_PREFIXES.join(', ')}`)
  console.log(`DRY-RUN — found ${users.length} matching Auth accounts`)

  const totals = Object.fromEntries(INVENTORY_FIELDS.map(field => [
    field,
    inventory.reduce((sum, row) => sum + row[field], 0),
  ]))
  for (const row of inventory) {
    const counts = INVENTORY_FIELDS.map(field => `${field}=${row[field]}`).join(' ')
    console.log(`- ${row.email} :: ${row.id} :: ${counts}`)
  }
  console.log(`TOTAL RELATED RECORDS — ${JSON.stringify(totals)}`)

  await assertNoForeignContentWouldBeCascadeDeleted(PROJECT_REF, ACCESS_TOKEN)
  console.log('CLEANUP SAFETY PASS — no non-smoke content is linked in a way that would be cascade-deleted')

  if (dryRunRequested) {
    console.log('DRY-RUN ONLY — no production data was changed. Deletion was not run.')
    return
  }

  console.log(`DELETE — removing ${users.length} explicitly matched smoke accounts`)
  const residuals = await cleanupSmokeUsers(admin, PROJECT_REF, ACCESS_TOKEN, users)
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
