# Подтверждение владения email — Resend через Supabase Edge Function

## Назначение и ограничения

Email используется только для отдельного подтверждения, что пользователь контролирует текущий почтовый ящик. Это подтверждение само по себе **не включает и не предоставляет сброс пароля по email**.

Сброс пароля по-прежнему выполняется одноразовым резервным кодом или заранее сохранённым passkey. Email-ссылки для сброса пароля запрещены. Endpoint /api/email-recovery/reset-request оставлен как нейтральный совместимый маршрут: он не ищет аккаунт, не создаёт Auth recovery token и не отправляет письмо. Форма email reset удалена. Флаг NEXT_PUBLIC_ENABLE_EMAIL_RECOVERY включает только подтверждение владения почтовым ящиком.

Старые значения auth.users.email_confirmed_at не считаются доказательством владения почтой. Отдельная процедура:
1. Пользователь входит в аккаунт и открывает настройки профиля.
2. Запрашивает письмо на текущий email.
3. Ссылка содержит случайный токен с 256 битами энтропии, действует 20 минут и используется один раз.
4. В БД хранятся HMAC-хеши email и токена.
5. После открытия ссылки подтверждается только контроль над текущим адресом.

## Доставка писем

Отправка выполняется через отдельную Supabase Edge Function resend-mailer; Next.js route handler не обращается к Resend API напрямую.

Схема вызова:
1. app/api/email-recovery/request/route.ts проверяет сессию пользователя, выдаёт одноразовый токен через Supabase RPC и строит ссылку на https://bukleb.ru/email-recovery/confirm.
2. Серверный Node.js handler вызывает https://<project-ref>.supabase.co/functions/v1/resend-mailer.
3. Запрос авторизуется новым Supabase secret API key в заголовке apikey. Ключ находится только в серверном окружении Layero и в стандартном хранилище ключей Supabase; он не попадает в клиентский bundle.
4. Edge Function сверяет apikey со значением ключа default из платформенной переменной SUPABASE_SECRET_KEYS. Для функции установлено verify_jwt = false; авторизация выполняется внутри handler сравнением ключа. Не передавать новый sb_secret_… как Authorization: Bearer — новые API keys не являются JWT.
5. Edge Function берёт RESEND_API_KEY только из Supabase Function Secrets и отправляет HTTPS POST на https://api.resend.com/emails. Timeout внешнего запроса — 10 секунд. Ответы провайдера, адрес получателя, содержимое письма и одноразовые токены не записываются в логи.

Фиксированный отправитель:
Хлеба и букв <no-reply@bukleb.ru>

Почтовый домен:
- Domain: bukleb.ru.
- Resend domain ID: f7a3e373-1d49-4c08-bef2-4a8bacdd32b2.
- Resend region: us-east-1 (США).
- Resend API подтвердил verified для DKIM TXT, SPF MX, SPF TXT и CNAME rsend.
- Open/click tracking выключены; приём почты выключен.

Регион us-east-1 — существенный факт для оценки трансграничной передачи и документации политики. В Resend/Supabase SMTP менять не требуется; Supabase Send Email Hook заменяет встроенную отправку и должен оставаться включённым.

## Секреты и их размещение

| Переменная | Где должна находиться | Назначение |
|---|---|---|
| RESEND_API_KEY | Только Supabase Function Secrets | Авторизация Resend API внутри resend-mailer |
| SUPABASE_SECRET_KEY | Только серверное окружение приложения (Layero) и стандартный Supabase key store | apikey для вызова защищённой Edge Function; не NEXT_PUBLIC_ |
| SUPABASE_SERVICE_ROLE_KEY | Существующее серверное окружение приложения | Admin client для RPC/проверок токена; не менять в этой работе |
| AUTH_EMAIL_HOOK_SECRET | GitHub Actions Secrets + Supabase Function Secrets + конфигурация Send Email Hook | Один и тот же стабильный Standard Webhooks signing secret |
| EMAIL_RECOVERY_SECRET | Серверное окружение приложения (Layero) | HMAC-хеширование email и одноразовых verification tokens |
| AUTH_EMAIL_SITE_URL | Серверное окружение приложения | Фиксированный origin https://bukleb.ru |
| NEXT_PUBLIC_ENABLE_EMAIL_RECOVERY | Переменная приложения | Включает только подтверждение адреса, не password-reset письма |

