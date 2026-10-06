import { Metadata } from 'next'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params

  const { data, error } = await supabase
    .from('posts')
    .select('title, content, post_images(url), books(title, author, year)')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    console.error('[generateMetadata] post fetch error:', error)
  }

  if (!data) {
    return { title: 'Пост не найден' }
  }

  const image = (data.post_images as any[])?.[0]?.url
  const description = (data.content || '')
    .replace(/\s+/g, ' ')
    .slice(0, 160)
    .trim()

  // Постгресст возвращает to-one связь объектом, а типы клиента выводят её массивом
  const book = Array.isArray(data.books) ? data.books[0] : data.books

  const bookLine = book
    ? `📖 ${book.title}${book.author ? ' — ' + book.author : ''}${book.year ? ', ' + book.year : ''}. `
    : ''

  return {
    title: data.title,
    description: bookLine + description,
    openGraph: {
      title: data.title,
      description: bookLine + description,
      type: 'article',
      images: image ? [{ url: image }] : [],
    },
    twitter: {
      card: 'summary_large_image',
      title: data.title,
      description: bookLine + description,
      images: image ? [image] : [],
    },
  }
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
