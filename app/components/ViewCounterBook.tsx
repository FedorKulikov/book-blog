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
        supabase.rpc('increment_book_views', { book_id_input: bookId })
        sessionStorage.setItem(key, '1')
      }
    }
  }, [bookId])

  return null
}
