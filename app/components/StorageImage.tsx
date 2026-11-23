'use client'

import { useEffect, useRef, useState, type ImgHTMLAttributes, type SyntheticEvent } from 'react'
import { supabase } from '@/lib/supabase'

const SIGNED_URL_TTL_SECONDS = 60

type PrivateBucket = 'avatars' | 'post-images'
type PrivateReference = { bucket: PrivateBucket; path: string }
type QueuedRequest = {
  key: string
  viewerKey: string
  bucket: PrivateBucket
  path: string
  resolve: (url: string | null) => void
}

const inFlight = new Map<string, Promise<string | null>>()
let viewerLookup: Promise<string> | null = null
const pending = new Map<string, QueuedRequest>()
let flushScheduled = false

function storageKey(viewerKey: string, bucket: PrivateBucket, path: string) {
  return `${viewerKey}:${bucket}:${path}`
}

/**
 * Multiple images mounted in the same React commit are signed in one request
 * per bucket and viewer. Duplicate paths share a single signature. The cache
 * is only in-flight: bearer URLs are never reused after the batch completes.
 */
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

        // Do not let a request queued under one account receive a bearer URL
        // signed with a different account's current session.
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
  const [signedResult, setSignedResult] = useState<{ source: string; url: string | null } | null>(null)
  const [failedSource, setFailedSource] = useState<string | null>(null)
  const retryAttempted = useRef(false)

  const reference = src ? privateStorageReference(src) : null
  const bucket = reference?.bucket
  const objectPath = reference?.path
  const resolvedSrc = reference
    ? signedResult && signedResult.source === src ? signedResult.url ?? undefined : undefined
    : src ?? undefined
  const unavailable = !!src && failedSource === src

  useEffect(() => {
    let cancelled = false
    retryAttempted.current = false

    if (!src || !bucket || !objectPath) return

    void getSignedStorageUrl(bucket, objectPath).then((url) => {
      if (cancelled) return
      setSignedResult({ source: src, url })
      if (!url) setFailedSource(src)
    })

    return () => {
      cancelled = true
    }
  }, [src, bucket, objectPath])

  function handleImageError(event: SyntheticEvent<HTMLImageElement, Event>) {
    imageProps.onError?.(event)

    if (!src || !reference || retryAttempted.current) {
      if (src) setFailedSource(src)
      return
    }

    retryAttempted.current = true

    void getSignedStorageUrl(reference.bucket, reference.path, true).then((url) => {
      setSignedResult({ source: src, url })
      if (!url) setFailedSource(src)
    })
  }

  if (!src || unavailable) return null

  return (
    <img
      {...imageProps}
      alt={imageProps.alt ?? ''}
      src={resolvedSrc}
      onError={handleImageError}
    />
  )
}
