import { supabase } from '@/lib/supabase/client'
import { getChatMediaObjectPath } from './chat-media-path'

const CHAT_MEDIA_SIGNED_URL_TTL_SECONDS = 60 * 60

type ChatMediaFields = {
  image_url: string | null
  audio_url: string | null
  image_object_path?: string | null
  audio_object_path?: string | null
  media_unavailable?: boolean
}

/**
 * Resolve stored object paths and legacy public URLs into short-lived signed
 * links. Supabase Storage RLS checks that the current user participates in a
 * conversation containing the original sender's attachment.
 */
export async function signChatMediaMessages<T extends ChatMediaFields>(
  messages: T[],
): Promise<T[]> {
  const paths = Array.from(
    new Set(
      messages.flatMap(message => [
        message.image_object_path ?? getChatMediaObjectPath(message.image_url),
        message.audio_object_path ?? getChatMediaObjectPath(message.audio_url),
      ]).filter((path): path is string => Boolean(path)),
    ),
  )

  if (paths.length === 0) return messages

  const { data, error } = await supabase
    .storage
    .from('chat-media')
    .createSignedUrls(paths, CHAT_MEDIA_SIGNED_URL_TTL_SECONDS)

  if (error) {
    console.warn('[chat] could not sign private media URLs:', error.message)
  }

  const signedUrlByPath = new Map<string, string>()
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) {
      signedUrlByPath.set(item.path, item.signedUrl)
    }
  }

  return messages.map(message => {
    const imagePath = message.image_object_path ?? getChatMediaObjectPath(message.image_url)
    const audioPath = message.audio_object_path ?? getChatMediaObjectPath(message.audio_url)
    const imageUrl = imagePath
      ? signedUrlByPath.get(imagePath) ?? null
      : message.image_url
    const audioUrl = audioPath
      ? signedUrlByPath.get(audioPath) ?? null
      : message.audio_url

    return {
      ...message,
      image_url: imageUrl,
      audio_url: audioUrl,
      image_object_path: imagePath,
      audio_object_path: audioPath,
      media_unavailable: Boolean(
        (imagePath && !imageUrl) || (audioPath && !audioUrl),
      ),
    }
  })
}
