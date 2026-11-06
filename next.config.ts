import type { NextConfig } from "next";
import dns from 'node:dns'
// Принудительно используем IPv4 для предотвращения ошибок ECONNRESET
dns.setDefaultResultOrder('ipv4first')

const nextConfig: NextConfig = {
  // Убираем круглый индикатор Next.js в dev-режиме: он висел поверх
  // сайдбара рядом с тумблером темы и выглядел как белая кнопка с обводкой.
  // На прод-сборку настройка не влияет.
  devIndicators: false,
};

export default nextConfig;
