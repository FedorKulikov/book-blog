import Link from 'next/link'
import { passkeysEnabled } from '@/lib/passkeys'

export default function ForgotPasswordPage() {
  return (
    <main className="p-4 md:p-8 flex justify-center">
      <div className="w-full max-w-md">
        <h1 className="text-3xl font-bold mb-4 text-emerald-dark">
          🔑 Забыли пароль?
        </h1>

        <div className="rounded-xl border border-emerald-dark/15 bg-cream-warm/30 p-4 mb-6">
          <p className="text-sm text-brown-dark">
            Сбросить пароль можно с помощью резервного кода, который вы сохранили
            при регистрации или создали в настройках профиля.
          </p>
        </div>

        <p className="text-sm text-brown/70 mb-3">
          Для восстановления по резервному коду понадобятся:
        </p>
        <ul className="text-sm text-brown/70 space-y-1 mb-6 list-disc pl-5">
          <li>имя пользователя;</li>
          <li>один неиспользованный резервный код;</li>
          <li>новый пароль длиной не менее 8 символов.</li>
        </ul>

        <div className="flex flex-wrap gap-3">
          <Link
            href="/recover-account"
            className="rounded-full bg-emerald-mid px-5 py-2.5 text-sm text-cream hover:bg-emerald-dark transition-colors"
          >
            Восстановить по коду
          </Link>
          <Link
            href="/login"
            className="rounded-full border border-emerald-dark/20 px-5 py-2.5 text-sm text-brown-dark hover:border-emerald-mid transition-colors"
          >
            Ко входу
          </Link>
        </div>

        {passkeysEnabled && (
          <p className="mt-6 text-sm text-brown/70">
            Ранее добавляли ключ доступа? На странице входа выберите «Войти с ключом доступа». После входа откройте настройки профиля, смените пароль и создайте новый набор резервных кодов.
          </p>
        )}

        <p className="mt-4 text-sm text-brown/60">
          Сброс пароля по ссылке из email отключён. Подтверждение доступа к почтовому ящику в настройках профиля не включает сброс пароля по email. Если вы потеряли пароль и все резервные коды, используйте заранее сохранённый passkey; без него потребуется отдельная ручная проверка.
        </p>
      </div>
    </main>
  )
}
