import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { SITE_URL } from '@/lib/site'
import { isPreviewRequest } from '@/lib/env-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type TelegramMessage = {
  text?: unknown
  chat?: { id?: number; type?: string }
  from?: { is_bot?: boolean }
}

type TelegramUpdate = {
  message?: TelegramMessage
}

type InlineKeyboard = {
  inline_keyboard: Array<Array<{ text: string; url: string }>>
}

const SITE_BUTTONS: InlineKeyboard = {
  inline_keyboard: [
    [{ text: 'Открыть «Хлеба и букв»', url: `${SITE_URL}/?utm_source=telegram&utm_medium=bot&utm_campaign=welcome` }],
    [
      { text: 'Каталог книг', url: `${SITE_URL}/books?utm_source=telegram&utm_medium=bot` },
      { text: 'Публикации', url: `${SITE_URL}/posts?utm_source=telegram&utm_medium=bot` },
    ],
    [{ text: 'Присоединиться', url: `${SITE_URL}/signup?utm_source=telegram&utm_medium=bot` }],
  ],
}

function safeEquals(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

async function telegramRequest(
  method: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not configured')

  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
    signal: AbortSignal.timeout(8_000),
  })

  if (!response.ok) {
    const result = await response.json().catch(() => null) as { description?: string } | null
    throw new Error(`Telegram API ${method} failed: HTTP ${response.status} ${result?.description ?? ''}`)
  }
}

async function sendMessage(
  chatId: number,
  text: string,
  replyMarkup?: InlineKeyboard,
): Promise<void> {
  await telegramRequest('sendMessage', {
    chat_id: chatId,
    text,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    disable_web_page_preview: true,
  })
}

async function sendLatestPosts(chatId: number): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !anonKey) {
    await sendMessage(chatId, 'Раздел публикаций временно недоступен. Откройте сайт: ' + SITE_URL)
    return
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })

  const { data, error } = await supabase
    .from('posts')
    .select('id, title, created_at')
    .eq('status', 'approved')
    .order('created_at', { ascending: false })
    .limit(5)

  if (error) {
    console.error('[telegram] latest posts query failed:', error.message)
    await sendMessage(chatId, 'Не получилось загрузить публикации. Попробуйте открыть сайт: ' + SITE_URL)
    return
  }

  if (!data?.length) {
    await sendMessage(chatId, 'Пока нет опубликованных материалов. Загляните в каталог книг: ' + SITE_URL + '/books')
    return
  }

  const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Europe/Moscow',
  })

  const lines = data.map((post, index) => {
    const title = (post.title || 'Без названия').replace(/\\s+/g, ' ').trim().slice(0, 140)
    const date = post.created_at ? dateFormatter.format(new Date(post.created_at)) : ''
    return `${index + 1}. ${title}${date ? ` · ${date}` : ''}\n${SITE_URL}/post/${post.id}`
  })

  await sendMessage(chatId, `Последние публикации в «Хлеба и букв»:\n\n${lines.join('\n\n')}\n\nНовые истории ждут вас на сайте.`)
}

async function handleUpdate(update: TelegramUpdate): Promise<void> {
  const message = update.message
  const chatId = message?.chat?.id
  const chatType = message?.chat?.type

  // Бот предназначен для личных диалогов: не отвечает в группах и каналах.
  if (typeof chatId !== 'number' || chatType !== 'private' || message?.from?.is_bot) return
  if (typeof message.text !== 'string') return

  const command = message.text.trim().split(/\\s+/, 1)[0].split('@', 1)[0].toLowerCase()

  switch (command) {
    case '/start':
      await sendMessage(
        chatId,
        'Привет! Это бот книжного сообщества «Хлеба и букв» 📚\n\nЗдесь можно быстро открыть каталог, почитать публикации и присоединиться к сообществу.\n\nКоманды:\n/latest — последние публикации\n/books — каталог книг\n/id — ваш Telegram ID\n/help — помощь',
        SITE_BUTTONS,
      )
      return

    case '/latest':
      await sendLatestPosts(chatId)
      return

    case '/books':
      await sendMessage(chatId, `Каталог книг «Хлеба и букв» 📚\n\n${SITE_URL}/books?utm_source=telegram&utm_medium=bot`, {
        inline_keyboard: [[{ text: 'Открыть каталог', url: `${SITE_URL}/books?utm_source=telegram&utm_medium=bot` }]],
      })
      return

    case '/id':
      await sendMessage(chatId, `Ваш Telegram ID: ${chatId}\n\nСохраните его, если позже захотите подключить личные уведомления от бота.`)
      return

    case '/help':
      await sendMessage(chatId, 'Команды бота:\n/start — главное меню\n/latest — последние одобренные публикации\n/books — каталог книг\n/id — ваш Telegram ID\n/help — эта подсказка', SITE_BUTTONS)
      return

    default:
      await sendMessage(chatId, 'Не понял команду. Напишите /help, чтобы посмотреть возможности бота.', SITE_BUTTONS)
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, service: 'telegram-webhook' })
}

export async function POST(request: Request) {
  if (isPreviewRequest(request)) {
    return NextResponse.json({ ok: false }, { status: 404 })
  }

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (!secret || !process.env.TELEGRAM_BOT_TOKEN) {
    return NextResponse.json({ ok: false, error: 'telegram_not_configured' }, { status: 503 })
  }

  const suppliedSecret = request.headers.get('x-telegram-bot-api-secret-token') ?? ''
  if (!safeEquals(secret, suppliedSecret)) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  const contentLength = Number(request.headers.get('content-length') ?? '0')
  if (contentLength > 64_000) {
    return NextResponse.json({ ok: false }, { status: 413 })
  }

  let update: TelegramUpdate
  try {
    update = await request.json() as TelegramUpdate
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  // Always acknowledge valid Telegram deliveries. A failed reply is logged;
  // allowing Telegram to retry could send duplicate messages to the user.
  try {
    await handleUpdate(update)
  } catch (error) {
    console.error('[telegram] update handling failed:', error instanceof Error ? error.message : 'unknown error')
  }

  return NextResponse.json({ ok: true })
}
