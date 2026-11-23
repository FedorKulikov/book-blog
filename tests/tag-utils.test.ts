import assert from 'node:assert/strict'
import test from 'node:test'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createTagSlug,
  decodeTagSlug,
  normalizeTagName,
  parseTagInput,
  savePostTags,
} from '../lib/tags'

test('decodes percent-encoded and already-decoded Cyrillic slugs', () => {
  assert.equal(decodeTagSlug('%D1%82%D0%B2%D0%BE%D1%80%D1%87%D0%B5%D1%81%D1%82%D0%B2%D0%BE'), 'творчество')
  assert.equal(decodeTagSlug('творчество'), 'творчество')
})

test('rejects malformed URL encoding distinctly from a missing tag', () => {
  assert.equal(decodeTagSlug('%E0%A4%A'), null)
})

test('splits whitespace-separated hashtags into three names and slugs', () => {
  const names = parseTagInput('#книги #чтение #обзор')
  assert.deepEqual(names, ['книги', 'чтение', 'обзор'])
  assert.deepEqual(names.map(createTagSlug), ['книги', 'чтение', 'обзор'])
})

test('publishing with three hashtags creates three tag rows and three post links', async () => {
  const tags: Array<{ id: string; name: string; slug: string }> = []
  const links: Array<{ post_id: string; tag_id: string }> = []
  let sequence = 0

  const fakeClient = {
    from(table: string) {
      let inserted: Record<string, string> | null = null
      let slugFilter: string | null = null
      const query = {
        select() { return query },
        eq(_column: string, value: string) { slugFilter = value; return query },
        async maybeSingle() {
          return { data: tags.find(tag => tag.slug === slugFilter) ?? null, error: null }
        },
        insert(values: Record<string, string>) {
          inserted = values
          if (table === 'post_tags') {
            links.push(values as { post_id: string; tag_id: string })
            return Promise.resolve({ error: null })
          }
          return query
        },
        async single() {
          assert.ok(inserted)
          const row = { id: `tag-${++sequence}`, ...inserted }
          tags.push(row)
          return { data: row, error: null }
        },
      }
      return query
    },
  } as unknown as SupabaseClient

  await savePostTags(fakeClient, 'post-123', '#книги #чтение #обзор')

  assert.deepEqual(tags.map(tag => tag.name), ['книги', 'чтение', 'обзор'])
  assert.deepEqual(tags.map(tag => tag.slug), ['книги', 'чтение', 'обзор'])
  assert.equal(links.length, 3)
  assert.deepEqual(links.map(link => link.post_id), ['post-123', 'post-123', 'post-123'])
})

test('strips hash prefixes and normalizes whitespace and punctuation', () => {
  assert.equal(normalizeTagName('  ##Книги   о   море '), 'Книги о море')
  assert.equal(createTagSlug('##Книги   о   море'), 'книги-о-море')
})

test('keeps plain comma-separated multiword labels supported', () => {
  assert.deepEqual(parseTagInput('научная фантастика, классика'), ['научная фантастика', 'классика'])
})

test('deduplicates hashtags that differ only by case', () => {
  assert.deepEqual(parseTagInput('#Книги #книги #Чтение'), ['Книги', 'Чтение'])
})
