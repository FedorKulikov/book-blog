'use client'

import VoiceMessage from './VoiceMessage'

export type ChatMessage = {
  id: string
  text: string | null
  image_url: string | null
  audio_url: string | null
  audio_duration: number | null
  created_at: string
  read_at: string | null
  sender_id: string
}

export default function MessageBubble({
  message,
  isOwn,
  onImageClick,
}: {
  message: ChatMessage
  isOwn: boolean
  onImageClick?: (src: string) => void
}) {
  const time = new Date(message.created_at).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  })

  const hasImage = !!message.image_url
  const hasAudio = !!message.audio_url
  const hasText = !!message.text
  const imageOnly = hasImage && !hasText && !hasAudio
  const mediaOnly = (hasImage || hasAudio) && !hasText

  const bubbleShape = imageOnly
    ? 'rounded-xl p-0 overflow-hidden'
    : `px-3.5 py-2 rounded-[18px] ${
        isOwn ? 'rounded-br-[4px]' : 'rounded-bl-[4px]'
      }`

  const imageClass = `${
    imageOnly ? '' : 'rounded-xl'
  } max-w-[220px] sm:max-w-[260px] max-h-[320px] w-auto h-auto object-cover cursor-zoom-in`

  return (
    <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] ${
          isOwn ? 'bg-wine text-white' : 'bg-cream-warm text-brown-dark'
        } ${bubbleShape}`}
      >
        {hasImage && (
          onImageClick ? (
            <button
              type="button"
              onClick={() => onImageClick(message.image_url as string)}
              className={`block p-0 bg-transparent border-0 cursor-zoom-in ${
                hasText || hasAudio ? 'mb-1.5' : ''
              }`}
              aria-label="Открыть фото"
            >
              <img
                src={message.image_url as string}
                alt=""
                className={imageClass}
              />
            </button>
          ) : (
            <a
              href={message.image_url as string}
              target="_blank"
              rel="noopener noreferrer"
              className={`block ${hasText || hasAudio ? 'mb-1.5' : ''}`}
            >
              <img
                src={message.image_url as string}
                alt=""
                className={imageClass}
              />
            </a>
          )
        )}

        {hasAudio && (
          <div className={hasText ? 'mb-1' : ''}>
            <VoiceMessage
              audioUrl={message.audio_url as string}
              duration={message.audio_duration}
              isOwn={isOwn}
            />
          </div>
        )}

        {hasText && (
          <p className="text-sm whitespace-pre-wrap break-words">
            {message.text}
          </p>
        )}

        <div
          className={`text-[10px] flex items-center gap-1 ${
            isOwn ? 'text-white/60 justify-end' : 'text-brown/40'
          } ${mediaOnly ? 'px-2 pb-1' : 'mt-1'}`}
        >
          <span>{time}</span>
          {isOwn && <span>{message.read_at ? '✓✓' : '✓'}</span>}
        </div>
      </div>
    </div>
  )
}
