import { ReactNode } from 'react'

export function formatPostContent(text: string): ReactNode[] {
  const paragraphs = text.split(/\n\n+/)
  return paragraphs.map((p, i) => (
    <p key={i}>{renderInline(p)}</p>
  ))
}

function renderInline(text: string): ReactNode[] {
  const parts: ReactNode[] = []
  let key = 0
  let rest = text

  // Спойлеры [spoil]...[/spoil]
  const spoilRegex = /\[spoil\]([\s\S]*?)\[\/spoil\]/i
  // Цитаты: строка начинается с "> "
  // Ссылки
  const linkRegex = /(https?:\/\/[^\s<]+)/g

  // Сначала извлекаем спойлеры
  let spoilMatch = rest.match(spoilRegex)
  while (spoilMatch) {
    const before = rest.slice(0, spoilMatch.index!)
    if (before) parts.push(...renderText(before, key++))
    parts.push(<Spoiler key={`spoil-${key++}`}>{spoilMatch[1]}</Spoiler>)
    rest = rest.slice(spoilMatch.index! + spoilMatch[0].length)
    spoilMatch = rest.match(spoilRegex)
  }
  if (rest) parts.push(...renderText(rest, key++))
  return parts
}

function renderText(text: string, baseKey: number): ReactNode[] {
  // Жирный **text**, курсив *text*
  const tokens: ReactNode[] = []
  let key = baseKey * 1000
  let rest = text

  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|https?:\/\/[^\s<]+)/g
  let lastIndex = 0
  let match

  while ((match = regex.exec(rest)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(rest.slice(lastIndex, match.index))
    }
    const token = match[0]
    if (token.startsWith('**')) {
      tokens.push(<strong key={key++}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('*')) {
      tokens.push(<em key={key++}>{token.slice(1, -1)}</em>)
    } else if (token.startsWith('http')) {
      tokens.push(
        <a
          key={key++}
          href={token}
          target="_blank"
          rel="noopener noreferrer"
        >
          {token}
        </a>
      )
    }
    lastIndex = match.index + token.length
  }
  if (lastIndex < rest.length) tokens.push(rest.slice(lastIndex))
  return tokens
}

function Spoiler({ children }: { children: ReactNode }) {
  return (
    <details className="inline-block bg-emerald-dark/5 border border-emerald-dark/15 rounded-md px-2 py-1 my-1 cursor-pointer">
      <summary className="text-xs text-wine font-medium select-none">
        Показать спойлер
      </summary>
      <span className="block mt-1 text-brown-dark">{children}</span>
    </details>
  )
}
