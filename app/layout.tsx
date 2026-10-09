import { Playfair_Display, Inter } from 'next/font/google'
import { Metadata } from 'next'
import Sidebar from './components/Header'
import MobileNav from './components/MobileNav'
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
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
  ),
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
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ru" className={`${playfair.variable} ${inter.variable}`}>
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
          <main className="main-content pb-16 lg:pb-0">{children}</main>
          <MobileNav />
        </div>
      </body>
    </html>
  )
}