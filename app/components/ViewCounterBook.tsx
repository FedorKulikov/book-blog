'use client'

import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'

export default function ViewCounterBook({ bookId }: { bookId: string }) {
  useEffect(() => {
    // Увеличиваем счётчик просмотров книги.
    // Простая защита — раз в сессию (sessionStorage).
    const key = `viewed-book-${bookId}`
    if (typeof window !== 'undefined') {
      const already = sessionStorage.getItem(key)
      if (!already) {
        // then() обязателен: без await/then запрос supabase-js не отправляется
        supabase
          .rpc('increment_book_views', { book_id_input: bookId })
          .then(
            ({ error }) => {
              if (error) {
                console.warn('[ViewCounterBook] RPC не посчитал просмотр:', error.message)
              }
            },
            (err: unknown) => {
              console.warn('[ViewCounterBook] ошибка сети при подсчёте просмотра:', err)
            }
          )
        sessionStorage.setItem(key, '1')
      }
    }
  }, [bookId])

  return null
}
