import Link from 'next/link'
import { ChevronLeft } from './components/icons'

export default function NotFound() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="text-center max-w-md">
        <div className="font-playfair text-8xl font-bold text-wine/20 mb-2">
          404
        </div>
        <h1 className="font-playfair text-2xl font-bold text-emerald-dark mb-3">
          Страница не найдена
        </h1>
        <p className="text-sm text-brown/65 mb-8 leading-relaxed">
          Возможно, она была удалена или вы ошиблись в адресе.
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-2 bg-emerald-mid hover:bg-emerald-dark text-cream px-5 py-2.5 rounded-full text-sm transition-colors"
        >
          <ChevronLeft size={16} strokeWidth={1.8} />
          <span>На главную</span>
        </Link>
      </div>
    </main>
  )
}
