'use client'

import { useEffect, useState } from 'react'
import { Sun, Moon } from './icons'

export default function ThemeToggle({
  className = '',
}: {
  className?: string
}) {
  const [isDark, setIsDark] = useState(false)

  useEffect(() => {
    // Синхронизируемся с классом на <html>: его мог выставить инлайн-скрипт
    // в layout до гидратации. localStorage в рендере не читаем (рассинхрон).
    setIsDark(document.documentElement.classList.contains('dark'))
  }, [])

  function toggle() {
    const next = !isDark
    setIsDark(next)
    document.documentElement.classList.toggle('dark', next)
    try {
      localStorage.setItem('theme', next ? 'dark' : 'light')
    } catch {
      // приватный режим браузера — тема просто не сохранится
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      // Жёсткий сброс дефолтных стилей браузера и Tailwind: никакого
      // серого ButtonFace, рамок и outline. Виден только сам значок.
      // h-10 w-10 — размер области нажатия (иконка внутри остаётся 18px),
      // фон при этом прозрачный. p-0 — чтобы отступы не добавляли плашку.
      className={`appearance-none bg-transparent border-0 border-none outline-none focus:outline-none focus:ring-0 p-0 flex items-center justify-center h-10 w-10 leading-none rounded-full text-cream/50 hover:text-cream transition-colors cursor-pointer select-none ${className}`}
      aria-label={isDark ? 'Включить светлую тему' : 'Включить тёмную тему'}
      title={isDark ? 'Светлая тема' : 'Тёмная тема'}
    >
      {isDark ? (
        <Sun size={18} strokeWidth={1.8} />
      ) : (
        <Moon size={18} strokeWidth={1.8} />
      )}
    </button>
  )
}
