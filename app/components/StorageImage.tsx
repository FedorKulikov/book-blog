'use client'

import { useEffect, useState, type ImgHTMLAttributes } from 'react'
import { supabase } from '@/lib/supabase'

const SIGNED_URL_TTL_SECONDS = 60

type PrivateBucket = 'avatars' | 'post-images'

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

/**
 * Resolve legacy public Storage URLs through consent-aware private-bucket RLS.
 * The database keeps the stable object URL; only the browser receives a
 * short-lived signed URL after Storage confirms that this viewer may read it.
 */
export default function StorageImage({
  src,
  ...imageProps
}: Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  src?: string | null
}) {
  const [resolvedSrc, setResolvedSrc] = useState<string | undefined>()

  useEffect(() => {
    let cancelled = false

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

    void supabase.storage
      .from(reference.bucket)
      .createSignedUrl(reference.path, SIGNED_URL_TTL_SECONDS)
      .then(({ data, error }) => {
        if (cancelled) return

        if (error || !data?.signedUrl) {
          console.warn('[StorageImage] private media could not be signed:', error?.message ?? 'empty signed URL')
          setResolvedSrc(undefined)
          return
        }

        setResolvedSrc(data.signedUrl)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const message = error instanceof Error ? error.message : 'unknown Storage error'
        console.warn('[StorageImage] private media signing failed:', message)
        setResolvedSrc(undefined)
      })

    return () => {
      cancelled = true
    }
  }, [src])

  return <img {...imageProps} src={resolvedSrc} />
}
