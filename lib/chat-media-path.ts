const CHAT_MEDIA_MARKER = /\/storage\/v1\/object\/(?:public|sign)\/chat-media\//

/**
 * New rows store a bucket-relative object path. Legacy rows and live client
 * state may contain public or signed Storage URLs.
 */
export function getChatMediaObjectPath(value: string | null): string | null {
  if (!value) return null

  const marker = CHAT_MEDIA_MARKER.exec(value)
  if (marker?.index !== undefined) {
    const encodedPath = value
      .slice(marker.index + marker[0].length)
      .split(/[?#]/, 1)[0]

    if (!encodedPath) return null

    try {
      return decodeURIComponent(encodedPath)
    } catch {
      return null
    }
  }

  // New database values are bucket-relative paths, not external URLs.
  if (!/^https?:\/\//i.test(value) && !value.startsWith('/')) {
    return value
  }

  return null
}
