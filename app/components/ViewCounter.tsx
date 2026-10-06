'use client'

import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'

export default function ViewCounter({ postId }: { postId: string }) {
  useEffect(() => {
    // Увеличиваем счётчик при заходе на пост.
    // Простая защита — раз в сессию (sessionStorage).
    const key = `viewed-${postId}`
    if (typeof window !== 'undefined') {
      const already = sessionStorage.getItem(key)
      if (!already) {
        supabase.rpc('increment_post_views', { post_id_input: postId })
        sessionStorage.setItem(key, '1')
      }
    }
  }, [postId])

  return null
}