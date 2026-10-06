'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { humanizeError } from '@/lib/errors'
import { BookOpen, X, Plus } from './icons'

type Book = {
  id: string
  title: string
  author: string | null
  year: number | null
}

type Props = {
  value: string | null
  onChange: (bookId: string | null) => void
}

const inputClass =
  'w-full border border-emerald-dark/15 rounded-lg px-3 py-2 bg-cream-warm/40 focus:outline-none focus:border-emerald-mid'

function subtitleOf(book: Pick<Book, 'author' | 'year'>) {
  return [book.author, book.year].filter(Boolean).join(' · ')
}

export default function BookSelect({ value, onChange }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Book[]>([])
  const [selected, setSelected] = useState<Book | null>(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [showNewForm, setShowNewForm] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newAuthor, setNewAuthor] = useState('')
  const [newYear, setNewYear] = useState('')
  const [creating, setCreating] = useState(false)

  const boxRef = useRef<HTMLDivElement>(null)

  // Выбранную книгу подтягиваем из БД по value
  useEffect(() => {
    if (!value) return
    let alive = true

    async function loadSelected() {
      const { data } = await supabase
        .from('books')
        .select('id, title, author, year')
        .eq('id', value)
        .maybeSingle()
      if (alive) setSelected((data as Book | null) ?? null)
    }

    loadSelected()
    return () => {
      alive = false
    }
  }, [value])

  // Поиск с debounce 300 мс
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) return

    let alive = true
    const timer = setTimeout(() => {
      void (async () => {
        setLoading(true)
        const { data } = await supabase
          .from('books')
          .select('id, title, author, year')
          .ilike('title', `%${q}%`)
          .limit(8)
        if (!alive) return
        setResults((data as Book[] | null) ?? [])
        setLoading(false)
      })()
    }, 300)

    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [query])

  // Закрытие по клику вне компонента
  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false)
        setShowNewForm(false)
      }
    }

    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [])

  const activeBook = value && selected && selected.id === value ? selected : null

  function selectBook(book: Book) {
    onChange(book.id)
    setSelected(book)
    setQuery('')
    setResults([])
    setOpen(false)
    setShowNewForm(false)
  }

  function reset() {
    onChange(null)
    setSelected(null)
    setQuery('')
    setResults([])
    setOpen(false)
    setShowNewForm(false)
  }

  function handleQueryChange(next: string) {
    setQuery(next)
    setOpen(true)
    if (next.trim().length < 2) {
      setResults([])
      setLoading(false)
    }
  }

  async function createBook() {
    const title = newTitle.trim()
    if (!title) return

    setCreating(true)
    const { data, error } = await supabase
      .from('books')
      .insert({
        title,
        author: newAuthor.trim() || null,
        year: newYear ? parseInt(newYear, 10) : null,
      })
      .select()
      .single()
    setCreating(false)

    if (error || !data) {
      alert(
        error
          ? 'Не удалось добавить книгу: ' + humanizeError(error.message)
          : 'Не удалось добавить книгу'
      )
      return
    }

    setNewTitle('')
    setNewAuthor('')
    setNewYear('')
    selectBook(data as Book)
  }

  return (
    <div className="relative" ref={boxRef}>
      <label className="block text-sm font-medium mb-1 text-brown-dark">
        Книга (необязательно)
      </label>

      {activeBook ? (
        <div className="flex items-center gap-3 border border-emerald-dark/15 rounded-lg px-3 py-2 bg-cream-warm/40">
          <BookOpen
            size={16}
            strokeWidth={1.7}
            className="text-emerald-mid flex-shrink-0"
          />
          <div className="flex-1 min-w-0">
            <div className="text-sm text-brown-dark truncate">
              {activeBook.title}
            </div>
            {subtitleOf(activeBook) && (
              <div className="text-xs text-brown/60 truncate">
                {subtitleOf(activeBook)}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={reset}
            aria-label="Сбросить выбранную книгу"
            className="text-brown/50 hover:text-wine transition-colors flex-shrink-0"
          >
            <X size={16} strokeWidth={1.8} />
          </button>
        </div>
      ) : (
        <input
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder="Начните вводить название книги…"
          className={inputClass}
        />
      )}

      {open && !activeBook && (showNewForm || query.trim().length >= 2) && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-cream border border-emerald-dark/15 rounded-lg shadow-lg z-20 max-h-72 overflow-y-auto">
          {showNewForm ? (
            <div className="p-3 space-y-2">
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Название книги *"
                className={`${inputClass} text-sm`}
              />
              <input
                type="text"
                value={newAuthor}
                onChange={(e) => setNewAuthor(e.target.value)}
                placeholder="Автор"
                className={`${inputClass} text-sm`}
              />
              <input
                type="number"
                value={newYear}
                onChange={(e) => setNewYear(e.target.value)}
                placeholder="Год"
                className={`${inputClass} text-sm`}
              />
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={createBook}
                  disabled={creating || !newTitle.trim()}
                  className="bg-emerald-mid hover:bg-emerald-dark text-cream px-4 py-2 rounded-lg text-sm transition-colors disabled:opacity-50"
                >
                  {creating ? 'Добавляем…' : 'Добавить'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowNewForm(false)}
                  className="px-4 py-2 rounded-lg text-sm text-brown/70 hover:text-brown-dark transition-colors"
                >
                  Отмена
                </button>
              </div>
            </div>
          ) : (
            <>
              {loading && (
                <div className="px-3 py-2 text-sm text-brown/60">Ищем…</div>
              )}

              {!loading &&
                results.map((book) => (
                  <button
                    key={book.id}
                    type="button"
                    onClick={() => selectBook(book)}
                    className="w-full text-left px-3 py-2 hover:bg-cream-warm/50 transition-colors border-b border-emerald-dark/5 last:border-b-0"
                  >
                    <div className="text-sm text-brown-dark">{book.title}</div>
                    {subtitleOf(book) && (
                      <div className="text-xs text-brown/60">
                        {subtitleOf(book)}
                      </div>
                    )}
                  </button>
                ))}

              <button
                type="button"
                onClick={() => {
                  setNewTitle(query.trim())
                  setShowNewForm(true)
                }}
                className="w-full text-left px-3 py-2 text-sm text-wine hover:bg-cream-warm/50 transition-colors flex items-center gap-2"
              >
                <Plus size={14} strokeWidth={1.8} />
                <span>
                  {results.length === 0
                    ? `Добавить «${query.trim()}» как новую книгу`
                    : 'Добавить новую книгу'}
                </span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
