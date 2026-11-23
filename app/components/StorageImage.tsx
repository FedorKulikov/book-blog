'use client'

import { useEffect, useRef, useState, type ImgHTMLAttributes, type SyntheticEvent } from 'react'
import { supabase } from '@/lib/supabase'

const SIGNED_URL_TTL_SECONDS = 60
const CACHE_TTL_MS = 55_000

type PrivateBucket = 'avatars' | 'post-images'
type PrivateReference = { bucket: PrivateBucket; path: string }
type QueuedRequest = {
  key: string
  bucket: PrivateBucket
  path: string
  resolve: (url: string | null) => void
}

const signedUrlCache = new Map<string, { url: string; expiresAt: number }>()
const inFlight = new Map<string, Promise<string | null>>()
const pending = new Map<string, QueuedRequest>()
let flushScheduled = false

function storageKey(bucket: PrivateBucket, path: string) {
  return `${bucket}:${path}`
}

/**
 * Multiple images mounted in the same React commit are signed in one request
 * per bucket. Duplicate paths share one signature and the short-lived cache.
 */
function getSignedStorageUrl(
  bucket: PrivateBucket,
  path: string,
  forceRefresh = false,
): Promise<string | null> {
  const key = storageKey(bucket, path)

  if (forceRefresh) signedUrlCache.delete(key)

  const cached = signedUrlCache.get(key)
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
    return Promise.resolve(cached.url)
  }

  const existing = inFlight.get(key)
  if (existing) return existing

  let resolveRequest!: (url: string | null) => void
  const request = new Promise<string | null>((resolve) => {
    resolveRequest = resolve
  })

  inFlight.set(key, request)
  pending.set(key, { key, bucket, path, resolve: resolveRequest })

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

  const byBucket = new Map<PrivateBucket, QueuedRequest[]>()
  for (const request of queued) {
    const group = byBucket.get(request.bucket) ?? []
    group.push(request)
    byBucket.set(request.bucket, group)
  }

  await Promise.all(
    Array.from(byBucket.entries()).map(async ([bucket, requests]) => {
      let signedRows: Array<{ path: string | null; signedUrl: string; error: string | null }> | null = null

      try {
        const { data, error } = await supabase.storage
          .from(bucket)
          .createSignedUrls(requests.map((request) => request.path), SIGNED_URL_TTL_SECONDS)

        if (!error) signedRows = data
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
        if (url) {
          signedUrlCache.set(request.key, {
            url,
            expiresAt: Date.now() + CACHE_TTL_MS,
          })
        } else {
          signedUrlCache.delete(request.key)
        }

        request.resolve(url)
      }
    }),
  )
}

function privateStorageReference(source: string): PrivateReference | null {
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

/**
 * Resolve legacy public Storage URLs through consent-aware private-bucket RLS.
 * The database keeps the stable object URL; the browser receives a signed URL
 * after Storage authorizes the current viewer. On expiry, re-sign once; if
 * access was withdrawn, remove the image instead of rendering a broken icon.
 */
export default function StorageImage({
  src,
  ...imageProps
}: Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  src?: string | null
}) {
  const [resolvedSrc, setResolvedSrc] = useState<string | undefined>()
  const [unavailable, setUnavailable] = useState(false)
  const retryAttempted = useRef(false)

  useEffect(() => {
    let cancelled = false
    retryAttempted.current = false
    setUnavailable(false)

    if (!src) {
      setResolvedSrc(undefined)
      return
    }

    const reference = privateStorageReference(src)
    if (!reference) {
      setResolvedSrc(src)
      return
    }

    setResolvedSrc(undefined)

    void getSignedStorageUrl(reference.bucket, reference.path).then((url) => {
      if (cancelled) return

      if (!url) {
        setUnavailable(true)
        return
      }

      setResolvedSrc(url)
    })

    return () => {
      cancelled = true
    }
  }, [src])

  function handleImageError(event: SyntheticEvent<HTMLImageElement, Event>) {
    imageProps.onError?.(event)

    const reference = src ? privateStorageReference(src) : null
    if (!reference || retryAttempted.current) {
      setUnavailable(true)
      setResolvedSrc(undefined)
      return
    }

    retryAttempted.current = true
    setResolvedSrc(undefined)

    void getSignedStorageUrl(reference.bucket, reference.path, true).then((url) => {
      if (url) {
        setUnavailable(false)
        setResolvedSrc(url)
      } else {
        setUnavailable(true)
      }
    })
  }

  if (unavailable) return null

  return <img {...imageProps} src={resolvedSrc} onError={handleImageError} />
}
