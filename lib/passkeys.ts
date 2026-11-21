import { humanizeError } from '@/lib/errors'

/**
 * Passkeys are opt-in until the Supabase project and production domain are
 * configured for WebAuthn. Keep the UI hidden by default.
 */
export const passkeysEnabled =
  process.env.NEXT_PUBLIC_ENABLE_PASSKEYS === 'true'

export function passkeyErrorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const value = error as { code?: unknown; message?: unknown }

    if (value.code === 'passkey_disabled') {
      return 'Ключи доступа ещё не включены на сервере. Попробуйте позже.'
    }

    if (typeof value.message === 'string' && value.message.length > 0) {
      return humanizeError(value.message)
    }
  }

  if (error instanceof Error) {
    return humanizeError(error.message)
  }

  return 'Не удалось выполнить операцию с ключом доступа. Попробуйте ещё раз.'
}
