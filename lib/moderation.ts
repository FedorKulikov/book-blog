import { supabase } from './supabase'

// Кэш стоп-слов в памяти
let stopWordsCache: string[] | null = null
let cacheTime = 0
const CACHE_TTL = 5 * 60 * 1000 // 5 минут

async function loadStopWords(): Promise<string[]> {
  const now = Date.now()
  if (stopWordsCache && now - cacheTime < CACHE_TTL) {
    return stopWordsCache
  }

  const { data } = await supabase.from('stop_words').select('word')
  stopWordsCache = (data || []).map((r: any) => r.word.toLowerCase())
  cacheTime = now
  return stopWordsCache
}

/**
 * Проверяет текст на наличие стоп-слов.
 * Возвращает null если чисто, или найденное слово.
 */
export async function findBadWord(
  text: string
): Promise<string | null> {
  if (!text) return null

  const words = await loadStopWords()
  // Приводим к нижнему регистру, заменяем не-буквы на пробелы
  const normalized = text
    .toLowerCase()
    .replace(/[^а-яёa-z0-9]+/gi, ' ')

  for (const bad of words) {
    if (normalized.includes(bad)) return bad
  }
  return null
}

/**
 * Проверяет посты/комментарии, возвращает true если чисто.
 */
export async function isTextClean(text: string): Promise<boolean> {
  const found = await findBadWord(text)
  return found === null
}