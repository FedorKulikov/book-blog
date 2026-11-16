/**
 * scripts/import-books.ts
 *
 * Импорт книг из ZIP-архива: каждая папка = одна книга, внутри
 * DOCX с литературной аннотацией и файл обложки (AVIF/JPG/PNG).
 *
 * Запуск:
 *   npx tsx scripts/import-books.ts ./knigi.zip                     # только новые книги
 *   npx tsx scripts/import-books.ts ./knigi.zip --dry-run           # показать план
 *   npx tsx scripts/import-books.ts ./knigi.zip --update-existing   # обновить существующие
 *   npx tsx scripts/import-books.ts ./knigi.zip --update-existing --skip-failed  # отложить сбои
 *   npx tsx scripts/import-books.ts --fix-authors                   # проставить авторов
 *
 * Переменные окружения:
 *   SUPABASE_URL                — адрес проекта (или NEXT_PUBLIC_SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY   — service_role ключ (bypass RLS, только локально/в CI!)
 *   BOOKS_BUCKET                — бакет Storage (по умолчанию post-images)
 *
 * Что делает:
 *   1. читает ZIP целиком в память (без распаковки на диск — имена с битой
 *      кодировкой не ломают файловую систему);
 *   2. декодирует имена: UTF-8 → CP866 → CP1251;
 *   3. извлекает текст DOCX (mammoth) и чистит его;
 *   4. конвертирует обложку в JPEG (sharp), AVIF Supabase Storage не любит;
 *   5. пропускает дубликаты по названию (и автору, если он известен);
 *   6. вставляет только новые записи в public.books.
 */
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import yauzl from 'yauzl'
import mammoth from 'mammoth'
import sharp from 'sharp'
import iconv from 'iconv-lite'
import { createClient } from '@supabase/supabase-js'

/* ------------------------------------------------------------------ */
/* Конфигурация                                                        */
/* ------------------------------------------------------------------ */

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
/** --fix-authors: не читать архив, а проставить авторов уже импортированным книгам */
const FIX_AUTHORS = args.includes('--fix-authors')
/** --update-existing: обновить уже существующие книги обложкой и аннотацией из архива */
const UPDATE_EXISTING = args.includes('--update-existing')
/** --skip-failed: не считать ошибкой книгу, которая не прошла после всех повторов */
const SKIP_FAILED = args.includes('--skip-failed')
const zipPath =
  args.find(a => !a.startsWith('--')) ??
  process.env.BOOKS_ZIP ??
  './knigi.zip'

const BUCKET = process.env.BOOKS_BUCKET ?? 'post-images'
const STORAGE_PREFIX = 'books'
const DESCRIPTION_MAX = 4000
const COVER_QUALITY = 82

const COVER_EXTENSIONS = ['.avif', '.jpg', '.jpeg', '.png', '.webp']

/* ------------------------------------------------------------------ */
/* Типы                                                                */
/* ------------------------------------------------------------------ */

type ZipEntry = {
  name: string
  data: Buffer
}

type ParsedBook = {
  folder: string
  title: string
  author: string | null
  /** Откуда взялся автор, если его нашли в интернете или справочнике */
  authorSource?: 'manual' | 'google-books' | 'open-library'
  description: string
  coverName: string
  coverData: Buffer
}

type Stats = {
  folders: number
  processed: number
  inserted: number
  updated: number
  duplicates: number
  skipped: number
  /** Сколько книг обновлено/добавлено без обложки из-за сбоя Storage */
  coversFailed: number
  /** Сколько книг отложено после исчерпания повторов (--skip-failed) */
  postponed: number
}

type ExistingRow = {
  id: string
  title: string
  tokens: string[]
  author: string | null
  coverUrl: string | null
}

/* ------------------------------------------------------------------ */
/* Логи                                                                */
/* ------------------------------------------------------------------ */

function log(...args: unknown[]): void {
  console.log('[import-books]', ...args)
}

function logWarn(...args: unknown[]): void {
  console.warn('[import-books]', ...args)
}

/* ------------------------------------------------------------------ */
/* ZIP: чтение и декодирование имён                                    */
/* ------------------------------------------------------------------ */

