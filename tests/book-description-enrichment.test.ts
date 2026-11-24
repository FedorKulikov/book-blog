import assert from 'node:assert/strict'
import test from 'node:test'
import {
  appendOpenLibraryDescription,
  canApplyOpenLibraryDescriptions,
  cleanOpenLibraryDescription,
  getBookTitleMatchType,
  isEnglishAdditionToRussianAnnotation,
  normalizeBookAuthor,
  selectBookDescriptionCandidates,
  selectOpenLibraryWorkMatch,
  splitBookDescription,
  type BookForDescriptionEnrichment,
  type OpenLibraryAuthorDocument,
  type OpenLibrarySearchDocument,
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

test('matches normalized exact and contained titles, but not translated titles', () => {
  assert.equal(getBookTitleMatchType('Преступление и наказание', 'ПРЕСТУПЛЕНИЕ И НАКАЗАНИЕ!'), 'exact')
  assert.equal(getBookTitleMatchType('Тёмная башня: Стрелок', 'Тёмная башня. Стрелок — роман'), 'contained')
  assert.equal(getBookTitleMatchType('Сияние', 'The Shining'), null)
})

test('normalizes author punctuation and ё without loosening author identity', () => {
  assert.equal(normalizeBookAuthor('Фёдор Достоевский'), normalizeBookAuthor('Федор Достоевский'))
  assert.notEqual(normalizeBookAuthor('Фёдор Достоевский'), normalizeBookAuthor('Лев Толстой'))
})

test('requires an exact catalog-author alias and matching Open Library author key', () => {
  const book = validBook({
    title: 'Преступление и наказание',
    author: 'Фёдор Достоевский',
    year: 1891,
  })
  const authors: OpenLibraryAuthorDocument[] = [{
    key: '/authors/OL1A',
    name: 'Fyodor Dostoevsky',
    alternate_names: ['Федор Достоевский'],
  }]
  const documents: OpenLibrarySearchDocument[] = [{
    key: '/works/OL123W',
    title: 'Преступление и наказание: роман',
    author_key: ['OL1A'],
    author_name: ['Fyodor Dostoevsky'],
    first_publish_year: 1866,
  }]

  const selection = selectOpenLibraryWorkMatch(book, authors, documents)
  assert.equal(selection.status, 'matched')
  if (selection.status !== 'matched') return
  assert.equal(selection.titleMatch, 'contained')
  assert.equal(selection.yearDifference, 25)
  assert.equal(selection.document.key, '/works/OL123W')
})

test('does not accept a same-title work by another author', () => {
  const book = validBook({ title: 'Оно', author: 'Стивен Кинг', year: 1986 })
  const authors: OpenLibraryAuthorDocument[] = [{
    key: '/authors/OL1A',
    name: 'Stephen King',
    alternate_names: ['Стивен Кинг'],
  }]
  const documents: OpenLibrarySearchDocument[] = [{
    key: '/works/OL999W',
    title: 'Оно',
    author_key: ['OL2A'],
    author_name: ['Another Author'],
    first_publish_year: 1986,
  }]

  assert.deepEqual(
    selectOpenLibraryWorkMatch(book, authors, documents),
    { status: 'no_author_match' },
  )
})

test('does not accept a title mismatch even when the author matches', () => {
  const book = validBook({ title: 'Сияние', author: 'Стивен Кинг', year: 1977 })
  const authors: OpenLibraryAuthorDocument[] = [{
    key: '/authors/OL1A',
    name: 'Stephen King',
    alternate_names: ['Стивен Кинг'],
  }]
  const documents: OpenLibrarySearchDocument[] = [{
    key: '/works/OL999W',
    title: 'The Shining',
    author_key: ['OL1A'],
    author_name: ['Stephen King'],
    first_publish_year: 1977,
  }]

  assert.deepEqual(
    selectOpenLibraryWorkMatch(book, authors, documents),
    { status: 'no_title_match' },
  )
})

test('the apply safety threshold blocks fewer than five suitable descriptions', () => {
  assert.equal(canApplyOpenLibraryDescriptions(0), false)
  assert.equal(canApplyOpenLibraryDescriptions(4), false)
  assert.equal(canApplyOpenLibraryDescriptions(5), true)
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
