# Deployment checklist: Recovery + Send Email Hook + Resend mailer

Порядок обязателен. Каждый пункт подтверждать ответом API или логом.
Значения секретов не выводить в терминал, Actions logs, PR, issue или переписку.

## 0. Границы и инварианты

- Изменения выполняются через отдельную операционную ветку `ops/supabase-edge-deploy`; `main` этим workflow не меняется.
- Не менять Auth Email Hook URI до шага 7.
- `hook_send_email_enabled` должен оставаться `true`; выключение Hook может вернуть встроенную отправку через SMTP.
- Не менять и не перегенерировать `RECOVERY_CODE_SECRET`. Он обслуживает активные резервные коды.
- `RESEND_API_KEY` хранится только в Supabase Function Secrets. Он не добавляется в GitHub Secrets, Layero, клиентский код или репозиторий.
- `AUTH_EMAIL_HOOK_SECRET` — один стабильный секрет: GitHub Actions Secret, Supabase Function Secret и signing secret в конфигурации Supabase Auth Hook должны совпадать. В Layero его не добавлять.
- `SUPABASE_SECRET_KEY` нового формата нужен также в серверном окружении Next.js/Layero как caller credential для mailer; он не имеет префикса `NEXT_PUBLIC_`. Проверить наличие переменной, не раскрывая значение.

## 1. Проверить текущий Auth Hook

До любых переключений зафиксировать URI, enabled=true и факт наличия signing secret, не раскрывая значение.
Если точное совпадение секрета нельзя подтвердить, Hook не переключать.

## 2. Проверить домен Resend

Домен `bukleb.ru` должен иметь статус `verified` в Resend, а DNS records DKIM, MX, SPF TXT и CNAME должны иметь статус `verified`.
22.11.2026 Resend API подтвердил статус `verified` для всех четырёх записей.
Регион домена: `us-east-1` (США). Учитывать в оценке обработки/трансграничной передачи.

## 3. Подготовить секреты

- В серверном окружении приложения (Layero) должен быть установлен `SUPABASE_SECRET_KEY` нового формата для service-to-service вызова Edge mailer. Не использовать legacy JWT как `apikey`; значение не должно начинаться с `NEXT_PUBLIC_`. Наличие в Layero сейчас не проверено.
- `RESEND_API_KEY` должен быть добавлен вручную владельцем только в Supabase Function Secrets. Наличие имени этого секрета в Supabase на текущий момент не проверено; до подтверждения тестовую отправку не запускать.

- В GitHub Actions Secret должен находиться стабильный `AUTH_EMAIL_HOOK_SECRET` формата Standard Webhooks. Workflow только читает его и переносит в Supabase Function Secrets; он не генерирует новый ключ. Существующее значение не ротировать.
- Перед deploy workflow сначала проверяет список имён Supabase Function Secrets, не выводя значение, и требует существующие `AUTH_EMAIL_HOOK_SECRET` и `RESEND_API_KEY`. Затем отправляет синтетический подписанный recovery event с GitHub secret в уже развёрнутую `auth-email-hook`. Только HTTP 200 `{}` подтверждает, что GitHub secret совпадает с текущим Function Secret; при 401/500 workflow останавливается до deploy и записи секретов.
- Настройку signing secret в Supabase Auth Send Email Hook нельзя безопасно прочитать доступным API-коннектором. До переключения URI владелец должен отдельно подтвердить в Supabase Dashboard, что Hook settings используют то же значение; фактическое совпадение затем проверяется интеграционным запросом GoTrue после контролируемого переключения.
- То же значение должно быть указано в Supabase Auth Hook config.
- `RESEND_API_KEY` владелец добавляет вручную только в Supabase → Edge Function Secrets после verified домена. Перед запуском deploy/delivery владелец должен подтвердить наличие имени секрета в Dashboard; его значение не выводить.
- Существующий `RECOVERY_CODE_SECRET` не читать, не генерировать, не копировать повторно и не перезаписывать. Workflow его не синхронизирует.

## 4. Deploy Edge Functions