Ни один секрет не должен иметь префикс NEXT_PUBLIC_. Не копировать RESEND_API_KEY в GitHub Secrets, Layero или репозиторий. Не выводить значения в чат, журналы, workflow output или файлы.

AUTH_EMAIL_HOOK_SECRET должен оставаться стабильным: PR #25 обновил .github/workflows/edge-deploy.yml так, чтобы workflow читал его из GitHub Secrets вместо генерации нового значения. Перед использованием всё равно требуется подтвердить наличие секрета в GitHub Actions, наличие того же значения в Supabase Function Secrets и совпадение с конфигурацией Hook. Само существование workflow не доказывает, что все три значения установлены и совпадают.

RECOVERY_CODE_SECRET не менять, не генерировать и не синхронизировать заново: он связан с активными резервными кодами пользователей. Текущий Edge deployment workflow для этой ветки удаляет RECOVERY_CODE_SECRET из preflight и команды supabase secrets set, чтобы не перезаписывать его.

## Миграция базы

Миграция:
supabase/migrations/20261207_email_recovery_verification.sql

Она создаёт отдельный механизм подтверждения email. Перед применением production migration требуется подтвердить уже применённую версию и checksum; не запускать повторно вслепую и не выбирать ALL.

## Порядок rollout

1. Проверить через Resend API, что bukleb.ru и все выданные DNS records имеют статус verified. На 22.11.2026 этот шаг подтверждён Resend API.
2. Проверить наличие стабильного AUTH_EMAIL_HOOK_SECRET в GitHub/Supabase и совпадение с Auth Hook configuration. Значения не читать и не выводить.
3. Убедиться, что серверное окружение приложения содержит SUPABASE_SECRET_KEY (новый sb_secret_…) и существующий SUPABASE_SERVICE_ROLE_KEY. Если ключ для mailer отсутствует, добавить его только как серверную переменную; не помещать в браузер.
4. Владелец добавляет RESEND_API_KEY вручную только в Supabase → Edge Function Secrets. До завершения этой операции отправка не будет работать.
5. Через отдельный Draft PR внести и проверить source изменения: resend-mailer, auth-email-hook и recovery. Сам Draft PR не должен запускать production deploy; deploy запускается только отдельным merge/разрешением.
6. После явного разрешения владельца выполнить deploy через операционную ветку; проверить unsigned вызовы, ожидаемый HTTP 401 для resend-mailer без apikey, Deno tests, TypeScript checks и integration test Hook.
7. Только последним переключать Send Email Hook URI на https://<project-ref>.supabase.co/functions/v1/auth-email-hook после подтверждения, что тот же стабильный AUTH_EMAIL_HOOK_SECRET уже находится в Supabase Function Secrets и Hook config.
8. hook_send_email_enabled всё время остаётся true. Не переключать SMTP и не выключать Hook.
9. Отправить только тестовое письмо подтверждения почтового адреса. Проверить фактическую доставку, папку spam, заголовки письма (SPF/DKIM pass) и ссылку на bukleb.ru. Не отправлять и не тестировать password-reset email.
10. Сравнить ответ публичного /auth/v1/recover для существующего и неизвестного адреса; он должен оставаться нейтральным и без отправки писем.

## Поведение при выключенном или недоступном mailer

Если NEXT_PUBLIC_ENABLE_EMAIL_RECOVERY выключен, UI подтверждения почты не показывается. Если секреты или Edge Function не готовы, подтверждение адреса не выполняется; пользователь сохраняет восстановление по резервным кодам/passkeys. Никаких ссылок для сброса пароля по email не отправляется.

## Ограничение для старых пользователей

Существующие аккаунты не подтверждаются автоматически. Каждый пользователь, пока имеет доступ к аккаунту, должен один раз подтвердить текущий адрес. Пользователь, потерявший пароль, все резервные коды и passkeys, не получает автоматическое восстановление по неподтверждённому email; потребуется отдельная ручная проверка личности.
