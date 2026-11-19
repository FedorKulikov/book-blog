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
    ],
  },
};

export default nextConfig;
