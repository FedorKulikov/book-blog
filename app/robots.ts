import { MetadataRoute } from 'next'

// Тот же источник домена, что в layout.tsx и sitemap.ts (никакого хардкода)
const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || 'https://book-blog-main.layero.app'
).replace(/\/+$/, '')

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/admin',
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
