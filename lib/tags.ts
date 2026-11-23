import type { SupabaseClient } from '@supabase/supabase-js'

export function decodeTagSlug(value: string): string | null {
  try { return decodeURIComponent(value) } catch { return null }
}

export function normalizeTagName(value: string): string {
  return value.normalize('NFC').trim().replace(/^#+/u, '').trim().replace(/\s+/gu, ' ')
}

export function createTagSlug(value: string): string {
  return normalizeTagName(value).toLowerCase()
    .replace(/\s+/gu, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '')
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '')
}

/** Hashtags are whitespace-separated; plain labels remain comma-separated. */
export function parseTagInput(input: string): string[] {
  const hashtags = input.match(/#[\p{L}\p{N}_-]+/gu) ?? []
  const candidates = hashtags.length > 0
    ? hashtags.map(value => value.slice(1))
    : input.split(/[,;\n]+/u)
  const seen = new Set<string>()
  return candidates.map(normalizeTagName).filter(name => {
    const slug = createTagSlug(name)
    if (!slug || seen.has(slug)) return false
    seen.add(slug)
    return true
  })
}

export async function savePostTags(
  supabase: SupabaseClient,
  postId: string,
  input: string,
): Promise<void> {
  for (const name of parseTagInput(input)) {
    const slug = createTagSlug(name)
    const { data: existing, error: lookupError } = await supabase
      .from('tags').select('id').eq('slug', slug).maybeSingle()
    if (lookupError) throw new Error(lookupError.message)
    let tagId = existing?.id as string | undefined
    if (!tagId) {
      const { data: created, error: createError } = await supabase
        .from('tags').insert({ name, slug }).select('id').single()
      if (createError?.code === '23505') {
        const { data: concurrent, error: retryError } = await supabase
          .from('tags').select('id').eq('slug', slug).maybeSingle()
        if (retryError || !concurrent?.id) throw new Error(retryError?.message ?? createError.message)
        tagId = concurrent.id as string
      } else if (createError) {
        throw new Error(createError.message)
      } else {
        tagId = created?.id as string | undefined
      }
    }
    if (!tagId) throw new Error(`Не удалось создать тег «${name}».`)
    const { error: linkError } = await supabase
      .from('post_tags').insert({ post_id: postId, tag_id: tagId })
    if (linkError && linkError.code !== '23505') throw new Error(linkError.message)
  }
}
