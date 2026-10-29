// app/components/BookmarkButton.tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import { Bookmark } from './icons'

/**
 * «Сохранить в закладки». Работает без серверных экшенов:
 * RLS (политики на public.bookmarks) не даст записать чужую закладку.
 */
export default function BookmarkButton({
  postId,
  size = 13,
  className = '',
}: {
  postId: string
  size?: number
  className?: string
}) {
  const router = useRouter()
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(false)
  // Проверку статуса делаем один раз; до неё кнопка уже отрисована,
  // чтобы не было скачка вёрстки.
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    let alive = true

    async function check() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!alive) return
        if (!user) return

        const { data } = await supabase
          .from('bookmarks')
          .select('id')
          .eq('user_id', user.id)
          .eq('post_id', postId)
          .maybeSingle()

        if (alive) setSaved(Boolean(data))
      } catch (error) {
        console.error('[bookmark] check failed:', error)
      } finally {
        if (alive) setChecked(true)
      }
    }

    check()

    return () => {
      alive = false
    }
  }, [postId])

  async function handleClick(e: React.MouseEvent<HTMLButtonElement>) {
    // Кнопка живёт внутри карточек/ссылок — гасим всплытие, чтобы не уйти по ссылке.
    e.preventDefault()
    e.stopPropagation()

    if (loading) return

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
        return
      }

      setLoading(true)

      const next = !saved
      setSaved(next) // оптимистично: откатим, если база откажет

      if (next) {
        const { error } = await supabase
          .from('bookmarks')
          .insert({ user_id: user.id, post_id: postId })

        // 23505 = unique_violation: закладка уже есть (двойной клик/вторая вкладка)
        if (error && error.code !== '23505') {
          console.error('[bookmark] insert failed:', error.message)
          setSaved(false)
        }
      } else {
        const { error } = await supabase
          .from('bookmarks')
          .delete()
          .eq('user_id', user.id)
          .eq('post_id', postId)

        if (error) {
          console.error('[bookmark] delete failed:', error.message)
          setSaved(true)
        }
      }
    } catch (error) {
      console.error('[bookmark] failed:', error)
    } finally {
      setLoading(false)
    }
  }

  const label = saved ? 'Убрать из сохранённого' : 'Сохранить пост'

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      aria-pressed={saved}
      aria-label={label}
      title={label}
      className={`flex items-center gap-1 transition-colors disabled:opacity-50 ${
        saved ? 'text-wine' : 'text-brown/50 hover:text-wine'
      } ${className}`}
    >
      <Bookmark
        size={size}
        strokeWidth={1.8}
        fill={saved ? 'currentColor' : 'none'}
        className={checked || loading ? '' : 'opacity-60'}
      />
    </button>
  )
}
