import assert from 'node:assert/strict'
import test from 'node:test'
import { getChatMediaObjectPath } from '../lib/chat-media-path'

test('accepts new bucket-relative paths', () => {
  assert.equal(
    getChatMediaObjectPath('00000000-0000-0000-0000-000000000001/photo.jpg'),
    '00000000-0000-0000-0000-000000000001/photo.jpg',
  )
})

test('extracts legacy public chat media URLs', () => {
  assert.equal(
    getChatMediaObjectPath(
      'https://project.supabase.co/storage/v1/object/public/chat-media/user-1/photo.jpg',
    ),
    'user-1/photo.jpg',
  )
})

test('decodes URL-encoded object names and strips query strings', () => {
  assert.equal(
    getChatMediaObjectPath(
      'https://project.supabase.co/storage/v1/object/public/chat-media/user-1/a%20b.jpg?download=1',
    ),
    'user-1/a b.jpg',
  )
})

test('extracts object paths from signed URLs so they can be renewed', () => {
  assert.equal(
    getChatMediaObjectPath(
      'https://project.supabase.co/storage/v1/object/sign/chat-media/user-1/photo.jpg?token=secret',
    ),
    'user-1/photo.jpg',
  )
})

test('does not reinterpret unrelated or external URLs as private chat paths', () => {
  assert.equal(getChatMediaObjectPath('https://cdn.example.com/photo.jpg'), null)
  assert.equal(getChatMediaObjectPath('/images/photo.jpg'), null)
  assert.equal(getChatMediaObjectPath(null), null)
  assert.equal(getChatMediaObjectPath(''), null)
})
