'use client'

// app/forgot-password/page.tsx
//
// Восстановление пароля по email отключено.
//
// Причина: подтверждение почты в проекте выключено, поэтому Supabase
// помечает любой адрес подтверждённым автоматически. Владелец чужого
// ящика мог запросить ссылку сброса и захватить чужой аккаунт.
// Пока владение адресом не проверяется независимо, ссылка сброса —
// это дыра, а не функция.
//
// Рабочий способ — одноразовые резервные коды: /recover-account.
import Link from 'next/link'

export default function ForgotPasswordPage() {
  return (
    <main className="p-4 md:p-8 flex justify-center">
      <div className="w-full max-w-md">
        <h1 className="text-3xl font-bold mb-4 text-emerald-dark">
          🔑 Восстановление пароля
        </h1>

        <div className="rounded-xl border border-wine/25 bg-wine/5 p-4 mb-6">
          <p className="text-sm text-brown-dark">
            Восстановление по ссылке из письма <strong>отключено</strong>:
            адреса при регистрации не подтверждаются, поэтому письмо могло бы
            уйти владельцу чужого ящика.
          </p>
        </div>

        <p className="text-brown-dark/80 mb-4">
          Пароль восстанавливается по резервному коду — тому набору, который вы
          сохранили при регистрации или создали в настройках профиля.
        </p>

        <ul className="text-sm text-brown/70 space-y-1 mb-6">
          <li>• Имя пользователя</li>
          <li>• Один резервный код</li>
          <li>• Новый пароль</li>
        </ul>

        <div className="flex flex-wrap gap-3">
          <Link
            href="/recover-account"
            className="rounded-full bg-emerald-mid px-5 py-2.5 text-sm text-cream hover:bg-emerald-dark transition-colors"
          >
            Восстановить по резервному коду
          </Link>
          <Link
            href="/login"
            className="rounded-full border border-emerald-dark/20 px-5 py-2.5 text-sm text-brown-dark hover:border-emerald-mid transition-colors"
          >
            Ко входу
          </Link>
        </div>

        <p className="mt-6 text-sm text-brown/60">
          Кодов нет? Восстановить доступ без них нельзя: аккаунт не связан с
          подтверждённым адресом. Обратитесь к администрации.
        </p>
      </div>
    </main>
  )
}