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

        <p className="mt-6 text-sm text-brown/70">
          Если не приходит письмо или нет доступа к ящику, напишите на{' '}
          <span className="select-all font-medium text-brown-dark">monikla1312@gmail.com</span>
          {' '}— восстановим доступ вручную.
        </p>

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
