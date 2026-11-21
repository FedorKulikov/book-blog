const PUBLIC_CHAT_MEDIA_PATH = '/storage/v1/object/public/chat-media/'

/**
 * Stored chat attachments used to be persisted as public Storage URLs.
 * New messages store the bucket-relative object path directly.
 */
export function getChatMediaObjectPath(value: string | null): string | null {
  if (!value) return null

  const markerIndex = value.indexOf(PUBLIC_CHAT_MEDIA_PATH)
  if (markerIndex >= 0) {
    const encodedPath = value
      .slice(markerIndex + PUBLIC_CHAT_MEDIA_PATH.length)
      .split(/[?#]/, 1)[0]

    if (!encodedPath) return null

    try {
      return decodeURIComponent(encodedPath)
    } catch {
      return null
    }
  }

  // New rows store a bucket-relative path, never an absolute external URL.
  if (!/^https?:\/\//i.test(value) && !value.startsWith('/')) {
    return value
  }

  return null
}