/**
 * Имена в архиве могут быть без UTF-8-флага (архив собран на русской Windows).
 * Порядок проб: UTF-8 → CP866 → CP1251.
 */
function decodeEntryName(buffer: Buffer): string {
  const utf8 = buffer.toString('utf8')
  if (!utf8.includes('\uFFFD')) return utf8

  const cp866 = iconv.decode(buffer, 'cp866')
  if (!cp866.includes('\uFFFD')) return cp866

  return iconv.decode(buffer, 'cp1251')
}

async function readZipEntries(path: string): Promise<ZipEntry[]> {
  return new Promise((resolve, reject) => {
    const entries: ZipEntry[] = []

    yauzl.open(path, { lazyEntries: true, decodeStrings: false }, (error, zip) => {
      if (error || !zip) {
        reject(error ?? new Error('не удалось открыть архив'))
        return
      }

      zip.readEntry()

      zip.on('entry', (entry: yauzl.Entry) => {
        const rawName = entry.fileName as unknown as Buffer
        const decoded = decodeEntryName(
          Buffer.isBuffer(rawName) ? rawName : Buffer.from(String(rawName)),
        )
        // Архивы, собранные на Windows, иногда хранят разделители как «\»
        const name = decoded.replace(/\\/g, '/')

        // Папки пропускаем: книги определяем по файлам
        if (name.endsWith('/')) {
          zip.readEntry()
          return
        }

        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) {
            zip.readEntry()
            return
          }

          const chunks: Buffer[] = []
          stream.on('data', chunk => chunks.push(chunk as Buffer))
          stream.on('end', () => {
            entries.push({ name, data: Buffer.concat(chunks) })
            zip.readEntry()
          })
          stream.on('error', () => zip.readEntry())
        })
      })

      zip.on('end', () => resolve(entries))
      zip.on('error', reject)
    })
  })
}

/* ------------------------------------------------------------------ */
/* Разбор содержимого                                                  */
/* ------------------------------------------------------------------ */

function baseName(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] ?? path
}

function folderOf(path: string): string {
  return path.split('/')[0] ?? ''
}

function extensionOf(path: string): string {
  const name = baseName(path).toLowerCase()
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot)
}

function isCover(path: string): boolean {
  return COVER_EXTENSIONS.includes(extensionOf(path))
}

/** Ключ для сравнения дубликатов: регистр, ё и пунктуация не важны */
function dedupeKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/g, ' ')
    .trim()
}

/** Значимые слова названия (короткие предлоги и цифры отбрасываем) */
function titleTokens(value: string): string[] {
  return dedupeKey(value)
    .split(' ')
    .filter(token => token.length > 2)
}

/**
 * В архиве названия усечены: «кубок огня» вместо «Гарри Поттер и Кубок огня».
 * Поэтому кроме точного совпадения проверяем покрытие слов названия
 * (с учётом словоформ по первым 4 буквам: «приключение» ~ «приключения»).
 */
function isLikelyDuplicate<T extends { title: string; tokens: string[] }>(
  title: string,
  candidates: T[],
): T | null {
  const tokens = titleTokens(title)
  if (tokens.length === 0) return null

  for (const candidate of candidates) {
    let hits = 0

    for (const token of tokens) {
      const prefix = token.slice(0, 4)
      const matched = candidate.tokens.some(
        other =>
          other === token ||
          (other.length >= 4 && prefix.length >= 4 && other.slice(0, 4) === prefix),
      )
      if (matched) hits++
    }

    if (hits / tokens.length >= 0.8) return candidate
  }

  return null
}

/**
 * Вид названия в каталоге: заглавной становится только первая буква.
 * - «анна каренина» → «Анна каренина»
 * - «generation «п»» → «Generation «п»»
 * - «1984», «451 градус по фаренгейту» — не меняем (начинаются с цифры)
 * - уже заглавные и аббревиатуры не трогаем
 */
