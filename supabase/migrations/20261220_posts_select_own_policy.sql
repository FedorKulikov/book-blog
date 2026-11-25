-- Автор обязан видеть собственные публикации, в том числе только что созданные.
--
-- Причина: supabase-js после INSERT запрашивает строку обратно
-- (PostgREST Prefer: return=representation — это делает .select() в цепочке).
-- PostgreSQL при этом применяет к возвращаемой строке политики SELECT,
-- и если политика её не отдаёт, вставка отклоняется целиком с кодом 42501:
-- «new row violates row-level security policy for table "posts"».
-- В итоге публикация не создавалась, хотя права на вставку и согласие были.
--
-- Политики SELECT объединяются по ИЛИ, поэтому дополнительная разрешающая
-- политика ничего не сужает: она только добавляет автору доступ к своим строкам.

drop policy if exists posts_select_own on public.posts;

create policy posts_select_own on public.posts
  for select
  to authenticated
  using (user_id = (select auth.uid()));