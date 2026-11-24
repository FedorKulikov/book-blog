import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getSimilarBooks,
  hasBookDescription,
  isBookIndexable,
} from '../app/book/[id]/bookSeo'

const description = 'О'.repeat(120)

test('book description needs at least 120 plain-text characters', () => {
  assert.equal(hasBookDescription(description), true)
  assert.equal(hasBookDescription('Короткое описание'), false)
  assert.equal(hasBookDescription(''), false)
  assert.equal(hasBookDescription(null), false)
})

test('indexing requires a useful description and one complete content block', () => {
  assert.equal(isBookIndexable(description, 3, 0), true)
  assert.equal(isBookIndexable(description, 5, 0), true)
  assert.equal(isBookIndexable(description, 0, 1), true)
  assert.equal(isBookIndexable(description, 2, 0), false)
  assert.equal(isBookIndexable(description, 0, 0), false)
  assert.equal(isBookIndexable('Коротко', 5, 1), false)
  assert.equal(isBookIndexable(null, 5, 1), false)
})

test('similar books match normalized author, exclude current book and cap at five', () => {
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
