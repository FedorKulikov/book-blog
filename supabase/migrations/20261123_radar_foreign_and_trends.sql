-- ============================================================
-- «Книжный радар»: зарубежные новости и тренды недели.
--
-- 1) external_news.lang       — 'ru' | 'en': откуда новость
-- 2) external_news.title_ru   — русский заголовок. Заполняется ВРУЧНУЮ
--                               в админке (/admin/news): машинный перевод
--                               не используем, чтобы не плодить кривые фразы.
--                               Пока пусто — на сайте показывается оригинал.
-- 3) news_trends              — сводка «о чём пишут»: темы и имена,
--                               которые чаще всего встречаются в заголовках
--                               за неделю. Пересчитывается импортёром.
--
-- Выполнять в Supabase SQL Editor. Скрипт идемпотентный.
-- ============================================================

alter table public.external_news
  add column if not exists lang text not null default 'ru';

alter table public.external_news
  add column if not exists title_ru text;

comment on column public.external_news.lang is
  'Язык оригинала: ru | en (зарубежные ленты)';

comment on column public.external_news.title_ru is
  'Русский заголовок, введённый редактором вручную (иначе показываем оригинал)';

alter table public.external_news
  drop constraint if exists external_news_lang_check;

alter table public.external_news
  add constraint external_news_lang_check
  check (lang in ('ru', 'en'));

create index if not exists external_news_lang_created_idx
  on public.external_news (lang, created_at desc);

-- ------------------------------------------------------------
-- Тренды: одна строка = тема за конкретную неделю
-- ------------------------------------------------------------

create table if not exists public.news_trends (
  id bigserial primary key,
  topic text not null,
  kind text not null,
  mentions integer not null default 0,
  period_start timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint news_trends_kind_check check (kind in ('theme', 'name')),
  constraint news_trends_mentions_check check (mentions >= 0),
  constraint news_trends_unique unique (topic, kind, period_start)
);

comment on table public.news_trends is
  'Тренды книжного радара: темы и имена, упомянутые в новостях за неделю';

create index if not exists news_trends_period_mentions_idx
  on public.news_trends (period_start desc, mentions desc);

alter table public.news_trends enable row level security;

-- Читают все, пишет только импортёр (service_role обходит RLS)
drop policy if exists "news_trends_public_read" on public.news_trends;

create policy "news_trends_public_read"
  on public.news_trends
  for select
  using (true);

-- Проверка
select lang, count(*) as cnt
from public.external_news
group by lang
order by cnt desc;