function normalizeTitle(value: string): string {
  const title = value.trim()
  if (!title) return title

  const firstLetter = title.charAt(0)

  // Не буква (цифра, кавычка, знак) — оставляем как есть
  if (!/[a-zа-яё]/i.test(firstLetter)) return title

  // Уже заглавная — не трогаем остальные буквы
  if (firstLetter !== firstLetter.toLowerCase()) return title

  return firstLetter.toUpperCase() + title.slice(1)
}

/**
 * Название и автор из имени папки. Чаще всего там только название
 * («12 стульев», «1984»), иногда — «Название — Автор».
 */
function parseTitleAndAuthor(folder: string): { title: string; author: string | null } {
  const clean = folder.replace(/_/g, ' ').replace(/\s+/g, ' ').trim()

  const match = /^(.{2,200}?)\s+[—–]\s+(.{2,80})$/.exec(clean)
  if (match) {
    const left = (match[1] ?? '').trim()
    const right = (match[2] ?? '').trim()
    // Автор обычно с заглавной буквы и без цифр
    if (left && right && /^[A-ZА-ЯЁ]/.test(right) && !/\d{2,}/.test(right)) {
      return { title: left, author: right }
    }
  }

  return { title: clean, author: null }
}

/** Чистим текст DOCX: убираем лишние пустые строки и пробелы */
function cleanDescription(raw: string): string {
  return raw
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, DESCRIPTION_MAX)
}

async function readDocxText(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer })
  return cleanDescription(result.value)
}

/** Конвертация обложки в JPEG (AVIF/PNG тоже переводим — стабильнее в Storage) */
async function coverToJpeg(data: Buffer): Promise<Buffer> {
  return sharp(data)
    .rotate()
    .resize({ width: 1200, withoutEnlargement: true })
    .jpeg({ quality: COVER_QUALITY, mozjpeg: true })
    .toBuffer()
}

async function buildBooks(entries: ZipEntry[], stats: Stats): Promise<ParsedBook[]> {
  const byFolder = new Map<string, ZipEntry[]>()

  for (const entry of entries) {
    const folder = folderOf(entry.name)
    if (!folder || folder === '__MACOSX') continue
    const list = byFolder.get(folder)
    if (list) list.push(entry)
    else byFolder.set(folder, [entry])
  }

  stats.folders = byFolder.size
  const books: ParsedBook[] = []

  for (const [folder, files] of byFolder) {
    const docx = files.find(f => extensionOf(f.name) === '.docx')
    const cover = files.find(f => isCover(f.name))

    if (!docx) {
      logWarn(`пропуск «${folder}»: нет DOCX`)
      stats.skipped++
      continue
    }
    if (!cover) {
      logWarn(`пропуск «${folder}»: нет обложки`)
      stats.skipped++
      continue
    }

    const parsed = parseTitleAndAuthor(folder)

    // Название могло быть усечено при сборке архива — сверяемся со справочником
    const alias = TITLE_ALIASES.get(dedupeKey(parsed.title))
    const title = alias ?? normalizeTitle(parsed.title)

    if (title.length < 2) {
      logWarn(`пропуск «${folder}»: не удалось определить название`)
      stats.skipped++
      continue
    }

    let description = ''
    try {
      description = await readDocxText(docx.data)
    } catch (error) {
      logWarn(
        `пропуск «${folder}»: DOCX не читается (${error instanceof Error ? error.message : error})`,
      )
      stats.skipped++
      continue
    }

    if (description.length < 40) {
      logWarn(`пропуск «${folder}»: слишком короткая аннотация`)
      stats.skipped++
      continue
    }

    books.push({
      folder,
      title,
      author: parsed.author,
      description,
      coverName: baseName(cover.name),
      coverData: cover.data,
    })
  }

  return books
}

/* ------------------------------------------------------------------ */
/* Ручной справочник авторов                                          */
/* ------------------------------------------------------------------ */

/**
 * Внешние API ненадёжны (Google Books без ключа — 429, Open Library слабо
 * знает русские издания), поэтому основные авторы лежат в файле
 * scripts/book-authors.json: название → автор. Справочник имеет приоритет.
 */
const MANUAL_AUTHORS_PATH =
  process.env.BOOKS_AUTHORS_FILE ?? 'scripts/book-authors.json'

