import { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/admin',
        '/messages',
        '/profile/edit',
        '/welcome',
        '/login',
        '/signup',
      ],
    },
    sitemap: 'https://book-blog-main.layero.app/sitemap.xml',
    host: 'https://book-blog-main.layero.app',
  }
}
