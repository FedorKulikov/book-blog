import { Playfair_Display, Inter } from 'next/font/google'
import { Metadata } from 'next'
import Link from 'next/link'
import { SITE_URL } from '@/lib/site'
import Sidebar from './components/Header'
import MobileNav from './components/MobileNav'
import YandexMetrika from './components/YandexMetrika'
import './globals.css'

const playfair = Playfair_Display({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-playfair',
  display: 'swap',
})

const inter = Inter({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-inter',
  display: 'swap',
})

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Хлеба и букв',
    template: '%s · Хлеба и букв',
  },
  description:
    'Книжное сообщество: свежие новинки, обсуждения прочитанного и авторское творчество.',
  openGraph: {
    type: 'website',
    locale: 'ru_RU',
    siteName: 'Хлеба и букв',
    title: 'Хлеба и букв',
    description:
      'Книжное сообщество: свежие новинки, обсуждения прочитанного и авторское творчество.',
    images: [
      {
        url: '/og-default.jpg',
        width: 1200,
        height: 630,
        alt: 'Хлеба и букв',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Хлеба и букв',
    description:
      'Книжное сообщество: свежие новинки, обсуждения прочитанного и авторское творчество.',
  },
  // Подтверждение прав на сайт в Google Search Console.
  // Если переменная задана — Next.js выведет <meta name="google-site-verification" content="..." />.
  verification:
    process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION ||
    process.env.NEXT_PUBLIC_YANDEX_WEBMASTER_VERIFICATION
      ? {
          ...(process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION
            ? { google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION }
            : {}),
          ...(process.env.NEXT_PUBLIC_YANDEX_WEBMASTER_VERIFICATION
            ? { yandex: process.env.NEXT_PUBLIC_YANDEX_WEBMASTER_VERIFICATION }
            : {}),
        }
      : undefined,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="ru"
      className={`${playfair.variable} ${inter.variable}`}
      suppressHydrationWarning
    >
      <body className="bg-cream text-brown-dark">
        {/* Тема применяется ДО первой отрисовки — против вспышки светлого.
            Второй блок — только для next dev: индикатор Next.js живёт в shadow
            DOM (div.nextjs-toast) и документным CSS его не сдвинуть, поэтому
            сдвигаем его вправо скриптом, чтобы не перекрывал тумблер темы.
            В проде элемент nextjs-portal отсутствует — блок молча истекает. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                var t = localStorage.getItem('theme');
                if (t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                  document.documentElement.classList.add('dark');
                }
              } catch (e) {}
              try {
                var tries = 0;
                var iv = setInterval(function () {
                  tries += 1;
                  var host = document.querySelector('nextjs-portal');
                  var sr = host && host.shadowRoot;
                  if (sr) {
                    var toast = sr.querySelector('.nextjs-toast');
                    if (toast) {
                      toast.style.setProperty('left', 'auto', 'important');
                      toast.style.setProperty('right', '20px', 'important');
                      clearInterval(iv);
                      return;
                    }
                  }
                  if (tries > 60) clearInterval(iv);
                }, 250);
              } catch (e) {}
            `,
          }}
        />
        <div className="layout-wrapper">
          <Sidebar />
          {/* div, а не main: каждая страница приносит свой <main>,
              а вложенные основные области ломают landmark-навигацию */}
          <div className="main-content pb-16 lg:pb-0">
            {children}
            <footer className="border-t border-emerald-dark/10 px-4 py-6 md:px-8">
              <nav aria-label="Правовая информация" className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-5 gap-y-2 text-xs text-brown/60">
                <Link href="/privacy" className="transition-colors hover:text-emerald-dark">Конфиденциальность</Link>
                <Link href="/rules" className="transition-colors hover:text-emerald-dark">Правила сообщества</Link>
                <Link href="/privacy#cookies" className="transition-colors hover:text-emerald-dark">Файлы cookie и аналитика</Link>
                <Link href="/support" className="transition-colors hover:text-emerald-dark">Поддержка</Link>
              </nav>
              <p className="mx-auto mt-3 max-w-7xl text-[11px] text-brown/40">© Хлеба и букв</p>
            </footer>
          </div>
          <MobileNav />
        </div>
        {/* Яндекс.Метрика: скрипт грузится после интерактива, ID из NEXT_PUBLIC_YANDEX_METRIKA_ID */}
        <YandexMetrika />
      </body>
    </html>
  )
}