function loadManualAuthors(): Map<string, string> {
  try {
    const raw = readFileSync(MANUAL_AUTHORS_PATH, 'utf8')
    const parsed = JSON.parse(raw) as Record<string, string>
    const map = new Map<string, string>()

    for (const [title, author] of Object.entries(parsed)) {
      if (title && author) map.set(dedupeKey(title), author)
    }

    return map
  } catch {
    // Файла нет — работаем без него
    return new Map()
  }
}

const MANUAL_AUTHORS = loadManualAuthors()

/* ------------------------------------------------------------------ */
/* Исправление названий, усечённых в архиве                            */
/* ------------------------------------------------------------------ */

const TITLE_ALIASES_PATH =
  process.env.BOOKS_TITLES_FILE ?? 'scripts/book-titles.json'

function loadTitleAliases(): Map<string, string> {
  try {
    const raw = readFileSync(TITLE_ALIASES_PATH, 'utf8')
    const parsed = JSON.parse(raw) as Record<string, string>
    const map = new Map<string, string>()

    for (const [from, to] of Object.entries(parsed)) {
      if (from && to) map.set(dedupeKey(from), to)
    }

    return map
  } catch {
    return new Map()
  }
}

const TITLE_ALIASES = loadTitleAliases()

/* ------------------------------------------------------------------ */
/* Google Books: поиск автора по названию                              */
/* ------------------------------------------------------------------ */

const GOOGLEBOOKS_DELAY_MS = 300
const GOOGLEBOOKS_TIMEOUT_MS = 8_000

/**
 * Без API-ключа Google Books сидит на общей анонимной квоте,
 * которая почти всегда исчерпана (HTTP 429 на первый же запрос).
 * Поэтому по умолчанию работаем через Open Library, а Google Books
 * включается, если задан GOOGLE_BOOKS_API_KEY (1000 запросов/сутки бесплатно).
 */
const GOOGLE_BOOKS_API_KEY = process.env.GOOGLE_BOOKS_API_KEY ?? ''
let googleBooksDisabled = !GOOGLE_BOOKS_API_KEY

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/* ------------------------------------------------------------------ */
/* Повторы при транзиентных сетевых сбоях                              */
/* ------------------------------------------------------------------ */

/** Нарастающие паузы: 5 попыток = 4 паузы 1000 → 2000 → 3000 → 5000 мс */
const RETRY_DELAYS_MS = [1_000, 2_000, 3_000, 5_000]
const RETRY_ATTEMPTS = RETRY_DELAYS_MS.length + 1

type Attempt<T> = { ok: true; value: T } | { ok: false; error: string }

/**
 * Повторяет операцию до успеха или исчерпания попыток.
 * Антивирус на машине пользователя рвёт соединения выборочно —
 * поэтому любая сетевая операция должна уметь пережить несколько обрывов.
 */
async function retry<T>(
  label: string,
  attempt: () => Promise<Attempt<T>>,
): Promise<Attempt<T>> {
  let last: Attempt<T> = { ok: false, error: 'неизвестная ошибка' }

  for (let index = 0; index < RETRY_ATTEMPTS; index++) {
    last = await attempt()
    if (last.ok) return last

    const delay = RETRY_DELAYS_MS[index]
    if (delay !== undefined) {
      logWarn(
        `  ${label}: попытка ${index + 1}/${RETRY_ATTEMPTS} не удалась (${last.error}), повтор через ${delay} мс`,
      )
      await sleep(delay)
    }
  }

  logWarn(`  ${label}: все ${RETRY_ATTEMPTS} попыток не удались`)

  return last
}

/**
 * Ищет первого автора книги в Google Books (ключ не нужен).
 * Всегда выдерживает паузу 300 мс — и при успехе, и при ошибке.
 */
