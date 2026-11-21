import { MetadataRoute } from 'next'
import { supabase } from '@/lib/supabase'

// Домен берём из env (как в layout.tsx). Фолбэк — боевой домен,
// чтобы при отсутствии переменной карта не начала указывать на localhost.
// Регулярка убирает случайный слэш в конце значения.
import { SITE_URL } from '@/lib/site'

type ProfileRow = {
  username: string | null
  created_at: string | null
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Статические страницы
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1,
    },
    {
      url: `${SITE_URL}/books`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/news`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/posts`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/creative`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/discussions`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/external-news`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.7,
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
      url: `${SITE_URL}/post/${p.id}`,
      lastModified: new Date(p.created_at),
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    }))
  } catch (e) {
    console.error('[sitemap] posts fetch failed:', e)
  }

  // Книги: в sitemap попадают только страницы с одобренными публикациями.
  // Пустые карточки остаются доступны в каталоге, но не предлагаются поисковикам
  // как самостоятельные результаты до появления содержательного обсуждения.
  let bookPages: MetadataRoute.Sitemap = []
  try {
    const { data: linkedPosts, error: linkedPostsError } = await supabase
      .from('posts')
      .select('book_id, created_at')
      .eq('status', 'approved')
      .not('book_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(5000)

    if (linkedPostsError) throw linkedPostsError

    const latestPostByBook = new Map<string, string>()
    for (const post of linkedPosts ?? []) {
      if (post.book_id && !latestPostByBook.has(post.book_id)) {
        latestPostByBook.set(post.book_id, post.created_at)
      }
    }

    const bookIds = Array.from(latestPostByBook.keys()).slice(0, 500)
    if (bookIds.length > 0) {
      const { data: books, error: booksError } = await supabase
        .from('books')
        .select('id')
        .in('id', bookIds)

      if (booksError) throw booksError

      bookPages = (books ?? []).map(book => ({
        url: `${SITE_URL}/book/${book.id}`,
        lastModified: new Date(latestPostByBook.get(book.id) ?? new Date()),
        changeFrequency: 'monthly' as const,
        priority: 0.6,
      }))
    }
  } catch (e) {
    console.error('[sitemap] books fetch failed:', e)
  }

  // Публичные профили: username задан и аккаунт не забанен.
  // Пустой username и невидимые под RLS профили просто не попадут в выборку.
  let profilePages: MetadataRoute.Sitemap = []
  try {
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('username, created_at')
      .not('username', 'is', null)
      .eq('is_banned', false)
      .order('created_at', { ascending: false })
      .limit(500)

    if (error) {
      console.error('[sitemap] profiles select failed:', error.message)
    }

    profilePages = ((profiles ?? []) as unknown as ProfileRow[])
      .filter(
        (p): p is ProfileRow & { username: string } =>
          typeof p.username === 'string' && p.username.trim().length > 0,
      )
      .map(p => ({
        url: `${SITE_URL}/profile/${encodeURIComponent(p.username)}`,
        lastModified: p.created_at ? new Date(p.created_at) : new Date(),
        changeFrequency: 'weekly' as const,
        priority: 0.6,
      }))
  } catch (e) {
    console.error('[sitemap] profiles fetch failed:', e)
  }

  return [...staticPages, ...postPages, ...bookPages, ...profilePages]
}
