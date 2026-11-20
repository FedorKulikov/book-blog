import { MetadataRoute } from 'next'

// Тот же источник домена, что в layout.tsx и sitemap.ts (никакого хардкода)
import { SITE_URL } from '@/lib/site'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/admin',
        '/news/new',
        '/messages',
        '/profile/edit',
        '/support',
        '/welcome',
        '/login',
        '/signup',
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  }
}
