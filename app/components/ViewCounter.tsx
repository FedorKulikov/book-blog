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
        // Важно: then() у билдера supabase-js — запрос уходит только при
        // await/then(), без этого вызов «висит» молча и просмотры не считаются
        supabase
          .rpc('increment_post_views', { post_id_input: postId })
          .then(
            ({ error }) => {
              if (error) {
                console.warn('[ViewCounter] RPC не посчитал просмотр:', error.message)
              }
            },
            (err: unknown) => {
              console.warn('[ViewCounter] ошибка сети при подсчёте просмотра:', err)
            }
          )
        sessionStorage.setItem(key, '1')
      }
    }
  }, [postId])

  return null
}