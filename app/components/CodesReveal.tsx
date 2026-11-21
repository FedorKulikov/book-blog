'use client'

// app/components/CodesReveal.tsx
//
// Показ свежесгенерированных резервных кодов. Используется дважды:
// при регистрации и в настройках профиля.
//
// Компонент намеренно ничего не сохраняет: коды живут только в состоянии
// страницы. Обновил вкладку — набор пропал, и повторно сервер его не отдаст.
import { useState } from 'react'

type Props = {
  codes: string[]
  onDone: () => void
  doneLabel?: string
  title?: string
}

export default function CodesReveal({
  codes,
  onDone,
  doneLabel = 'Готово, я сохранил',
  title = 'Сохраните коды — они больше не появятся',
}: Props) {
  const [copied, setCopied] = useState(false)
  const [confirmedSaved, setConfirmedSaved] = useState(false)
  const [error, setError] = useState('')

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(codes.join('\n'))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Браузер не дал скопировать. Выделите коды вручную.')
    }
  }

  function download() {
    const header = [
      'Резервные коды «Хлеба и букв»',
      '',
      'Каждый код одноразовый. Храните в месте, недоступном другим.',
      'Восстановление: /recover-account — имя пользователя и один код.',
      '',
    ].join('\n')

    const blob = new Blob([`${header}${codes.join('\n')}\n`], {
      type: 'text/plain;charset=utf-8',
    })

    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'recovery-codes.txt'
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="rounded-xl border border-emerald-dark/15 p-4">
      <h2 className="font-semibold text-emerald-dark mb-2">{title}</h2>

      <p className="text-sm text-wine/90 mb-1">
        Скопируйте или скачайте сейчас. После закрытия страницы увидеть эти коды
        повторно нельзя: на сервере хранятся только их хеши.
      </p>
      <p className="text-xs text-brown/60 mb-3">
        Восстановление: <span className="font-mono">/recover-account</span> —
        имя пользователя и один из кодов.
      </p>

      <ul className="font-mono text-sm grid grid-cols-1 sm:grid-cols-2 gap-1 mb-4 select-all">
        {codes.map(code => (
          <li key={code} className="tracking-wider">
            {code}
          </li>
        ))}
      </ul>

      <label className="mb-3 flex items-start gap-2 text-sm text-brown-dark">
        <input
          type="checkbox"
          checked={confirmedSaved}
          onChange={event => setConfirmedSaved(event.target.checked)}
          className="mt-1"
        />
        <span>Я сохранил резервные коды в надёжном месте и понимаю, что они больше не будут показаны.</span>
      </label>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={copyAll}
          className="rounded-full bg-emerald-mid px-4 py-2 text-sm text-cream hover:bg-emerald-dark transition-colors"
        >
          {copied ? 'Скопировано' : 'Скопировать все'}
        </button>
        <button
          type="button"
          onClick={download}
          className="rounded-full border border-emerald-dark/20 px-4 py-2 text-sm text-brown-dark hover:border-emerald-mid transition-colors"
        >
          Скачать файлом
        </button>
        <button
          type="button"
          onClick={onDone}
          disabled={!confirmedSaved}
          className="rounded-full px-4 py-2 text-sm text-brown/70 hover:text-wine transition-colors disabled:cursor-not-allowed disabled:opacity-40"
        >
          {doneLabel}
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-wine">Ошибка: {error}</p>}
    </div>
  )
}
