import { createClient } from '@supabase/supabase-js'
import {
  cleanupDataSmokeUsers,
  getDataSmokeInventory,
  listDataSmokeUsers,
} from './lib/data-smoke-cleanup'

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

async function main() {
  const admin = createClient(URL, SECRET, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const users = await listDataSmokeUsers(admin)
  const inventory = await getDataSmokeInventory(PROJECT_REF, ACCESS_TOKEN, users)

  console.log(`DRY-RUN — found ${users.length} data-smoke Auth accounts`)
  for (const user of users) {
    const row = inventory.find(item => item.id === user.id)
    console.log(
      `- ${user.email} :: id=${user.id} :: consents=${row?.consents ?? 0} ` +
      `(active=${row?.active_consents ?? 0}, revoked=${row?.revoked_consents ?? 0}) ` +
      `profiles=${row?.profiles ?? 0} posts=${row?.posts ?? 0} books=${row?.books ?? 0} ` +
      `reports=${row?.reports ?? 0} notifications=${row?.notifications ?? 0} ` +
      `storage=${row?.storage_objects ?? 0} external_news=${row?.external_news ?? 0}`,
    )
  }

  if (dryRunRequested) {
    console.log('DRY-RUN ONLY — no production data was changed. Pass --delete to remove only these accounts.')
    return
  }

  console.log(`DELETE — removing ${users.length} explicitly matched data-smoke accounts`)
  const residuals = await cleanupDataSmokeUsers(admin, PROJECT_REF, ACCESS_TOKEN, users)
  const remaining = Object.values(residuals).reduce((sum, count) => sum + count, 0)
  console.log(`CLEANUP RESULT — ${JSON.stringify(residuals)}`)
  if (remaining !== 0) {
    throw new Error('data-smoke cleanup finished with residual records')
  }
  console.log(`CLEANUP PASS — deleted ${users.length} data-smoke Auth accounts; verified zero residuals`)
}

main().catch(error => {
  console.error('Data-smoke cleanup failed:', error instanceof Error ? error.message : 'unknown error')
  process.exit(1)
})
