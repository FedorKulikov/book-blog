import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getSimilarBooks,
  hasBookDescription,
  hasAnyBookDescription,
  isBookIndexable,
} from '../app/book/[id]/bookSeo'

const description120 = 'О'.repeat(120)
const description200 = 'О'.repeat(200)
const description299 = 'О'.repeat(299)
const description300 = 'О'.repeat(300)

test('book description helper keeps the 120-character Open Library fallback threshold', () => {
  assert.equal(hasBookDescription(description120), true)
  assert.equal(hasBookDescription('Короткое описание'), false)
  assert.equal(hasBookDescription(''), false)
  assert.equal(hasBookDescription(null), false)
})

test('any non-empty description is distinguishable from a missing description', () => {
  assert.equal(hasAnyBookDescription('Короткое'), true)
  assert.equal(hasAnyBookDescription('   '), false)
  assert.equal(hasAnyBookDescription(null), false)
})

test('300+ characters and a cover are sufficient for indexing', () => {
  assert.equal(isBookIndexable(description300, 'https://cover.example/book.jpg', 0), true)
  assert.equal(isBookIndexable('О'.repeat(418), 'https://cover.example/book.jpg', 0), true)
  assert.equal(isBookIndexable(description300, null, 0), false)
  assert.equal(isBookIndexable(description300, '   ', 0), false)
})

test('120–299 characters remain noindex without an approved post', () => {
  const cover = 'https://cover.example/book.jpg'
  assert.equal(isBookIndexable(description120, cover, 0), false)
  assert.equal(isBookIndexable(description200, cover, 0), false)
  assert.equal(isBookIndexable(description299, cover, 0), false)
})

test('an approved post overrides the length and cover requirements, but not an empty description', () => {
  assert.equal(isBookIndexable(description200, 'https://cover.example/book.jpg', 1), true)
  assert.equal(isBookIndexable('Короткая аннотация', null, 1), true)
  assert.equal(isBookIndexable(description300, null, 1), true)
  assert.equal(isBookIndexable('', 'https://cover.example/book.jpg', 1), false)
  assert.equal(isBookIndexable('   ', null, 3), false)
  assert.equal(isBookIndexable(null, null, 1), false)
})

test('similar books remain available as reader recommendations', () => {
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

test('fewer than three recommendations do not create a similar-books block', () => {
  const current = { id: 'current', author: 'Антон Чехов' }
  const candidates = [
    { id: 'current', title: 'Текущая книга', author: 'Антон Чехов' },
    { id: 'one', title: 'Книга один', author: 'Антон Чехов' },
    { id: 'two', title: 'Книга два', author: 'Антон Чехов' },
  ]
  assert.deepEqual(getSimilarBooks(current, candidates), [])
})
