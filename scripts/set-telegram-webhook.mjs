#!/usr/bin/env node

const token = process.env.TELEGRAM_BOT_TOKEN
const secret = process.env.TELEGRAM_WEBHOOK_SECRET
const baseUrl = (process.env.TELEGRAM_WEBHOOK_BASE_URL || 'https://bukleb.ru').replace(/\\/+$/, '')

if (!token) {
  console.error('Missing TELEGRAM_BOT_TOKEN. Set it locally for this command; do not commit it.')
  process.exit(1)
}

if (!secret || !/^[A-Za-z0-9_-]{1,256}$/.test(secret)) {
  console.error('Missing/invalid TELEGRAM_WEBHOOK_SECRET (1-256 chars: A-Z, a-z, 0-9, _ or -).')
  process.exit(1)
}

let webhookUrl
try {
  webhookUrl = new URL('/api/telegram/webhook', baseUrl)
  if (webhookUrl.protocol !== 'https:') throw new Error('HTTPS is required')
} catch (error) {
  console.error('Invalid TELEGRAM_WEBHOOK_BASE_URL:', error instanceof Error ? error.message : 'invalid URL')
  process.exit(1)
}

async function api(method, payload = {}) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  })
  const result = await response.json().catch(() => null)
  if (!response.ok || !result?.ok) {
    throw new Error(`${method} failed: ${result?.description || response.statusText || response.status}`)
  }
  return result.result
}

try {
  const me = await api('getMe')
  await api('setMyDescription', {
    description: 'Бот сообщества «Хлеба и букв»: каталог книг, свежие публикации и быстрый вход на сайт.',
  })
  await api('setMyShortDescription', {
    short_description: 'Книжное сообщество: книги, публикации и обсуждения.',
  })
  await api('setMyCommands', {
    commands: [
      { command: 'start', description: 'Открыть главное меню' },
      { command: 'latest', description: 'Последние публикации' },
      { command: 'books', description: 'Каталог книг' },
      { command: 'id', description: 'Мой Telegram ID' },
      { command: 'help', description: 'Список команд' },
    ],
  })
  await api('setWebhook', {
    url: webhookUrl.toString(),
    secret_token: secret,
    allowed_updates: ['message'],
    max_connections: 5,
    drop_pending_updates: false,
  })
  const info = await api('getWebhookInfo')
  console.log('Telegram bot:', `@${me.username}`)
  console.log('Webhook:', info.url)
  console.log('Pending updates:', info.pending_update_count ?? 0)
  if (info.last_error_message) console.log('Last webhook error:', info.last_error_message)
  console.log('Webhook registration completed. The bot token and secret were not printed.')
} catch (error) {
  console.error('Telegram setup failed:', error instanceof Error ? error.message : 'unknown error')
  process.exit(1)
}
