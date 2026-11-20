import type { NextConfig } from "next";
import dns from 'node:dns'
// Принудительно используем IPv4 для предотвращения ошибок ECONNRESET
dns.setDefaultResultOrder('ipv4first')

const nextConfig: NextConfig = {
  // Убираем круглый индикатор Next.js в dev-режиме: он висел поверх
  // сайдбара рядом с тумблером темы и выглядел как белая кнопка с обводкой.
  // На прод-сборку настройка не влияет.
  devIndicators: false,

  images: {
    // Обложки внешних новостей живут на чужих доменах. Часть из них
    // (litkarta.ru) отдаёт картинки ТОЛЬКО по http — браузер на нашем
    // https-сайте заблокировал бы их как Mixed Content. Поэтому картинки
    // идут через оптимизатор Next: он качает их на сервере и отдаёт
    // уже по https, без предупреждений браузера.
    remotePatterns: [
      { protocol: 'https', hostname: 'www.litkarta.ru', pathname: '/**' },
      { protocol: 'http', hostname: 'www.litkarta.ru', pathname: '/**' },
      { protocol: 'https', hostname: 'litkarta.ru', pathname: '/**' },
      { protocol: 'http', hostname: 'litkarta.ru', pathname: '/**' },
      { protocol: 'https', hostname: 'eksmo.ru', pathname: '/**' },
      { protocol: 'https', hostname: 'www.eksmo.ru', pathname: '/**' },
      { protocol: 'http', hostname: 'www.museumbook.ru', pathname: '/**' },
      { protocol: 'https', hostname: 'www.museumbook.ru', pathname: '/**' },
      { protocol: 'https', hostname: 'covers.openlibrary.org', pathname: '/**' },
      // Превью из поисковых лент (Bing News). Остальные домены новостей
      // в оптимизатор не вносим: ExternalNewsCover умеет откатываться
      // на обычный <img>, и картинка всё равно покажется.
      { protocol: 'https', hostname: 'www.bing.com', pathname: '/**' },
      { protocol: 'https', hostname: 'bing.com', pathname: '/**' },
      // Bing отдаёт превью по http — без этих правил оптимизатор их отклонит
      { protocol: 'http', hostname: 'www.bing.com', pathname: '/**' },
      { protocol: 'http', hostname: 'bing.com', pathname: '/**' },
    ],
  },

  /**
   * Индексация служебных страниц.
   *
   * robots.txt умеет только запрещать сканирование, но запрещённый URL
   * всё равно может попасть в индекс — робот не прочитает страницу и не
   * увидит noindex. Поэтому служебные адреса НЕ закрываем в robots.txt,
   * а отдаём заголовок X-Robots-Tag: noindex: робот страницу прочитает
   * и в выдачу не поставит.
   */
  async headers() {
    const noindex = [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }]

    return [
      { source: '/news/new', headers: noindex },
      { source: '/login', headers: noindex },
      { source: '/signup', headers: noindex },
      { source: '/forgot-password', headers: noindex },
      { source: '/auth/confirm', headers: noindex },
      { source: '/auth/reset', headers: noindex },
      { source: '/recover-account', headers: noindex },
      { source: '/welcome', headers: noindex },
      { source: '/profile/edit', headers: noindex },
      { source: '/messages/:path*', headers: noindex },
      { source: '/admin/:path*', headers: noindex },
      { source: '/support/:path*', headers: noindex },
    ]
  },
};

export default nextConfig;
