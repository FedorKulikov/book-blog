import dns from 'node:dns'
import { Agent, setGlobalDispatcher } from 'undici'

console.log('✅ [instrumentation] Загружен форсированный IPv4 диспетчер')

// Принудительный IPv4 для всех fetch-запросов (включая Supabase)
dns.setDefaultResultOrder('ipv4first')
setGlobalDispatcher(new Agent({ connect: { family: 4 } }))