Workflow deploys:
- `recovery` — без изменения секретов кодов;
- `auth-email-hook` — проверка Standard Webhooks, recovery-событие подавляется;
- `resend-mailer` — отправка HTTPS API Resend.

Для `resend-mailer` новые Supabase secret API keys не являются JWT: в `supabase/config.toml` задано `verify_jwt = false`, а handler сверяет заголовок `apikey` со значением `default` из платформенной `SUPABASE_SECRET_KEYS` constant-time сравнением. Без точного совпадения mailer отвечает 401. В Next.js серверном окружении должен быть `SUPABASE_SECRET_KEY` нового формата; он передаётся только в `apikey` заголовке. Отправитель фиксирован: `Хлеба и букв <no-reply@bukleb.ru>`.
Не использовать `--prune`; не менять настройки Email provider/SMTP.

## 5. Проверить безопасные ответы

- `recovery?op=status` без JWT → 401.
- `auth-email-hook` без подписи → 401; без секрета → 500 (fail closed).
- `resend-mailer` без заголовка `apikey` или с неверным ключом → 401 в обработчике; обычный user JWT не даёт доступа.
- Deno unit tests покрывают Resend вызов, фиксированный From, idempotency key, 10-секундный timeout и отсутствие раскрытия provider response.
- Проверить, что workflow не содержит `RECOVERY_CODE_SECRET` и не передаёт его в `supabase secrets set`.

## 6. Отправка писем и защита пароля

- Письмо подтверждения владения email отправляется только из `resend-mailer` через Resend HTTPS API.
- Next.js серверный маршрут вызывает Edge Function с новым `SUPABASE_SECRET_KEY` только в заголовке `apikey`; Resend key остаётся в Function Secrets.
- Provider timeout ≤10 секунд; логи содержат только статические ошибки, без email, тела письма или токена.
- Verification link ведёт на `https://bukleb.ru/email-recovery/confirm`.
- Password-reset email links запрещены. `/api/email-recovery/reset-request` отвечает нейтрально и не отправляет письмо; сброс пароля остаётся по резервным кодам/passkeys.
- Feature flag включает только отправку подтверждения владения email, не парольные reset links.

## 7. Переключение Send Email Hook — последним

Только после:
1. домен Resend = `verified`;
2. `AUTH_EMAIL_HOOK_SECRET` подтверждён в GitHub и Supabase Function Secrets;
3. то же значение подтверждено в Auth Hook settings;
4. Edge Functions успешно развёрнуты и проверены.

Установить:
- `hook_send_email_uri = https://tbqjyaxbymntdqzldrjz.supabase.co/functions/v1/auth-email-hook`
- `hook_send_email_secrets =` то же стабильное значение;
- `hook_send_email_enabled = true`.

Не отключать Hook. Recovery-события должны возвращать нейтральный 200 без письма, одинаково для существующего и несуществующего аккаунта.

## 8. Проверка реальной доставки

После ручного добавления `RESEND_API_KEY` в Supabase Function Secrets и deploy:
- отправить только письмо подтверждения владения email на тестовый ящик;
- подтвердить доставку и отсутствие в спаме;
- проверить заголовки полученного письма: SPF и DKIM pass;
- From — `Хлеба и букв <no-reply@bukleb.ru>`;
- ссылка содержит домен bukleb.ru, не supabase.co;
- password-reset email не отправлять.

## 9. Откат

- Оставить `hook_send_email_enabled = true`.
- Не переключать Hook на SMTP и не отключать его.
- Если проблема в Resend mailer, выключить флаг подтверждения владения email; не включать альтернативную password-reset ссылку.
- `RECOVERY_CODE_SECRET` и резервные коды не менять.
- Не добавлять `AUTH_EMAIL_HOOK_SECRET` в Layero.

## Запрещено

- Менять или перегенерировать `RECOVERY_CODE_SECRET`.
- Отправлять password-reset ссылки.
- Переписывать существующие DNS-записи, NS или root SPF.
- Выводить секреты, email получателей, тела писем, JWT и одноразовые токены в логи.
- Отключать Send Email Hook или менять SMTP.
- Проверять сценарии на реальных пользовательских аккаунтах.
