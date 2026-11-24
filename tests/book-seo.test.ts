import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getSimilarBooks,
  hasAnyBookDescription,
  hasBookDescription,
  hasLongBookDescription,
  isBookIndexable,
} from '../app/book/[id]/bookSeo'

const shortDescription = 'О'.repeat(120)
const mediumDescription = 'О'.repeat(299)
const longDescription = 'О'.repeat(300)

test('book description helper thresholds remain distinct', () => {
  assert.equal(hasBookDescription(shortDescription), true)
  assert.equal(hasBookDescription('О'.repeat(119)), false)
  assert.equal(hasAnyBookDescription('Коротко'), true)
  assert.equal(hasAnyBookDescription('   '), false)
  assert.equal(hasLongBookDescription(mediumDescription), false)
  assert.equal(hasLongBookDescription(longDescription), true)
})

test('300+ character description indexes only when a cover exists', () => {
  assert.equal(isBookIndexable(longDescription, 'https://example.com/cover.jpg', 0), true)
  assert.equal(isBookIndexable(longDescription, null, 0), false)
  assert.equal(isBookIndexable(longDescription, '   ', 0), false)
})

test('120–299 character descriptions remain noindex without approved posts', () => {
  assert.equal(isBookIndexable(shortDescription, 'cover.jpg', 0), false)
  assert.equal(isBookIndexable(mediumDescription, 'cover.jpg', 0), false)
})

test('an approved publication overrides the 300-character threshold', () => {
  assert.equal(isBookIndexable(shortDescription, 'cover.jpg', 1), true)
  assert.equal(isBookIndexable('коротко', null, 1), true)
})

test('a book without any description remains noindex even with a post or cover', () => {
  assert.equal(isBookIndexable(null, 'cover.jpg', 1), false)
  assert.equal(isBookIndexable('', 'cover.jpg', 0), false)
  assert.equal(isBookIndexable('   ', 'cover.jpg', 1), false)
})

test('similar-book availability does not participate in indexability', () => {
  assert.equal(isBookIndexable(shortDescription, 'cover.jpg', 0), false)
  assert.equal(isBookIndexable(longDescription, 'cover.jpg', 0), true)
})

test('similar books still match normalized author and are capped at five for readers', () => {
  const current = { id: 'current', author: 'Фёдор Достоевский' }
  const candidates = [
    { id: 'current', title: 'Текущая книга', author: 'Фёдор Достоевский' },
    { id: 'one', title: 'Братья Карамазовы', author: 'Федор Достоевский' },
    { id: 'two', title: 'Идиот', author: 'Фёдор Достоевский' },
    { id: 'three', title: 'Преступление и наказание', author: 'Фёдор Достоевский' },
    { id: 'four', title: 'Бесы', author: 'Фёдор Достоевский' },
    { id: 'five', title: 'Подросток', author: 'Фёдор Достоевский' },
    { id: 'six', title: 'Чужой автор', author: 'Антон Чехов' },
  ]

  const similar = getSimilarBooks(current, candidates)
  assert.equal(similar.length, 5)
  assert.equal(similar.some(book => book.id === 'current'), false)
  assert.equal(similar.some(book => book.id === 'six'), false)
})
