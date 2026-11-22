import Link from 'next/link'
import { passkeysEnabled } from '@/lib/passkeys'
import EmailRecoveryResetForm from '@/app/components/EmailRecoveryResetForm'

export default function ForgotPasswordPage() {
  return (
    <main className="p-4 md:p-8 flex justify-center">
      <div className="w-full max-w-md">
        <h1 className="text-3xl font-bold mb-4 text-emerald-dark">
          🔑 Забыли пароль?
        </h1>

        <p className="text-sm text-brown/70 mb-5">
          Укажите email, связанный с аккаунтом. Если адрес зарегистрирован, мы отправим письмо со ссылкой для восстановления пароля. Проверьте также папку «Спам».
        </p>

        <EmailRecoveryResetForm />

        <div className="mt-6 rounded-xl border border-emerald-dark/15 bg-cream-warm/30 p-4">
          <p className="text-sm text-brown-dark mb-3">
            Нет доступа к почте или письмо не пришло? Можно восстановить доступ с помощью резервного кода, сохранённого при регистрации.
          </p>
          <Link
            href="/recover-account"
            className="inline-block rounded-full border border-emerald-dark/20 px-5 py-2.5 text-sm text-brown-dark hover:border-emerald-mid transition-colors"
          >
            Восстановить по резервному коду
          </Link>
        </div>

        {passkeysEnabled && (
          <p className="mt-6 text-sm text-brown/70">
            Ранее добавляли ключ доступа? На странице входа выберите «Войти с ключом доступа». После входа вы сможете сменить пароль в настройках профиля.
          </p>
        )}

        <p className="mt-4 text-sm text-brown/60">
          <Link href="/login" className="text-wine hover:underline">
            Вернуться ко входу
          </Link>
        </p>
      </div>
    </main>
  )
}
