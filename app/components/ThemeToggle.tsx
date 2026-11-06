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
      // Намеренно без фона и рамки: в сайдбаре это просто иконка,
      // меняющая цвет при наведении. Фон/кольцо появляются только на
      // focus-visible (клавиатурная навигация), иначе кнопка выглядела
      // как белая плашка с обводкой.
      className={`inline-flex items-center justify-center border-0 bg-transparent rounded-full p-2 leading-none text-cream/70 transition-colors hover:text-cream focus:outline-none focus-visible:ring-1 focus-visible:ring-cream/40 ${className}`}
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
