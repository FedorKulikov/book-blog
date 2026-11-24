import assert from 'node:assert/strict'
import test from 'node:test'
import {
  appendOpenLibraryDescription,
  cleanOpenLibraryDescription,
  selectBookDescriptionCandidates,
  type BookForDescriptionEnrichment,
} from '../lib/book-description-enrichment'

const validBook = (
  overrides: Partial<BookForDescriptionEnrichment> = {},
): BookForDescriptionEnrichment => ({
  id: 'book-short',
  title: 'Книга',
  author: 'Автор',
  year: 2000,
  description: 'Старая аннотация. '.repeat(9),
  cover_url: 'https://example.test/cover.jpg',
  ...overrides,
})

test('selects only short covered books without approved publications', () => {
  const books = [
    validBook(),
    validBook({ id: 'approved' }),
    validBook({ id: 'long', description: 'Д'.repeat(300) }),
    validBook({ id: 'no-cover', cover_url: null }),
    validBook({ id: 'too-short', description: 'коротко' }),
  ]

  const candidates = selectBookDescriptionCandidates(books, new Set(['approved']))
  assert.deepEqual(candidates.map(book => book.id), ['book-short'])
})

test('cleans Open Library HTML and decodes text entities', () => {
  assert.equal(
    cleanOpenLibraryDescription('<p>Первая&nbsp;строка</p><p>Вторая &amp; третья</p>'),
    'Первая строка\n\nВторая & третья',
  )
})

test('appends a substantial Open Library description without replacing catalog text', () => {
  const original = 'Оригинальная аннотация из каталога.'
  const imported = 'Расширенное описание произведения. '.repeat(12)
  const merged = appendOpenLibraryDescription(original, imported, 'OL12345W')

  assert.ok(merged)
  assert.ok(merged.startsWith(original))
  assert.ok(merged.includes('https://openlibrary.org/works/OL12345W'))
  assert.ok(merged.includes(imported.trim()))
})

test('does not append absent, short, or invalid Open Library descriptions', () => {
  assert.equal(appendOpenLibraryDescription('Старая аннотация', 'Нет описания.', 'OL12345W'), null)
  assert.equal(appendOpenLibraryDescription('Старая аннотация', 'Д'.repeat(299), 'OL12345W'), null)
  assert.equal(appendOpenLibraryDescription('Старая аннотация', 'Д'.repeat(400), 'invalid-key'), null)
})

test('does not append an Open Library section twice', () => {
  const original = 'Каталожная аннотация. '.repeat(10)
  const imported = 'Описание API. '.repeat(30)
  const merged = appendOpenLibraryDescription(original, imported, 'OL12345W')

  assert.ok(merged)
  assert.equal(appendOpenLibraryDescription(merged, imported, 'OL12345W'), null)
})
