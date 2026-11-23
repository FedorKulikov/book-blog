import type { Metadata } from 'next'
import Link from 'next/link'
import { DISTRIBUTION_CONSENT_VERSION } from '@/lib/distribution-consent'

export const metadata: Metadata = {
  title: 'Согласие на распространение данных',
  description: 'Какие данные профиля и публикаций доступны посетителям сайта и как отозвать согласие.',
}

export default function ConsentDistributionPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8 md:px-8">
      <Link href="/profile/edit" className="mb-6 inline-flex text-sm text-brown/70 underline hover:text-wine">
        Вернуться к профилю
      </Link>

      <article className="space-y-6 rounded-2xl border border-emerald-dark/10 bg-cream-warm/30 p-5 md:p-8">
        <header className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-emerald-mid">
            Отдельное согласие
          </p>
          <h1 className="font-playfair text-2xl font-bold text-emerald-dark md:text-3xl">
            Распространение персональных данных
          </h1>
          <p className="text-sm text-brown/60">
            Версия документа {DISTRIBUTION_CONSENT_VERSION}
          </p>
          <p className="leading-relaxed text-brown-dark">
            Ниже перечислено, какие данные становятся доступными другим людям,
            когда ты даёшь отдельное согласие на публичный профиль или создаёшь
            публикацию.
          </p>
        </header>

        <section className="space-y-2">
          <h2 className="font-semibold text-emerald-dark">Публичные поля профиля</h2>
          <p className="leading-relaxed text-brown-dark">
            На странице твоего публичного профиля посетители сайта смогут увидеть
            имя пользователя, фотографию профиля, описание «О себе» и дату
            регистрации («С нами с»). Город в профиле не собирается и не
            публикуется.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold text-emerald-dark">Данные публикаций</h2>
          <p className="leading-relaxed text-brown-dark">
            Вместе с публикацией посетители смогут увидеть её заголовок и текст,
            прикреплённые изображения, теги и ссылку на выбранную книгу. Также
            показываются имя пользователя и аватар автора. Для новостей могут
            быть видны категория, дата окончания и ссылка на источник, если ты
            их указал.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold text-emerald-dark">Кому доступны данные</h2>
          <p className="leading-relaxed text-brown-dark">
            Эти данные доступны всем посетителям сайта, а не только
            зарегистрированным пользователям. Публичные страницы и изображения
            могут открываться по прямой ссылке, а страницы профиля и публикации
            могут попадать в поисковые системы.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold text-emerald-dark">Как отозвать согласие</h2>
          <p className="leading-relaxed text-brown-dark">
            Направь оператору запрос на отзыв согласия и прекращение
            распространения данных по контактам, указанным в{' '}
            <Link href="/privacy#contact" className="underline text-wine hover:text-wine-dark">
              политике конфиденциальности
            </Link>
            . Само удаление публикации, изображения или прекращение дальнейшего
            распространения могут быть отдельными действиями; укажи в запросе,
            что именно нужно прекратить.
          </p>
        </section>

        <p className="border-t border-emerald-dark/10 pt-4 text-sm leading-relaxed text-brown/70">
          Согласие на публичные поля профиля и согласие на публикацию
          фиксируются отдельно. Они не заменяют правила сайта и не объединены
          с их принятием. Приватные настройки уведомлений в этот перечень не
          входят.
        </p>
      </article>
    </main>
  )
}
