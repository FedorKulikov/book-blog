import assert from 'node:assert/strict'
import test from 'node:test'
import {
  appendOpenLibraryDescription,
  cleanOpenLibraryDescription,
  isEnglishAdditionToRussianAnnotation,
  selectBookDescriptionCandidates,
  splitBookDescription,
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


test('splits the stored Open Library section and validates its source link', () => {
  const original = 'Русская аннотация из каталога.'
  const additional = 'The story of the young man and his family is told in this book, with the main events and characters described in detail.'
  const stored = [
    original,
    '---',
    'Дополнение из Open Library (источник: https://openlibrary.org/works/OL12345W)',
    additional,
  ].join('\n\n')

  const parsed = splitBookDescription(stored)
  assert.equal(parsed.originalDescription, original)
  assert.equal(parsed.additionalDescription, additional)
  assert.equal(parsed.sourceUrl, 'https://openlibrary.org/works/OL12345W')
  assert.equal(
    isEnglishAdditionToRussianAnnotation(parsed.originalDescription, additional),
    true,
  )
})

test('does not mark a Russian addition or a non-Russian annotation as English', () => {
  assert.equal(
    isEnglishAdditionToRussianAnnotation(
      'Русская аннотация из каталога. '.repeat(4),
      'Русское дополнение из каталога. '.repeat(12),
    ),
    false,
  )
  assert.equal(
    isEnglishAdditionToRussianAnnotation(
      'An original English book description with enough common words. '.repeat(2),
      'The additional description is also written in English and tells the story.',
    ),
    false,
  )
})

test('keeps an unmarked catalog description intact', () => {
  const original = 'Обычная каталожная аннотация без дополнения.'
  assert.deepEqual(splitBookDescription(original), {
    originalDescription: original,
    additionalDescription: null,
    sourceUrl: null,
  })
})
