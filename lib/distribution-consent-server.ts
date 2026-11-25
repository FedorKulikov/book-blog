import type { SupabaseClient } from '@supabase/supabase-js'
import { isNewsCategory } from '@/app/news/newsQuery'
import {
  DISTRIBUTION_CONSENT_CATEGORIES,
  DISTRIBUTION_CONSENT_VERSION,
} from '@/lib/distribution-consent'

type PostType = 'news' | 'creative' | 'discussion'

export type CreatePostBody = {
  title?: unknown
  content?: unknown
  type?: unknown
  bookId?: unknown
  newsCategory?: unknown
  deadlineAt?: unknown
  sourceUrl?: unknown
  distributionConsent?: unknown
}

export type CreatePostResult = {
  status: number
  body: { error: string } | { post: { id: string; status: string } }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname)
  } catch {
    return false
  }
}

/**
 * The route passes the verified auth.getUser() id. No user_id from the JSON
 * body is read or trusted. Consent is written before the post INSERT.
 */
export async function createPostWithDistributionConsent(
  supabase: SupabaseClient,
  verifiedUserId: string,
  input: CreatePostBody,
): Promise<CreatePostResult> {
  if (input.distributionConsent !== true) {
    return {
      status: 422,
      body: { error: 'Перед публикацией подтвердите отдельное согласие на распространение персональных данных.' },
    }
  }

  const title = typeof input.title === 'string' ? input.title.trim() : ''
  const content = typeof input.content === 'string' ? input.content.trim() : ''
  const type = input.type
  if (title.length < 3 || title.length > 200) {
    return { status: 422, body: { error: 'Заголовок должен содержать от 3 до 200 символов.' } }
  }
  if (content.length < 10) {
    return { status: 422, body: { error: 'Текст поста — минимум 10 символов.' } }
  }
  if (type !== 'news' && type !== 'creative' && type !== 'discussion') {
    return { status: 422, body: { error: 'Выбран неизвестный тип публикации.' } }
  }

  const bookId = input.bookId == null || input.bookId === '' ? null : input.bookId
  if (bookId !== null && (typeof bookId !== 'string' || !isUuid(bookId))) {
    return { status: 422, body: { error: 'Некорректная ссылка на книгу.' } }
  }

  let newsCategory: string | null = null
  let deadlineAt: string | null = null
  let sourceUrl: string | null = null

  if (type === 'news') {
    if (typeof input.newsCategory !== 'string' || !isNewsCategory(input.newsCategory)) {
      return { status: 422, body: { error: 'Выберите корректную категорию новости.' } }
    }
    newsCategory = input.newsCategory

    const needsDeadline = newsCategory === 'contest' || newsCategory === 'event'
    if (needsDeadline) {
      if (typeof input.deadlineAt !== 'string' || Number.isNaN(Date.parse(input.deadlineAt))) {
        return { status: 422, body: { error: 'Укажите корректную дату дедлайна.' } }
      }
      deadlineAt = input.deadlineAt
    }

    if (input.sourceUrl != null && input.sourceUrl !== '') {
      if (typeof input.sourceUrl !== 'string' || !isHttpUrl(input.sourceUrl)) {
        return { status: 422, body: { error: 'Ссылка на источник должна быть корректным адресом http:// или https://.' } }
      }
      sourceUrl = input.sourceUrl.trim()
    }
  }

  const { data: limitCheck, error: limitError } = await supabase.rpc('check_and_log_action', {
    action_input: 'post',
    max_per_hour: 10,
    max_per_minute: 3,
  })

  if (limitError || !limitCheck) {
    return { status: 503, body: { error: 'Не удалось проверить лимит публикаций. Попробуйте ещё раз.' } }
  }
  if (!limitCheck.ok) {
    if (limitCheck.reason === 'minute_limit') {
      return { status: 429, body: { error: 'Слишком быстро. Подождите минуту перед следующим постом.' } }
    }
    if (limitCheck.reason === 'hour_limit') {
      return { status: 429, body: { error: 'Достигнут лимит постов на час (10). Попробуйте позже.' } }
    }
    return { status: 401, body: { error: 'Войдите в аккаунт.' } }
  }

  const { data: consentId, error: consentError } = await supabase.rpc(
    'record_my_distribution_consent',
    {
      p_scope: 'publication',
      p_data_categories: [...DISTRIBUTION_CONSENT_CATEGORIES],
      p_document_version: DISTRIBUTION_CONSENT_VERSION,
    },
  )

  if (consentError || !consentId) {
    return {
      status: 503,
      body: { error: 'Не удалось зафиксировать согласие. Публикация не создана — попробуйте ещё раз.' },
    }
  }

  const { data: post, error: postError } = await supabase
    .from('posts')
    .insert({
      user_id: verifiedUserId,
      title,
      content,
      type: type as PostType,
      book_id: bookId,
      news_category: newsCategory,
      deadline_at: deadlineAt,
      source_url: sourceUrl,
    })
    .select('id, status')
    .single()

  if (postError || !post) {
    if (postError?.code === '42501') {
      const raw = (postError.message ?? '').trim()
      // Триггеры базы сами объясняют отказ по-русски: «слишком часто»,
      // «нужно отдельное согласие», «аккаунт заблокирован». Показываем
      // их текст: общая формулировка скрывает настоящую причину.
      if (/[а-яё]/i.test(raw)) {
        return { status: 422, body: { error: raw } }
      }
      return { status: 422, body: { error: 'Публикация отклонена проверкой прав или согласия.' } }
    }
    if (postError?.code === '23514') {
      // Проверки целостности: срок допустим только для конкурсов и событий,
      // категория и ссылка должны соответствовать спискам.
      return { status: 422, body: { error: 'Проверьте категорию, срок и ссылку: для этой категории такое сочетание недопустимо.' } }
    }
    if (postError?.code === '23503') {
      return { status: 422, body: { error: 'Одна из связанных записей больше недоступна. Обновите форму.' } }
    }
    return { status: 500, body: { error: 'Не удалось создать публикацию. Запись согласия сохранена; попробуйте ещё раз.' } }
  }

  return {
    status: 201,
    body: { post: { id: post.id as string, status: post.status as string } },
  }
}
