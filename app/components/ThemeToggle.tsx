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
      className={`text-cream/70 hover:text-cream transition-colors p-2 ${className}`}
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
