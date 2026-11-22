# Подтверждение регистрации через Supabase Send Email Hook + Resend

## Цель и границы

Почта применяется для подтверждения владения адресом при регистрации и, если включена Secure Email Change, при смене email. **Сброс пароля по email остаётся отключённым.** Event `recovery` всегда подавляется ответом `{}` без вызова mailer.

Цепочка доставки только внутри Supabase:

`GoTrue Send Email Hook → auth-email-hook → resend-mailer → Resend HTTPS API`.

Приложение Next.js не вызывает `resend-mailer` и не должно требовать Layero variables `SUPABASE_SECRET_KEY` или `SUPABASE_SERVICE_ROLE_KEY` для отправки подтверждений.

## Что добавлено в Edge Functions

### `auth-email-hook`

- Проверяет Standard Webhooks signature по исходному телу до JSON parsing.
- Нет `AUTH_EMAIL_HOOK_SECRET` → HTTP 500 (fail closed); неверная/просроченная подпись → 401.
- `signup`: отправляет письмо на `user.email`, строит ссылку строго на `https://bukleb.ru/auth/confirm?token_hash=…&type=signup`.
- `email_change`: следует текущему контракту Supabase Secure Email Change. Если включён режим подтверждения обоих адресов, отправляет отдельное письмо текущему адресу `user.email` и новому `user.new_email`. Supabase использует контринтуитивное соответствие: `token_hash_new` относится к текущему адресу, а `token_hash` — к новому. Если Secure Email Change выключен, отправляется одно письмо новому адресу с `token_hash`.
- `recovery`: возвращает `{}` и **не вызывает mailer**.
- Любой другой action: HTTP 501, чтобы GoTrue не считал неподдерживаемую доставку успешной.
- Не использует `site_url` или `redirect_to` из payload как origin или redirect. Единственный origin — серверная настройка `AUTH_EMAIL_SITE_URL=https://bukleb.ru`.
- Не пишет email, token hash, ссылку, тело письма или provider response в логи; логирование содержимого отсутствует.

Тема письма: `Подтвердите email — Хлеба и букв`. Текст и HTML содержат кнопку, информацию о том, что ссылка действует ограниченное время согласно настройке Supabase Auth, предупреждение не пересылать письмо и инструкцию проигнорировать его при неинициированном запросе. Числовой срок не выдумывается: перед отправкой нужно сверить фактическую настройку срока жизни email OTP в проекте.

### `resend-mailer`

- Внутренний endpoint принимает запрос только с точным project secret key в заголовке `apikey`; сравнение constant-time. Для функции `verify_jwt=false`, потому что новые Supabase `sb_secret_…` API keys — opaque keys, а не JWT; handler сам авторизует вызывающий сервис.
- `RESEND_API_KEY` читается только из Supabase Function Secrets.
- From фиксирован кодом: `Хлеба и букв <no-reply@bukleb.ru>`.
- Запрос к Resend идёт по HTTPS, с 10-секундным timeout и idempotency key; provider body не возвращается вызывающему коду.
- При повторной доставке Hook событие использует стабильные idempotency keys по webhook-id/action/recipient ordinal, не включая адрес или token hash.

## Особенность ссылки signup

В пользовательском письме URL содержит требуемое `type=signup`. Текущий Supabase JS verifyOtp token-hash API для регистрации документирует `type=email`. Поэтому страница `/auth/confirm` преобразует только входящий `signup` в API-тип `email`; `email_change` передаётся как `email_change`. Сам token hash не меняется. Проверка остаётся по кнопке, не на GET, чтобы почтовые сканеры не погашали ссылку автоматически.

## Деплой

- Edge Functions и `supabase/config.toml` хранятся в репозитории.
- PR targeting `main` запускает Deno tests и typecheck.
- После merge push в `main` запускает workflow Edge deploy.
- До deployment workflow только проверяет наличие имён Function Secrets `AUTH_EMAIL_HOOK_SECRET`, `RESEND_API_KEY`, `RECOVERY_CODE_SECRET` и проверяет, что GitHub `AUTH_EMAIL_HOOK_SECRET` подписывает synthetic recovery event, принимаемый уже развёрнутым Hook. Значения не выводятся.
- Deploy-порядок: сначала `resend-mailer`, затем `recovery`, последним `auth-email-hook`.
- Workflow не генерирует, не заменяет и не перезаписывает `AUTH_EMAIL_HOOK_SECRET`, `RESEND_API_KEY` или `RECOVERY_CODE_SECRET`. Он только добавляет/обновляет не секретный `AUTH_EMAIL_SITE_URL`.
- Workflow не меняет Send Email Hook URI/enabled, SMTP и `mailer_autoconfirm`.

## Состояние на 22 ноября 2026

- Resend domain `bukleb.ru`: общий статус и все четыре DNS records `verified` по ответу Resend API.
- DNS внесён владельцем: со слов владельца, опубликованные значения совпали с Resend и старые записи сохранены.
- Source изменений ещё находится в Draft PR; production Edge Functions этим PR не развёрнуты.
- Наличие `RESEND_API_KEY`, `AUTH_EMAIL_HOOK_SECRET` и `RECOVERY_CODE_SECRET` в Supabase Function Secrets не объявляется подтверждённым до preflight API/логов.
- Совпадение Hook signing secret в самой Auth Hook configuration требует отдельного подтверждения; preflight сравнивает GitHub secret с текущим deployed Function Secret.
- `mailer_autoconfirm` остаётся в текущем состоянии. Изменение на `false` разрешено только отдельным шагом после успешных шагов 2–6.
- Реальное письмо не отправлялось; SPF/DKIM по заголовкам не проверялись. Нужен тестовый mailbox владельца.
- Пользовательские signup/login и первый вход с выдачей резервных кодов пока не перестроены. Эти действия начинаются только после реальной проверки письма и ссылки.
- `RECOVERY_CODE_SECRET` и существующие резервные коды не менялись.

## Обязательный порядок B2

1. Принять PR source-функций в `main`; дождаться Edge deploy workflow success и сверить deployed functions.
2. Подтвердить отправку signup и email_change, подавление recovery, отсутствие 501 для ожидаемых типов.
3. Только на тестовом mailbox проверить фактическую доставку, spam folder, SPF/DKIM заголовки, ссылку `bukleb.ru/auth/confirm` и выпуск сессии после подтверждения.
4. Изменить signup UI и повторную отправку.
5. Перенести выдачу резервных кодов на первый вход после подтверждения.
6. Показать понятную ошибку и resend action для неподтверждённого входа.
7. Одним Management API PATCH изменить только `mailer_autoconfirm=false`; выполнить GET и подтвердить значение.
8. Провести E2E с отдельным тестовым аккаунтом и удалить его после проверки.

До успешного завершения всех пунктов B2 не закрывать.
