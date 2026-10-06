export function humanizeError(message: string | undefined | null): string {
  if (!message) return 'Что-то пошло не так. Попробуйте ещё раз.'

  const m = message.toLowerCase()

  if (m.includes('invalid login credentials')) return 'Неверный email или пароль'
  if (m.includes('user already registered')) return 'Пользователь с таким email уже зарегистрирован'
  if (m.includes('email not confirmed')) return 'Email не подтверждён. Проверьте почту.'
  if (m.includes('password should be at least')) return 'Пароль слишком короткий (минимум 6 символов)'
  if (m.includes('unable to validate email') || m.includes('invalid email')) return 'Некорректный email адрес'
  if (m.includes('email rate limit exceeded')) return 'Слишком много попыток. Подождите несколько минут.'

  if (m.includes('duplicate key') && m.includes('username')) return 'Такое имя пользователя уже занято'
  if (m.includes('duplicate key') || m.includes('unique constraint')) return 'Такая запись уже существует'
  if (m.includes('row-level security') || m.includes('permission denied')) return 'Нет прав для этого действия'
  if (m.includes('violates foreign key')) return 'Связанная запись не найдена'

  if (m.includes('payload too large') || m.includes('exceeded')) return 'Файл слишком большой'
  if (m.includes('network') || m.includes('failed to fetch')) return 'Проблема с соединением. Проверьте интернет.'
  if (m.includes('jwt') || m.includes('token expired')) return 'Сессия истекла. Войдите заново.'

  return message.replace(/^error:\s*/i, '')
}
