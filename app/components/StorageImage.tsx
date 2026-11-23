'use client'

import { useEffect, useState, type ImgHTMLAttributes, type SyntheticEvent } from 'react'
import { supabase } from '@/lib/supabase'

const SIGNED_URL_TTL_SECONDS = 60
const SIGNED_URL_CACHE_SAFETY_SECONDS = 5

type PrivateBucket = 'avatars' | 'post-images'

type CachedSignedUrl = {
  url: string
  expiresAt: number
}

const signedUrlCache = new Map<string, CachedSignedUrl>()
const signedUrlRequests = new Map<string, Promise<string>>()

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

async function getSignedStorageUrl(bucket: PrivateBucket, path: string): Promise<string> {
  const key = `${bucket}:${path}`
  const now = Date.now()
  const cached = signedUrlCache.get(key)

  if (cached && cached.expiresAt > now) return cached.url

  const pending = signedUrlRequests.get(key)
  if (pending) return pending

  const request = supabase.storage
    .from(bucket)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
    .then(({ data, error }) => {
      if (error || !data?.signedUrl) {
        throw new Error(error?.message ?? 'Storage returned an empty signed URL')
      }

      signedUrlCache.set(key, {
        url: data.signedUrl,
        expiresAt: Date.now() + (
          SIGNED_URL_TTL_SECONDS - SIGNED_URL_CACHE_SAFETY_SECONDS
        ) * 1000,
      })
      return data.signedUrl
    })
    .finally(() => {
      signedUrlRequests.delete(key)
    })

  signedUrlRequests.set(key, request)
  return request
}

/**
 * Resolve legacy public Storage URLs through consent-aware private-bucket RLS.
 * Identical object paths share one in-memory signing request/cache entry.
 * The database keeps stable object URLs; the browser receives a short-lived
 * signed URL only after Storage confirms that this viewer may read the object.
 */
export default function StorageImage({
  src,
  onError,
  alt,
  className,
  style,
  ...imageProps
}: Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  src?: string | null
}) {
  const [resolvedSrc, setResolvedSrc] = useState<string | undefined>()
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setFailed(false)

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

    void getSignedStorageUrl(reference.bucket, reference.path)
      .then((signedUrl) => {
        if (!cancelled) setResolvedSrc(signedUrl)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const message = error instanceof Error ? error.message : 'unknown Storage error'
        console.warn('[StorageImage] private media could not be signed:', message)
        setFailed(true)
      })

    return () => {
      cancelled = true
    }
  }, [src])

  function handleImageError(event: SyntheticEvent<HTMLImageElement, Event>) {
    setFailed(true)
    onError?.(event)
  }

  if (!resolvedSrc || failed) {
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