async function findAuthorInGoogleBooks(title: string): Promise<string | null> {
  if (googleBooksDisabled) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), GOOGLEBOOKS_TIMEOUT_MS)
  let author: string | null = null

  try {
    // Пунктуация в названиях («Ведьмак.последнее желание») мешает поиску
    const query = title
      .replace(/[.,;:!?()«»"'’]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    if (!query) return null

    const params = new URLSearchParams({
      q: `intitle:"${query}"`,
      maxResults: '1',
    })
    if (GOOGLE_BOOKS_API_KEY) params.set('key', GOOGLE_BOOKS_API_KEY)

    const response = await fetch(
      `https://www.googleapis.com/books/v1/volumes?${params.toString()}`,
      {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      },
    )

    if (response.status === 429) {
      googleBooksDisabled = true
      logWarn(
        'Google Books: квота без ключа исчерпана (429) — дальше ищем авторов в Open Library',
      )
      return null
    }

    if (response.ok) {
      const payload = (await response.json()) as {
        items?: { volumeInfo?: { authors?: string[] } }[]
      }
      const candidate = payload.items?.[0]?.volumeInfo?.authors?.[0]
      if (candidate && candidate.trim()) author = candidate.trim()
    }
  } catch {
    // Сеть/таймаут — просто возвращаем null, импорт продолжается
  } finally {
    clearTimeout(timer)
    await sleep(GOOGLEBOOKS_DELAY_MS)
  }

  return author
}

/* ------------------------------------------------------------------ */
/* Open Library: запасной вариант поиска автора                        */
/* ------------------------------------------------------------------ */

const OPENLIBRARY_DELAY_MS = 300
const OPENLIBRARY_TIMEOUT_MS = 8_000

/** Ищет первого автора книги в Open Library (хорошо знает русскую классику) */
async function findAuthorInOpenLibrary(title: string): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), OPENLIBRARY_TIMEOUT_MS)
  let author: string | null = null

  try {
    const query = title
      .replace(/[.,;:!?()«»"'’]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    const params = new URLSearchParams({
      q: query,
      fields: 'author_name',
      limit: '1',
    })

    const response = await fetch(
      `https://openlibrary.org/search.json?${params.toString()}`,
      {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      },
    )

    if (response.ok) {
      const payload = (await response.json()) as {
        docs?: { author_name?: string[] }[]
      }
      const candidate = payload.docs?.[0]?.author_name?.[0]
      if (candidate && candidate.trim()) author = candidate.trim()
    }
  } catch {
    // Сеть/таймаут — просто возвращаем null
  } finally {
    clearTimeout(timer)
    await sleep(OPENLIBRARY_DELAY_MS)
  }

  return author
}

/**
 * Добирает авторов для книг, у которых он не извлёкся из имени папки.
 * Порядок: ручной справочник → Google Books (по ключу) → Open Library.
 */
async function enrichAuthors(
  books: ParsedBook[],
  limit: number,
): Promise<{ found: number; networkQueries: number }> {
  let found = 0
  let networkQueries = 0

  for (const book of books) {
    if (book.author) continue
    if (networkQueries >= limit) break

    // 1. Ручной справочник: точное совпадение, без сетевых запросов.
    //    Значение «-» означает «автор неизвестен, не ищем».
    const manual = MANUAL_AUTHORS.get(dedupeKey(book.title))
    if (manual === '-') continue
    if (manual) {
      book.author = manual
      book.authorSource = 'manual'
      found++
      continue
    }

    networkQueries++

    // 2. Google Books (только если задан ключ)
    const fromGoogle = await findAuthorInGoogleBooks(book.title)
    if (fromGoogle) {
      book.author = fromGoogle
      book.authorSource = 'google-books'
      found++
      continue
    }

    // 3. Open Library — запасной вариант
    const fromOpenLibrary = await findAuthorInOpenLibrary(book.title)
    if (fromOpenLibrary) {
      book.author = fromOpenLibrary
      book.authorSource = 'open-library'
      found++
    }
  }

  return { found, networkQueries }
}

