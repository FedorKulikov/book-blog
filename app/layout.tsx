import { Playfair_Display, Inter } from 'next/font/google'
import Sidebar from './components/Header'
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

export const metadata = {
  title: 'Хлеба и букв',
  description: 'Книги. Люди. Идеи. Творчество.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ru" className={`${playfair.variable} ${inter.variable}`}>
      <body className="bg-cream text-brown-dark">
        <div className="flex min-h-screen">
          <Sidebar />
          <main className="flex-1 min-w-0">{children}</main>
        </div>
      </body>
    </html>
  )
}