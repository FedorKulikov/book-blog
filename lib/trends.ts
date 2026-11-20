// lib/trends.ts
// Словарь тем «Книжного радара»: ярлык чипса → реальные подстроки для поиска.
//
// Зачем отдельный модуль: тема тренда — это ЧЕЛОВЕЧЕСКИЙ ЯРЛЫК
// («Книжные премии»), а не текст из заголовка. Если подставить ярлык
// в поиск по ленте, он не найдёт ничего. Поэтому у каждой темы есть
// список подстрок, по которым её реально ищут.
//
// Ярлыки здесь должны совпадать с THEME_PATTERNS в scripts/fetch-rss-news.ts
// (оттуда они попадают в таблицу news_trends). Если тема не найдётся
// в словаре, поиск уйдёт по самому ярлыку — как раньше.

/** Вид тренда: тема, книжное название в кавычках или имя */
export type TrendKind = 'theme' | 'name' | 'book'

/** Подстроки для поиска: тема → чем её искать в ленте */
export const THEME_SEARCH_TERMS: Record<string, string[]> = {
  'Букеровская премия': ['букер', 'booker'],
  'Нобелевская премия': ['нобел', 'nobel'],
  'Пулитцеровская премия': ['пулитцер', 'pulitzer'],
  'Книжные премии': ['national book award', 'award', 'prize', 'преми'],
  'Экранизации': ['экранизац', 'сериал', 'adaptation', 'film'],
  'Переводы': ['перевод', 'translat'],
  'Ярмарки и фестивали': ['ярмарк', 'фестивал', 'festival', 'book fair'],
  'Аудиокниги': ['аудиокниг', 'audiobook'],
  'Библиотеки': ['библиотек', 'librar'],
  'Новинки': ['новинк', 'new release', 'new book', 'вышел'],
  'Запреты и цензура': ['запрет', 'цензур', 'banned', 'censor'],
  'ИИ и книги': ['нейросет', 'искусственн', 'chatgpt'],
  'Тиражи': ['тираж'],
  'Электронные книги': ['электронн', 'ebook', 'e-book'],
  'Букинистика': ['букинист', 'антикварн', 'rare book'],
  'Поэзия': ['поэзи', 'стих', 'poetry', 'poem'],
  'Детские книги': ['детск', 'подростк', 'children', 'young adult'],
  'Бестселлеры': ['бестселлер', 'bestsell'],
  'Скидки и акции': ['скидк', 'распродаж', 'deals of the day'],
  'Тесты и викторины': ['тест:', 'quiz'],
  'Интервью': ['интервью', 'interview'],
}

/** Максимум терминов в одном поисковом запросе */
export const TOPIC_TERMS_LIMIT = 6

/**
 * Поисковые термины для чипса: у темы — её подстроки,
 * у книги и имени — само название.
 */
export function trendSearchTerms(topic: string, kind: TrendKind): string[] {
  if (kind !== 'theme') return [topic]

  const terms = THEME_SEARCH_TERMS[topic]
  return terms && terms.length > 0 ? terms : [topic]
}

/**
 * Термины из URL обратно в безопасный список.
 * Значение приходит как «букер|booker»: режем по `|`, чистим каждый термин
 * от того, что может сломать PostgREST-выражение `or(...)` или подменить
 * шаблон `ilike` (`%`, `_`, запятые, скобки, кавычки).
 */
export function parseTopicTerms(
  value: string | string[] | undefined,
): string[] {
  const raw = Array.isArray(value) ? value[0] : value
  if (!raw) return []

  const terms: string[] = []

  for (const chunk of raw.split('|')) {
    const cleaned = chunk
      .replace(/[%_,()"'`\\<>*]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60)

    if (cleaned.length < 2) continue
    if (terms.some(existing => existing.toLowerCase() === cleaned.toLowerCase())) {
      continue
    }

    terms.push(cleaned)
    if (terms.length >= TOPIC_TERMS_LIMIT) break
  }

  return terms
}
