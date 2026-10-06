'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Play, Pause } from './icons'

function formatTime(seconds: number) {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  const minutes = Math.floor(safe / 60)
  const rest = safe % 60
  return `${minutes}:${rest.toString().padStart(2, '0')}`
}

// Волна детерминированная (от url), чтобы полоски не «прыгали» при перерендерах
function makeBars(seed: string, count = 26) {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 2147483647
  }
  let state = hash || 7
  const bars: number[] = []
  for (let i = 0; i < count; i++) {
    state = (state * 1103515245 + 12345) % 2147483648
    const rnd = Math.abs(state) / 2147483648
    bars.push(Math.round(25 + rnd * 70))
  }
  return bars
}

export default function VoiceMessage({
  audioUrl,
  duration,
  isOwn,
}: {
  audioUrl: string
  duration: number | null
  isOwn: boolean
}) {
  const audioRef = useRef<HTMLAudioElement>(null)
  // useId вместо Math.random(): стабильный id инстанса без «нечистых» вызовов в рендере
  const voiceId = useId()

  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [total, setTotal] = useState(duration && duration > 0 ? duration : 0)

  const bars = useMemo(() => makeBars(audioUrl), [audioUrl])
  const progress = total > 0 ? Math.min(1, current / total) : 0

  // Останавливаемся, если заиграл другой плеер на странице
  useEffect(() => {
    function onOtherPlay(event: Event) {
      if ((event as CustomEvent<string>).detail !== voiceId) {
        audioRef.current?.pause()
        setPlaying(false)
      }
    }
    window.addEventListener('voice-play', onOtherPlay)
    return () => window.removeEventListener('voice-play', onOtherPlay)
  }, [voiceId])

  function togglePlay() {
    const el = audioRef.current
    if (!el) return

    if (playing) {
      el.pause()
      setPlaying(false)
      return
    }

    window.dispatchEvent(new CustomEvent('voice-play', { detail: voiceId }))
    const promise = el.play()
    if (promise) {
      promise.then(() => setPlaying(true)).catch(() => setPlaying(false))
    } else {
      setPlaying(true)
    }
  }

  const buttonClass = isOwn
    ? 'bg-white/20 hover:bg-white/30 text-white'
    : 'bg-brown-dark/10 hover:bg-brown-dark/20 text-brown-dark'
  const barOn = isOwn ? 'bg-white' : 'bg-brown-dark'
  const barOff = isOwn ? 'bg-white/40' : 'bg-brown-dark/25'

  return (
    <div className="flex items-center gap-2 min-w-[180px] py-1">
      <button
        type="button"
        onClick={togglePlay}
        aria-label={playing ? 'Пауза' : 'Воспроизвести'}
        className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${buttonClass}`}
      >
        {playing ? (
          <Pause size={16} fill="currentColor" />
        ) : (
          <Play size={16} fill="currentColor" />
        )}
      </button>

      <div className="flex-1 flex items-center gap-[2px] h-6">
        {bars.map((height, index) => (
          <span
            key={index}
            style={{ height: `${height}%` }}
            className={`w-[3px] rounded-full transition-colors ${
              index / bars.length < progress ? barOn : barOff
            }`}
          />
        ))}
      </div>

      <span
        className={`text-[10px] tabular-nums flex-shrink-0 ${
          isOwn ? 'text-white/70' : 'text-brown/60'
        }`}
      >
        {formatTime(current)} / {formatTime(total)}
      </span>

      <audio
        ref={audioRef}
        src={audioUrl}
        preload="metadata"
        className="hidden"
        onLoadedMetadata={() => {
          const value = audioRef.current?.duration
          if (!duration && value && Number.isFinite(value)) {
            setTotal(Math.round(value))
          }
        }}
        onTimeUpdate={() => setCurrent(audioRef.current?.currentTime ?? 0)}
        onEnded={() => {
          setPlaying(false)
          setCurrent(0)
          if (audioRef.current) audioRef.current.currentTime = 0
        }}
      />
    </div>
  )
}
