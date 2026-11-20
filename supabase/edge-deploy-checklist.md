# Deployment checklist: Recovery + Send Email Hook → Supabase Edge Functions

Порядок обязателен. Каждый шаг проверяем до перехода к следующему.
Секреты не выводятся в терминал, логи, GitHub и переписку.

## 0. Предусловия

- [ ] Изменения идут через `dev`; `main` не трогаем без необходимости.
- [ ] Локальные проверки зелёные: `npx tsc --noEmit`, `npm run build`,
      `npx deno check`, `npx deno test --allow-env supabase/functions/`.
- [ ] Зафиксирована текущая конфигурация Hook (URI + факт наличия секрета,
      без значения).

## 1. Проверить отсутствие активных Recovery-кодов

```sql
select count(*) as active
from private.recovery_codes
where used_at is null and revoked_at is null;
```

Если `active > 0` — `RECOVERY_CODE_SECRET` менять нельзя: выданные коды
перестанут совпадать. Секрет переносится как есть.

## 2. Получить или сгенерировать `RECOVERY_CODE_SECRET`

- Активных кодов нет → можно сгенерировать новый.
- Сгенерировать: `openssl rand -hex 32` (≥32 символа).
- Значение сразу пишется в Supabase Function Secrets, минуя файлы и логи.

## 3. Сгенерировать новый Standard Webhooks секрет

```bash
node -e "console.log('v1,whsec_' + require('crypto').randomBytes(32).toString('base64'))"
```

## 4. Добавить оба секрета в Supabase Function Secrets

- `RECOVERY_CODE_SECRET`
- `AUTH_EMAIL_HOOK_SECRET`

Системные `SUPABASE_*` вручную не создаются. Значения не попадают в shell
history и CI-логи.

## 5. Deploy обеих функций

```bash
supabase functions deploy recovery --use-api
supabase functions deploy auth-email-hook --use-api
```

Без `--prune`, без Docker. После деплоя — ровно две функции.

## 6. Проверить функции прямыми запросами

- `recovery?op=status` без JWT → 401.
- `auth-email-hook` без подписи → 401; без секрета → 500 (fail closed).
- Валидная подпись → 200 `{}`.
- `recovery?op=redeem` с неверным кодом → 400 с нейтральным текстом.

## 7. Переключить Send Email Hook атомарно

Одним PATCH Management API:

- `hook_send_email_uri = https://<ref>.supabase.co/functions/v1/auth-email-hook`
- `hook_send_email_secrets = <новый секрет>`
- `hook_send_email_enabled = true`

Секрет уже должен быть в Function Secrets (шаг 4) — иначе между переключением
и появлением секрета Hook будет отдавать 500.

Проверить после:
- `POST /auth/v1/recover` для существующего адреса → `{}` / 200;
- для неизвестного адреса → `{}` / 200 (ответы совпадают);
- письмо не приходит (Hook — единственный отправитель).

## 8. Проверить восстановление на тестовом аккаунте

- создать временного пользователя;
- получить коды через `generate`;
- восстановить пароль по одному коду → 200;
- войти новым паролем; старый не работает;
- повторное использование кода → 400;
- два параллельных запроса с одним кодом → успешен ровно один;
- удалить тестового пользователя (коды уходят каскадом).

На реальных аккаунтах не проверяем.

## 9. Проверить регистрацию, вход и прокси

- `signup` без подтверждения email → 200 + сессия;
- `login` → 200;
- `/api/recovery/status` с сессией → `{active, configured}`;
- `/api/recovery/generate` с сессией и паролем → 10 кодов;
- preview Layero: `/api/recovery/*` → 404 (guard);
- в клиентских бандлах нет секретов.

## 10. Откат

**Важно:** Send Email Hook НЕ отключаем. Согласно документации Supabase,
Hook заменяет встроенную отправку писем; при выключенном Hook и включённом
Email-провайдере Supabase уходит на SMTP. Отключение Hook — это не «выключить
письма», а «включить другой канал доставки», чего мы как раз избегаем.

Безопасный откат:

1. **Оставить `hook_send_email_enabled = true`.**
2. Вернуть `hook_send_email_uri` на `https://bukleb.ru/api/auth/email-hook`.
   Layero не содержит `AUTH_EMAIL_HOOK_SECRET`, поэтому старый endpoint
   отвечает `500 hook_not_configured` — это **fail-closed** аварийный режим:
   Auth-письма временно не доставляются, но и SMTP не включается, и захват
   через чужой email невозможен.
3. Откатить коммит с прокси `app/api/recovery/*` на предыдущую версию из `dev`.
4. Edge Functions можно оставить развёрнутыми: без вызовов они безвредны.
5. Секрет `AUTH_EMAIL_HOOK_SECRET` в Layero **не добавлять** — это вернёт
   привилегированную переменную в общее окружение preview/production.
6. Не ослаблять проверку подписи «ради отката».

После отката проверить: `recover` отдаёт нейтральные ответы, вход работает,
письма не уходят.

## Запрещено на всех шагах

- `--prune` при деплое.
- Ручное создание системных `SUPABASE_*` секретов.
- Отключение Send Email Hook ради «остановки писем».
- Логирование кодов, паролей, JWT и секретов.
- Изменение RLS, миграций, RPC и таблиц.
- Тесты на реальных пользовательских аккаунтах.
