import { MetadataRoute } from 'next'
import { supabase } from '@/lib/supabase'

const BASE_URL = 'https://book-blog-main.layero.app'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Статические страницы
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: BASE_URL,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1,
    },
    {
      url: `${BASE_URL}/books`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: `${BASE_URL}/news`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: `${BASE_URL}/creative`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      url: `${BASE_URL}/discussions`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.8,
    },
  ]

  // Посты (только одобренные). try/catch обязателен: на этапе сборки
  // Next пререндерит sitemap, а доступ к Supabase может отсутствовать —
  // тогда карта вернётся хотя бы со статическими страницами.
  let postPages: MetadataRoute.Sitemap = []
  try {
    const { data: posts } = await supabase
      .from('posts')
      .select('id, created_at')
      .eq('status', 'approved')
      .order('created_at', { ascending: false })
      .limit(500)

    postPages = (posts || []).map(p => ({
      url: `${BASE_URL}/post/${p.id}`,
      lastModified: new Date(p.created_at),
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    }))
  } catch (e) {
    console.error('[sitemap] posts fetch failed:', e)
  }

  // Книги
  let bookPages: MetadataRoute.Sitemap = []
  try {
    const { data: books } = await supabase
      .from('books')
      .select('id, created_at')
      .order('created_at', { ascending: false })
      .limit(500)

    bookPages = (books || []).map(b => ({
      url: `${BASE_URL}/book/${b.id}`,
      lastModified: new Date(b.created_at),
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    }))
  } catch (e) {
    console.error('[sitemap] books fetch failed:', e)
  }

  return [...staticPages, ...postPages, ...bookPages]
}
