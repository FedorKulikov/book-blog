import type { Metadata } from 'next'
import Link from 'next/link'
import CookieSettingsButton from '@/app/components/CookieSettingsButton'

export const metadata: Metadata = {
  title: 'Политика конфиденциальности',
  description: 'Информация об обработке персональных данных на сайте «Хлеба и букв».',
  alternates: { canonical: '/privacy' },
  robots: { index: true, follow: true },
}

const OWNER = 'ТРЕБУЕТСЯ ОТ ВЛАДЕЛЬЦА'

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-8 md:px-8 md:py-12">
      <h1 className="font-playfair text-3xl font-bold text-emerald-dark">Политика конфиденциальности</h1>
      <p className="mt-3 text-sm text-wine">Документ пока не утверждён. Все пропуски должны быть заполнены владельцем.</p>
      <section className="mt-8 space-y-4 text-sm leading-7">
        <h2 className="font-playfair text-xl font-bold">1. Оператор</h2>
        <p>Полное наименование / ФИО: {OWNER}.</p>
        <p>Статус (физическое лицо / ИП / организация), ИНН/ОГРН при наличии: {OWNER}.</p>
        <p>Страна и адрес оператора: {OWNER}.</p>
        <p id="contact">Публичный контакт для запросов по персональным данным: {OWNER}.</p>

        <h2 className="font-playfair text-xl font-bold">2. Категории данных</h2>
        <p>Аккаунт: email, username, внутренний UUID и сведения аутентификации.</p>
        <p>Профиль, публикации, комментарии, реакции, закладки, сообщения, вложения, тикеты поддержки и технические сведения.</p>
        <p>Резервные коды хранятся в виде HMAC-хешей; IP и другие идентификаторы могут обрабатываться в защитных механизмах.</p>

        <h2 className="font-playfair text-xl font-bold">3. Цели и основания</h2>
        <p>Регистрация, вход, работа профиля и контента, сообщения, поддержка, модерация и безопасность. Точное основание отдельно по каждой цели: {OWNER}.</p>
        <p>Необязательная аналитика должна включаться только после отдельного выбора пользователя.</p>

        <h2 className="font-playfair text-xl font-bold">4. Поставщики</h2>
        <p>Supabase: Auth, PostgreSQL, Storage, Realtime; production region eu-central-1, Frankfurt. Договоры и трансграничные основания: {OWNER}.</p>
        <p>Layero: размещение приложения. Юридическое лицо, логи и сроки хранения: {OWNER}.</p>
        <p>GitHub Actions: CI и резервные копии; retention логов и артефактов: {OWNER}.</p>
        <p>Backblaze B2: зашифрованные backup базы; регион bucket и сроки хранения: {OWNER}.</p>
        <p>Яндекс.Метрика: необязательная аналитика после согласия; cookies и настройки production: {OWNER}.</p>
        <p>Resend: код готов, но production-запуск не подтверждён; не считать действующим поставщиком до отдельного включения.</p>
        <p>Selectel используется для DNS; обработка пользовательского контента не подтверждена.</p>

        <h2 className="font-playfair text-xl font-bold">5. Хранение и права</h2>
        <p>Сроки хранения аккаунтов, контента, сообщений, тикетов, логов и backup: {OWNER}.</p>
        <p>Порядок доступа, исправления, удаления, отзыва согласия и обращения без входа в аккаунт: {OWNER}.</p>
        <p>Самостоятельное удаление аккаунта в опубликованной версии приложения не подтверждено.</p>

        <h2 id="cookies" className="font-playfair text-xl font-bold">6. Cookies и аналитика</h2>
        <p>Точные cookies и сроки жизни: {OWNER}. Аналитика должна запускаться только после выбора «Разрешить аналитику».</p>
        <CookieSettingsButton />

        <h2 className="font-playfair text-xl font-bold">7. Возраст и юрисдикции</h2>
        <p>Минимальный возраст, страны аудитории и правила для несовершеннолетних: {OWNER}.</p>
        <p>Проверка локализации, трансграничной передачи и применимости 152-ФЗ/GDPR: {OWNER}.</p>

        <h2 className="font-playfair text-xl font-bold">8. Обновление</h2>
        <p>Дата утверждения, версия и порядок уведомления: {OWNER}.</p>
        <p>Официальные запросы направляются по контакту из раздела 1. Для обращений по работе аккаунта доступна <Link href="/support" className="underline">поддержка</Link>.</p>
      </section>
    </main>
  )
}
