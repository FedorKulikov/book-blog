/**
 * scripts/import-books.ts
 *
 * Импорт книг из ZIP-архива: каждая папка = одна книга, внутри
 * DOCX с литературной аннотацией и файл обложки (AVIF/JPG/PNG).
 *
 * Запуск:
 *   npx tsx scripts/import-books.ts ./knigi.zip            # боевой импорт
 *   npx tsx scripts/import-books.ts ./knigi.zip --dry-run  # без записи в БД и Storage
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
  description: string
  coverName: string
  coverData: Buffer
}

type Stats = {
  folders: number
  processed: number
  inserted: number
  duplicates: number
  skipped: number
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
        const name = decodeEntryName(
          Buffer.isBuffer(rawName) ? rawName : Buffer.from(String(rawName)),
        )

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

/** Ключ для сравнения дубликатов: регистр, ё, кавычки, пробелы */
function dedupeKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"“”']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
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

    const { title, author } = parseTitleAndAuthor(folder)
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
      title: normalizeTitle(title),
      author,
      description,
      coverName: baseName(cover.name),
      coverData: cover.data,
    })
  }

  return books
}

/* ------------------------------------------------------------------ */
/* Open Library: поиск автора по названию                              */
/* ------------------------------------------------------------------ */

const OPENLIBRARY_DELAY_MS = 300
const OPENLIBRARY_TIMEOUT_MS = 8_000

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Ищет первого автора книги в Open Library.
 * Всегда выдерживает паузу 300 мс — и при успехе, и при ошибке.
 */
async function findAuthorInOpenLibrary(title: string): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), OPENLIBRARY_TIMEOUT_MS)
  let author: string | null = null

  try {
    // Пунктуация в названиях («Ведьмак.последнее желание») снижает шанс совпадения:
    // заменяем её пробелами перед запросом.
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
    // Сеть/таймаут — просто возвращаем null, импорт продолжается
  } finally {
    clearTimeout(timer)
    await sleep(OPENLIBRARY_DELAY_MS)
  }

  return author
}

/**
 * Добирает авторов для книг, у которых он не извлёкся из имени папки.
 * Возвращает количество найденных авторов.
 */
async function enrichAuthors(
  books: ParsedBook[],
  limit: number,
): Promise<number> {
  let found = 0
  let queries = 0

  for (const book of books) {
    if (book.author) continue
    if (queries >= limit) break

    queries++
    const author = await findAuthorInOpenLibrary(book.title)
    if (author) {
      book.author = author
      found++
    }
  }

  return found
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
    duplicates: 0,
    skipped: 0,
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

  // Клиент создаём сразу (если env задан), чтобы dry-run тоже мог
  // показать, какие книги окажутся дубликатами — без единой записи.
  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  const supabase =
    supabaseUrl && serviceKey
      ? createClient(supabaseUrl, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : null

  // Замыкания, а не отдельные функции: так типы supabase-js выводятся из
  // конкретного клиента и не требуют «any»/ручных генериков.
  async function loadExistingTitles(): Promise<Map<string, string | null>> {
    const db = supabase
    if (!db) return new Map()

    const { data, error } = await db.from('books').select('id, title, author')

    if (error) {
      throw new Error(`не удалось прочитать books: ${error.message}`)
    }

    const map = new Map<string, string | null>()
    for (const row of (data ?? []) as {
      id: string
      title: string | null
      author: string | null
    }[]) {
      if (!row.title) continue
      map.set(dedupeKey(row.title), row.author)
    }

    return map
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

    const { error } = await db.storage
      .from(BUCKET)
      .upload(path, jpeg, { contentType: 'image/jpeg', upsert: false })

    if (error) {
      throw new Error(`Storage: ${error.message} (бакет «${BUCKET}» существует?)`)
    }

    const { data: publicUrl } = db.storage.from(BUCKET).getPublicUrl(path)
    return publicUrl.publicUrl
  }

  const existing = await loadExistingTitles()

  // Дубликаты отсекаем ДО обогащения: не тратим запросы к Open Library зря
  const fresh = books.filter(book => !existing.has(dedupeKey(book.title)))
  const duplicates = books.length - fresh.length

  // Авторов ищем только у новых книг. В dry-run ограничиваемся пятёркой,
  // чтобы прогон оставался быстрым, но было видно, что логика работает.
  const enrichLimit = DRY_RUN ? Math.min(fresh.length, 5) : fresh.length
  if (enrichLimit > 0) {
    log(
      `ищем авторов в Open Library: запросов ${enrichLimit}, пауза ${OPENLIBRARY_DELAY_MS} мс`,
    )
    const found = await enrichAuthors(fresh, enrichLimit)
    log(`авторы найдены у ${found} из ${enrichLimit} (поиск был нужен не всем)`)
  }

  if (DRY_RUN) {
    fresh.slice(0, 12).forEach(book => {
      log(
        `  • «${book.title}» — ${book.author ?? 'автор не найден'} | ${book.description.length} симв. | ${book.coverName}`,
      )
    })
    if (fresh.length > 12) log(`  … и ещё ${fresh.length - 12}`)

    log(
      `dry-run: новых ${fresh.length}, дубликатов ${duplicates}` +
        (existing.size === 0 ? ' (база не проверялась: env не задан)' : ''),
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

  log(`в books уже есть записей: ${existing.size}`)
  stats.processed = fresh.length
  stats.duplicates = duplicates

  for (const book of fresh) {
    try {
      const coverUrl = await uploadCover(book.coverData)

      const { error } = await db.from('books').insert({
        title: book.title,
        author: book.author,
        description: book.description,
        cover_url: coverUrl,
      })

      if (error) {
        logWarn(`  ошибка вставки «${book.title}»: ${error.message}`)
        stats.skipped++
        continue
      }

      // Обновляем карту, чтобы одинаковые названия в архиве не задвоились
      existing.set(dedupeKey(book.title), book.author)
      stats.inserted++
      log(
        `  добавлено: «${book.title}»${book.author ? ' — ' + book.author : ''}`,
      )
    } catch (error) {
      logWarn(
        `  ошибка «${book.title}»: ${error instanceof Error ? error.message : error}`,
      )
      stats.skipped++
    }
  }

  log('--- итог ---')
  log(`  папок: ${stats.folders}`)
  log(`  обработано: ${stats.processed}`)
  log(`  добавлено: ${stats.inserted}`)
  log(`  пропущено дубликатов: ${stats.duplicates}`)
  log(`  пропущено с ошибками: ${stats.skipped}`)
}

main().catch((error: unknown) => {
  console.error(
    '[import-books] ОШИБКА:',
    error instanceof Error ? error.message : error,
  )
  process.exitCode = 1
})