/* ------------------------------------------------------------------ */
/* Supabase                                                            */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  const stats: Stats = {
    folders: 0,
    processed: 0,
    inserted: 0,
    updated: 0,
    duplicates: 0,
    skipped: 0,
    coversFailed: 0,
    postponed: 0,
  }

  // Клиент создаём сразу (если env задан): нужен и для импорта, и для --fix-authors,
  // и для dry-run (проверка дубликатов — только чтение).
  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  const supabase =
    supabaseUrl && serviceKey
      ? createClient(supabaseUrl, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : null

  // --- режим --fix-authors: проставить авторов уже импортированным книгам
  if (FIX_AUTHORS) {
    const db = supabase
    if (!db) {
      throw new Error(
        'Supabase не настроен: нужны SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY',
      )
    }

    const { data, error } = await db.from('books').select('id, title, author')
    if (error) {
      throw new Error(`не удалось прочитать books: ${error.message}`)
    }

    const rows = (data ?? []) as {
      id: string
      title: string | null
      author: string | null
    }[]

    let updated = 0
    let unknown = 0

    for (const row of rows) {
      if (!row.title) continue

      const author = MANUAL_AUTHORS.get(dedupeKey(row.title))
      if (!author) {
        unknown++
        continue
      }
      if (author === row.author) continue

      const { error: updateError } = await db
        .from('books')
        .update({ author })
        .eq('id', row.id)

      if (updateError) {
        logWarn(`  не удалось обновить «${row.title}»: ${updateError.message}`)
        continue
      }

      updated++
      log(`  автор проставлен: «${row.title}» — ${author}`)
    }

    log(
      `--fix-authors: книг в базе ${rows.length}, обновлено авторов ${updated}, нет в справочнике ${unknown}`,
    )
    return
  }

  log(`архив: ${zipPath}${DRY_RUN ? ' (dry-run)' : ''}`)

  const entries = await readZipEntries(zipPath)
  log(`файлов в архиве: ${entries.length}`)

  const books = await buildBooks(entries, stats)
  log(`книг к импорту: ${books.length} (папок всего: ${stats.folders})`)

  if (books.length === 0) {
    log('нечего импортировать')
    return
  }

  // Замыкания, а не отдельные функции: так типы supabase-js выводятся из
  // конкретного клиента и не требуют «any»/ручных генериков.
  async function loadExistingTitles(): Promise<{
    byKey: Map<string, ExistingRow>
    list: ExistingRow[]
  }> {
    const db = supabase
    if (!db) return { byKey: new Map(), list: [] }

    const { data, error } = await db
      .from('books')
      .select('id, title, author, cover_url')

    if (error) {
      throw new Error(`не удалось прочитать books: ${error.message}`)
    }

    const byKey = new Map<string, ExistingRow>()
    const list: ExistingRow[] = []

    for (const row of (data ?? []) as {
      id: string
      title: string | null
      author: string | null
      cover_url: string | null
    }[]) {
      if (!row.title) continue

      const entry: ExistingRow = {
        id: row.id,
        title: row.title,
        tokens: titleTokens(row.title),
        author: row.author,
        coverUrl: row.cover_url,
      }

      byKey.set(dedupeKey(row.title), entry)
      list.push(entry)
    }

    return { byKey, list }
  }

  async function uploadCover(data: Buffer): Promise<string> {
    const db = supabase
    if (!db) {
      throw new Error(
        'Supabase не настроен: нужны SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY',
      )
    }

    const jpeg = await coverToJpeg(data)
    const path = `${STORAGE_PREFIX}/${randomUUID()}.jpg`

    const result = await retry(`обложка ${baseName(path)}`, async () => {
      const { error } = await db.storage
        .from(BUCKET)
        .upload(path, jpeg, { contentType: 'image/jpeg', upsert: false })

      if (error) return { ok: false as const, error: error.message }

      const { data: publicUrl } = db.storage.from(BUCKET).getPublicUrl(path)
      return { ok: true as const, value: publicUrl.publicUrl }
    })

    if (!result.ok) {
      throw new Error(
        `Storage: ${result.error} (бакет «${BUCKET}» существует?)`,
      )
    }

    return result.value
  }

  const existing = await loadExistingTitles()

  // Дедупликация двухуровневая: точный ключ и «похожее» (усечённое) название.
  type Planned = { book: ParsedBook; twin: ExistingRow | null }

  const planned: Planned[] = books.map(book => {
    const exact = existing.byKey.get(dedupeKey(book.title)) ?? null
    const twin = exact ?? isLikelyDuplicate(book.title, existing.list)
    return { book, twin }
  })

  const toInsert = planned.filter(item => !item.twin)
  const toUpdate = planned.filter(item => item.twin)

  if (toUpdate.length > 0) {
    log(
      `уже есть в базе: ${toUpdate.length}` +
        (UPDATE_EXISTING
          ? ' — обновим обложку и аннотацию'
          : ' — пропускаем (включи --update-existing, чтобы обновить)'),
    )
  }

  // Авторов ищем у новых книг и у существующих записей без автора
  const needsAuthor: ParsedBook[] = [
    ...toInsert.map(item => item.book),
    ...toUpdate.filter(item => !item.twin?.author).map(item => item.book),
  ]

  const enrichLimit = DRY_RUN
    ? Math.min(needsAuthor.length, 10)
    : needsAuthor.length
  if (enrichLimit > 0) {
    log(
      googleBooksDisabled
        ? `Google Books без ключа отключён (общая квота 429) — авторов ищем в Open Library, запросов ${enrichLimit}`
        : `ищем авторов: сначала Google Books, затем Open Library; запросов ${enrichLimit}`,
    )
    const { found, networkQueries } = await enrichAuthors(
      needsAuthor,
      enrichLimit,
    )
    log(
      `авторы проставлены у ${found} из ${needsAuthor.length} (сетевых запросов: ${networkQueries}, справочник: ${MANUAL_AUTHORS.size} записей)`,
    )
  }

  if (DRY_RUN) {
    toInsert.forEach(({ book }) => {
      const source = book.authorSource ? ` [${book.authorSource}]` : ''
      log(
        `  • добавить: «${book.title}» — ${book.author ? book.author + source : 'автор не найден'} | ${book.description.length} симв. | ${book.coverName}`,
      )
    })

    toUpdate.slice(0, 10).forEach(({ book, twin }) => {
      if (!twin) return
      const authorNote = !twin.author && book.author ? ` + автор «${book.author}»` : ''
      log(
        `  • обновить: «${twin.title}» ← обложка + аннотация ${book.description.length} симв.${authorNote}`,
      )
    })
    if (toUpdate.length > 10) log(`  … и ещё ${toUpdate.length - 10} обновлений`)

    const willUpdate = UPDATE_EXISTING ? toUpdate.length : 0
    const willSkip = UPDATE_EXISTING ? 0 : toUpdate.length

    log(
      `dry-run${UPDATE_EXISTING ? ' (--update-existing)' : ''}: ` +
        `добавить ${toInsert.length}, обновить ${willUpdate}, пропустить ${willSkip}` +
        (existing.byKey.size === 0 ? ' (база не проверялась: env не задан)' : ''),
    )
    log('в БД и Storage ничего не записано')
    return
  }

  const db = supabase
  if (!db) {
    throw new Error(
      'Supabase не настроен: нужны SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY',
    )
  }

  log(`в books уже есть записей: ${existing.byKey.size}`)
  stats.processed = planned.length
  stats.duplicates = UPDATE_EXISTING ? 0 : toUpdate.length

  const postponed: { title: string; reason: string }[] = []

  /** Книга не прошла после всех повторов: с --skip-failed откладываем, иначе считаем ошибкой */
  function failBook(title: string, reason: string): void {
    if (SKIP_FAILED) {
      postponed.push({ title, reason })
      stats.postponed++
      logWarn(`  отложено: «${title}» — ${reason}`)
      return
    }

    stats.skipped++
    logWarn(`  ошибка «${title}»: ${reason}`)
  }

  // 1. Обновляем существующие книги: обложка и аннотация из архива,
  //    название не трогаем (в базе оно полное), автора — только если пусто.
  if (UPDATE_EXISTING) {
    for (const { book, twin } of toUpdate) {
      if (!twin) continue

      try {
        // Обложка — необязательный шаг: если Storage недоступен (сетевой глюк,
        // антивирус), всё равно обновляем аннотацию, а старую обложку не трогаем.
        let coverUrl: string | null = null
        try {
          coverUrl = await uploadCover(book.coverData)
        } catch (coverError) {
          stats.coversFailed++
          logWarn(
            `  обложка не загрузилась «${twin.title}»: ` +
              `${coverError instanceof Error ? coverError.message : coverError} — обновляю только аннотацию`,
          )
        }

        const patch: {
          description: string
          author?: string
          cover_url?: string
        } = {
          description: book.description,
        }
        if (coverUrl) patch.cover_url = coverUrl
        if (!twin.author && book.author) patch.author = book.author

        const result = await retry(`update «${twin.title}»`, async () => {
          const { data: updatedRows, error } = await db
            .from('books')
            .update(patch)
            .eq('id', twin.id)
            .select('id')

          if (error) return { ok: false as const, error: error.message }
          return { ok: true as const, value: updatedRows ?? [] }
        })

        if (!result.ok) {
          failBook(twin.title, result.error)
          continue
        }

        // RLS без прав «молча» обновляет 0 строк — это не успех и не транзиентный сбой
        if (result.value.length === 0) {
          failBook(twin.title, 'обновлено 0 строк (нужен service_role ключ?)')
          continue
        }

        stats.updated++
        log(
          `  обновлено: «${twin.title}»${patch.author ? ' (+автор)' : ''}${coverUrl ? '' : ' (без обложки)'}`,
        )
      } catch (error) {
        failBook(
          twin.title,
          error instanceof Error ? error.message : String(error),
        )
      }
    }
  }

  // 2. Добавляем действительно новые книги
  for (const { book } of toInsert) {
    try {
      // Обложка не должна блокировать импорт: без неё книга всё равно попадёт в базу
      let coverUrl: string | null = null
      try {
        coverUrl = await uploadCover(book.coverData)
      } catch (coverError) {
        stats.coversFailed++
        logWarn(
          `  обложка не загрузилась «${book.title}»: ` +
            `${coverError instanceof Error ? coverError.message : coverError} — добавляю без обложки`,
        )
      }

      const result = await retry(`insert «${book.title}»`, async () => {
        const { data, error } = await db
          .from('books')
          .insert({
            title: book.title,
            author: book.author,
            description: book.description,
            cover_url: coverUrl,
          })
          .select('id')
          .single()

        if (error) return { ok: false as const, error: error.message }
        return {
          ok: true as const,
          value: (data as { id: string } | null)?.id ?? '',
        }
      })

      if (!result.ok) {
        failBook(book.title, result.error)
        continue
      }

      // Пополняем карту, чтобы одинаковые названия внутри архива не задвоились
      const newRow: ExistingRow = {
        id: result.value,
        title: book.title,
        tokens: titleTokens(book.title),
        author: book.author,
        coverUrl,
      }
      existing.byKey.set(dedupeKey(book.title), newRow)
      existing.list.push(newRow)

      stats.inserted++
      log(
        `  добавлено: «${book.title}»${book.author ? ' — ' + book.author : ''}`,
      )
    } catch (error) {
      failBook(
        book.title,
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  log('--- итог ---')
  log(`  папок: ${stats.folders}`)
  log(`  обработано: ${stats.processed}`)
  log(`  добавлено: ${stats.inserted}`)
  log(`  обновлено: ${stats.updated}`)
  log(`  пропущено дубликатов: ${stats.duplicates}`)
  log(`  пропущено с ошибками: ${stats.skipped}`)
  if (stats.coversFailed > 0) {
    log(
      `  без обложки (Storage недоступен): ${stats.coversFailed} — перезапусти, чтобы догрузить`,
    )
  }
  if (stats.postponed > 0) {
    log(`  отложено (--skip-failed): ${stats.postponed}`)
    log('--- отложенные книги (перезапусти, чтобы догрузить) ---')
    for (const item of postponed) {
      log(`  • «${item.title}» — ${item.reason}`)
    }
  }
}

main().catch((error: unknown) => {
  console.error(
    '[import-books] ОШИБКА:',
    error instanceof Error ? error.message : error,
  )
  process.exitCode = 1
})
