import { MetadataRoute } from 'next'

// Тот же источник домена, что в layout.tsx и sitemap.ts (никакого хардкода)
import { SITE_URL } from '@/lib/site'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      // Служебные страницы НЕ запрещаем сканировать: иначе робот не прочитает
      // их X-Robots-Tag: noindex и может поставить URL в индекс без описания.
      // Заголовок noindex для них выставляется в next.config.ts.
      allow: '/',
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  }
}
