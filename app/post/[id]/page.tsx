// app/post/[id]/page.tsx
// Server Component: данные поста попадают в HTML сразу (видят поисковики),
// а вся интерактивность живёт в PostView ('use client').
import { notFound } from 'next/navigation'
import { getPost } from './getPost'
import PostView from './PostView'

export default async function PostPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const post = await getPost(id)

  if (!post) {
    notFound()
  }

  return <PostView post={post} />
}
