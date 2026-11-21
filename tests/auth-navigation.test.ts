import assert from 'node:assert/strict'
import test from 'node:test'

import { getPostAuthPath, safeInternalPath } from '../lib/auth-navigation'

test('safeInternalPath rejects protocol-relative and normalized external paths', () => {
  for (const value of [
    '//evil.com',
    '/\\evil.com',
    '/..//evil.com',
    '/./\\evil.com',
    '/%2f%2fevil.com',
    '/%5c%5cevil.com',
  ]) {
    assert.equal(safeInternalPath(value), '/', `expected rejection for ${JSON.stringify(value)}`)
  }
})

test('safeInternalPath preserves valid internal paths, query and hash', () => {
  assert.equal(safeInternalPath('/books/123?tab=reviews#latest'), '/books/123?tab=reviews#latest')
  assert.equal(safeInternalPath('/profile'), '/profile')
})

test('safeInternalPath rejects absolute external URLs and malformed values', () => {
  assert.equal(safeInternalPath('https://evil.com'), '/')
  assert.equal(safeInternalPath('not-a-path'), '/')
  assert.equal(safeInternalPath(undefined), '/')
})

test('getPostAuthPath applies the same redirect validation', () => {
  assert.equal(getPostAuthPath('?next=%2F..%2F%2Fevil.com'), '/')
  assert.equal(getPostAuthPath('?next=%2Fbooks%2F123'), '/books/123')
  assert.equal(getPostAuthPath('?next=%2Flogin'), '/welcome')
  assert.equal(getPostAuthPath('?next=%2Fsignup'), '/welcome')
  assert.equal(getPostAuthPath('?next=%2Fforgot-password'), '/welcome')
  assert.equal(getPostAuthPath('?next=%2Fauth%2Fconfirm'), '/welcome')
  assert.equal(getPostAuthPath(''), '/welcome')
})
