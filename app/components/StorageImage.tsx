'use client'

import { useEffect, useState, type ImgHTMLAttributes, type ReactNode, type SyntheticEvent } from 'react'
import { supabase } from '@/lib/supabase'

const SIGNED_URL_TTL_SECONDS = 60

type PrivateBucket = 'avatars' | 'post-images'
type SignedResolution = {
  source: string
  url: string | null
  failed: boolean
  retried: boolean
}
type QueuedRequest = {
  key: string
  viewerKey: string
  bucket: PrivateBucket
  path: string
  resolve: (url: string | null) => void
}

const inFlight = new Map<string, Promise<string | null>>()
const pending = new Map<string, QueuedRequest>()
let flushScheduled = false
let viewerLookup: Promise<string> | null = null

function privateStorageReference(source: string): { bucket: PrivateBucket; path: string } | null {
  try {
    const url = new URL(source)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    if (!supabaseUrl || url.origin !== new URL(supabaseUrl).origin) return null

    const marker = '/storage/v1/object/public/'
    const markerIndex = url.pathname.indexOf(marker)
    if (markerIndex === -1) return null

    const remainder = url.pathname.slice(markerIndex + marker.length)
    const separator = remainder.indexOf('/')
    if (separator <= 0) return null

    const bucket = remainder.slice(0, separator)
    if (bucket !== 'avatars' && bucket !== 'post-images') return null

    const encodedPath = remainder.slice(separator + 1)
    if (!encodedPath) return null

    return {
      bucket,
      path: decodeURIComponent(encodedPath),
    }
  } catch {
    return null
  }
}

function getViewerKey(): Promise<string> {
  if (!viewerLookup) {
    const lookup = supabase.auth
      .getSession()
      .then(({ data }) => data.session?.user.id ?? 'anon')
      .catch(() => 'anon')

    viewerLookup = lookup
    void lookup.finally(() => {
      if (viewerLookup === lookup) viewerLookup = null
    })
  }

  return viewerLookup
}

function storageKey(viewerKey: string, bucket: PrivateBucket, path: string) {
  return `${viewerKey}:${bucket}:${path}`
}

/**
 * Multiple images mounted in the same React commit are signed in one request
 * per bucket and viewer. Duplicate paths share one in-flight signature.
 * Bearer URLs are not cached after the batch completes or across accounts.
 */
async function getSignedStorageUrl(
  bucket: PrivateBucket,
  path: string,
): Promise<string | null> {
  let viewerKey: string

  try {
    viewerKey = await getViewerKey()
  } catch {
    return null
  }

  const key = storageKey(viewerKey, bucket, path)
  const existing = inFlight.get(key)
  if (existing) return existing

  let resolveRequest!: (url: string | null) => void
  const request = new Promise<string | null>((resolve) => {
    resolveRequest = resolve
  })

  inFlight.set(key, request)
  pending.set(key, { key, viewerKey, bucket, path, resolve: resolveRequest })

  if (!flushScheduled) {
    flushScheduled = true
    queueMicrotask(() => {
      void flushSignedUrlQueue()
    })
  }

  return request
}

async function flushSignedUrlQueue() {
  flushScheduled = false
  const queued = Array.from(pending.values())
  pending.clear()

  const byBucketAndViewer = new Map<string, QueuedRequest[]>()
  for (const request of queued) {
    const groupKey = `${request.viewerKey}:${request.bucket}`
    const group = byBucketAndViewer.get(groupKey) ?? []
    group.push(request)
    byBucketAndViewer.set(groupKey, group)
  }

  await Promise.all(
    Array.from(byBucketAndViewer.values()).map(async (requests) => {
      const first = requests[0]
      let signedRows: Array<{ path: string | null; signedUrl: string | null; error: string | null }> | null = null

      try {
        const { data: { session } } = await supabase.auth.getSession()
        const currentViewerKey = session?.user.id ?? 'anon'

        // Never deliver a bearer URL signed with a different account's JWT.
        if (currentViewerKey === first.viewerKey) {
          const { data, error } = await supabase.storage
            .from(first.bucket)
            .createSignedUrls(requests.map((request) => request.path), SIGNED_URL_TTL_SECONDS)

          if (!error) signedRows = data
        }
      } catch {
        signedRows = null
      }

      const byPath = new Map(
        (signedRows ?? []).map((row) => [row.path ?? '', row]),
      )

      for (const request of requests) {
        const row = byPath.get(request.path)
        const url = row && !row.error && row.signedUrl ? row.signedUrl : null

        inFlight.delete(request.key)
        request.resolve(url)
      }
    }),
  )
}

export default function StorageImage({
  src,
  onError,
  alt,
  className,
  style,
  ...imageProps
}: Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  src?: string | null
  /** Component-specific fallback for public media such as book covers. */
  fallback?: ReactNode
}) {
  const [resolution, setResolution] = useState<SignedResolution | null>(null)
  const reference = src ? privateStorageReference(src) : null
  const resolvedSrc = !src
    ? undefined
    : reference
      ? resolution?.source === src && !resolution.failed
        ? resolution.url ?? undefined
        : undefined
      : resolution?.source === src && resolution.failed
        ? undefined
        : src
  const failed = !!src && resolution?.source === src && resolution.failed

  useEffect(() => {
    let cancelled = false

    if (!src || !reference) return

    void getSignedStorageUrl(reference.bucket, reference.path)
      .then((signedUrl) => {
        if (!cancelled) {
          setResolution({
            source: src,
            url: signedUrl,
            failed: !signedUrl,
            retried: false,
          })
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const message = error instanceof Error ? error.message : 'unknown Storage error'
        console.warn('[StorageImage] private media could not be signed:', message)
        setResolution({ source: src, url: null, failed: true, retried: false })
      })

    return () => {
      cancelled = true
    }
  }, [src, reference?.bucket, reference?.path])

  function handleImageError(event: SyntheticEvent<HTMLImageElement, Event>) {
    onError?.(event)

    if (!src || !reference || (resolution?.source === src && resolution.retried)) {
      if (src) setResolution({ source: src, url: null, failed: true, retried: true })
      return
    }

    setResolution({ source: src, url: null, failed: false, retried: true })

    void getSignedStorageUrl(reference.bucket, reference.path)
      .then((signedUrl) => {
        setResolution({
          source: src,
          url: signedUrl,
          failed: !signedUrl,
          retried: true,
        })
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'unknown Storage error'
        console.warn('[StorageImage] refreshed private media URL failed:', message)
        setResolution({ source: src, url: null, failed: true, retried: true })
      })
  }

  if (!src || failed || !resolvedSrc) {
    if (fallback !== undefined) return <>{fallback}</>

    return (
      <span
        role={alt ? 'img' : undefined}
        aria-label={alt || undefined}
        aria-hidden={alt ? undefined : true}
        className={`${className ?? ''} bg-cream-warm/60`.trim()}
        style={style}
      />
    )
  }

  return (
    <img
      {...imageProps}
      src={resolvedSrc}
      alt={alt ?? ''}
      className={className}
      style={style}
      onError={handleImageError}
    />
  )
}
