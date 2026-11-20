import { ReactNode } from 'react'

/**
 * Разметка пользовательских текстов: посты, комментарии, сообщения.
 *
 * Поддерживается: **жирный**, *курсив*, ссылки, [spoil]…[/spoil].
 * Всё собирается в React-элементы, без dangerouslySetInnerHTML —
 * поэтому HTML из текста пользователя исполниться не может.
 */

/**
 * Разметка поста: абзацы разделяются пустой строкой.
 *
 * Абзац со спойлером рендерится как <div>, а не <p>: элемент <details>
 * внутри <p> — невалидный HTML, браузер выносит его наружу, и вёрстка
 * поста разъезжается.
 */
export function formatPostContent(text: string): ReactNode[] {
  const blocks = text.split(/\n{2,}/)

  return blocks.map((block, index) => {
    const content = renderInline(block, `b${index}`)

    return /\[spoil\]/i.test(block) ? (
      <div key={index} className="mb-3">
        {content}
      </div>
    ) : (
      <p key={index}>{content}</p>
    )
  })
}

/**
 * Разметка одной строки: комментарии и сообщения в чате.
 * Абзацев там нет, спойлер тоже должен работать — иначе пользователь
 * видит «[spoil]» как обычный текст.
 */
export function formatInlineText(text: string): ReactNode[] {
  return renderInline(text, 'inline')
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts: ReactNode[] = []
  let key = 0
  let rest = text

  const spoilRegex = /\[spoil\]([\s\S]*?)\[\/spoil\]/i

  let spoilMatch = rest.match(spoilRegex)
  while (spoilMatch) {
    const before = rest.slice(0, spoilMatch.index!)
    if (before) parts.push(...renderText(before, `${keyPrefix}-${key++}`))
    parts.push(
      <Spoiler key={`${keyPrefix}-spoil-${key++}`}>
        {renderText(spoilMatch[1], `${keyPrefix}-inner-${key}`)}
      </Spoiler>,
    )
    rest = rest.slice(spoilMatch.index! + spoilMatch[0].length)
    spoilMatch = rest.match(spoilRegex)
  }

  if (rest) parts.push(...renderText(rest, `${keyPrefix}-${key++}`))
  return parts
}

function renderText(text: string, keyPrefix: string): ReactNode[] {
  const tokens: ReactNode[] = []
  let key = 0
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
      tokens.push(<strong key={`${keyPrefix}-s${key++}`}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('*')) {
      tokens.push(<em key={`${keyPrefix}-e${key++}`}>{token.slice(1, -1)}</em>)
    } else if (token.startsWith('http')) {
      tokens.push(
        <a
          key={`${keyPrefix}-a${key++}`}
          href={token}
          target="_blank"
          rel="noopener noreferrer"
          className="text-wine hover:underline break-all dark:text-[#c9707f]"
        >
          {token}
        </a>,
      )
    }

    lastIndex = match.index + token.length
  }

  if (lastIndex < rest.length) tokens.push(rest.slice(lastIndex))
  return tokens
}

/**
 * Спойлер: содержимое скрыто до осознанного клика.
 * Текст внутри не вырезается из DOM до раскрытия — <details> держит его
 * в разметке, но браузер не показывает. Кому важно не увидеть спойлер,
 * тот его не откроет.
 */
function Spoiler({ children }: { children: ReactNode }) {
  return (
    <details className="my-2 rounded-lg border border-[#681F2D]/30 bg-[#681F2D]/5 px-3 py-2 dark:border-[#493344] dark:bg-[#0E2931]">
      <summary className="cursor-pointer select-none text-xs font-medium text-[#681F2D] dark:text-[#c9707f]">
        ⚠️ Спойлер — нажмите, чтобы показать
      </summary>
      <div className="mt-2 text-[#4A2E27] dark:text-[#E2E2E0]">{children}</div>
    </details>
  )
}
