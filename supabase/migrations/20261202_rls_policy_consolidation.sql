-- 20261202_rls_policy_consolidation.sql
--
-- Убираем реальные пересечения permissive RLS policies без изменения
-- исходной модели доступа:
--   • public read для каталога книг остаётся public;
--   • owner OR staff объединяется в одну политику;
--   • приватные операции/строки явно ограничиваются authenticated;
--   • дублирующие UPDATE policies чата удаляются.
--
-- В PostgreSQL permissive policies объединяются через OR. Поэтому после
-- объединения каждого набора USING/WITH CHECK содержит ту же OR-логику.
-- Анонимные посетители сохраняют публичное чтение, но не получают
-- политики на приватные строки/записи.
--
-- DML grants уже отдельно ограничены миграцией 20261136.
-- Идемпотентно.

begin;

-- ------------------------------------------------------------------ --
-- 1. Книги: оставить ровно одну публичную SELECT policy               --
-- ------------------------------------------------------------------ --

drop policy if exists "Public can read books" on public.books;
drop policy if exists "books readable" on public.books;
drop policy if exists "books_read_all" on public.books;

create policy books_read_all
  on public.books
  for select
  to public
  using (true);

alter policy books_update_own_or_staff
  on public.books
  to authenticated
  using (
    (select auth.uid()) = created_by
    or exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.role in ('admin', 'moderator')
    )
  )
  with check (
    (select auth.uid()) = created_by
    or exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.role in ('admin', 'moderator')
    )
  );

-- ------------------------------------------------------------------ --
-- 2. Приватные owner/staff policies: TO authenticated                --
-- ------------------------------------------------------------------ --

alter policy action_log_read_own on public.action_log to authenticated;

alter policy comments_insert_own on public.comments to authenticated;
alter policy comments_update_own
  on public.comments
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists comments_delete_own on public.comments;
drop policy if exists comments_delete_staff on public.comments;
create policy comments_delete_own_or_staff
  on public.comments
  for delete
  to authenticated
  using (
    (select auth.uid()) = user_id
    or exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role in ('admin', 'moderator')
    )
  );

alter policy conversations_delete_staff on public.conversations to authenticated;
alter policy conversations_insert_own on public.conversations to authenticated;
alter policy conversations_read_own on public.conversations to authenticated;
alter policy conversations_update_own
  on public.conversations
  to authenticated
  using (
    (select auth.uid()) = user1_id
    or (select auth.uid()) = user2_id
  )
  with check (
    (select auth.uid()) = user1_id
    or (select auth.uid()) = user2_id
  );

alter policy follows_delete_own on public.follows to authenticated;
alter policy follows_insert_own on public.follows to authenticated;

alter policy likes_insert_own on public.likes to authenticated;
drop policy if exists likes_delete_own on public.likes;
drop policy if exists likes_delete_staff on public.likes;
create policy likes_delete_own_or_staff
  on public.likes
  for delete
  to authenticated
  using (
    (select auth.uid()) = user_id
    or exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role in ('admin', 'moderator')
    )
  );

alter policy messages_delete_staff on public.messages to authenticated;
alter policy messages_insert_own on public.messages to authenticated;
alter policy messages_read_own on public.messages to authenticated;

-- messages_update_read и «Участники отмечают прочитанным» имели одинаковое
-- USING для участников. Вторая policy уже ограничена authenticated и
-- дополнительно задаёт тот же WITH CHECK. Оставляем только её.
drop policy if exists messages_update_read on public.messages;

alter policy "Users can view their own notifications"
  on public.notifications
  to authenticated;
alter policy "Users can update their own notifications"
  on public.notifications
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter policy post_images_insert_own on public.post_images to authenticated;
drop policy if exists post_images_delete_own on public.post_images;
drop policy if exists post_images_delete_staff on public.post_images;
create policy post_images_delete_own_or_staff
  on public.post_images
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.posts p
      where p.id = post_images.post_id
        and p.user_id = (select auth.uid())
    )
    or exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role in ('admin', 'moderator')
    )
  );

alter policy post_tags_insert_own on public.post_tags to authenticated;
alter policy post_tags_delete_own on public.post_tags to authenticated;

alter policy posts_insert_own on public.posts to authenticated;
drop policy if exists posts_delete_own on public.posts;
drop policy if exists posts_delete_staff on public.posts;
create policy posts_delete_own_or_staff
  on public.posts
  for delete
  to authenticated
  using (
    (select auth.uid()) = user_id
    or exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role in ('admin', 'moderator')
    )
  );

-- posts_update_own_or_staff уже содержит owner OR staff в USING и WITH CHECK.
-- Удаляем два старых public policies, которые повторяли эти ветви.
drop policy if exists posts_update_own on public.posts;
drop policy if exists posts_update_staff on public.posts;

-- Profile updates: пользователь редактирует себя; только admin может
-- редактировать чужой профиль/роль. Moderator намеренно не добавляется.
alter policy profiles_insert_own on public.profiles to authenticated;
drop policy if exists profiles_update_own on public.profiles;
drop policy if exists profiles_update_role_admin on public.profiles;
create policy profiles_update_own_or_admin
  on public.profiles
  for update
  to authenticated
  using (
    (select auth.uid()) = id
    or exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role = 'admin'
    )
  )
  with check (
    (select auth.uid()) = id
    or exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role = 'admin'
    )
  );

alter policy reports_insert_own on public.reports to authenticated;
alter policy reports_read_staff on public.reports to authenticated;
alter policy reports_update_staff
  on public.reports
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role in ('admin', 'moderator')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role in ('admin', 'moderator')
    )
  );

alter policy stop_words_admin_all
  on public.stop_words
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role = 'admin'
    )
  );

alter policy blocks_delete_own on public.user_blocks to authenticated;
alter policy blocks_insert_own on public.user_blocks to authenticated;
alter policy blocks_read_own on public.user_blocks to authenticated;

-- ------------------------------------------------------------------ --
-- 3. Assertions: не должно остаться дубликатов из исходных наборов   --
-- ------------------------------------------------------------------ --

do $assert$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'books'
      and cmd = 'SELECT'
      and policyname in ('Public can read books', 'books readable')
  ) then
    raise exception 'duplicate books SELECT policies remain';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'messages'
      and cmd = 'UPDATE'
      and policyname = 'messages_update_read'
  ) then
    raise exception 'duplicate messages UPDATE policy remains';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and (
        (tablename = 'comments' and policyname in ('comments_delete_own', 'comments_delete_staff'))
        or (tablename = 'likes' and policyname in ('likes_delete_own', 'likes_delete_staff'))
        or (tablename = 'post_images' and policyname in ('post_images_delete_own', 'post_images_delete_staff'))
        or (tablename = 'posts' and policyname in ('posts_delete_own', 'posts_delete_staff', 'posts_update_own', 'posts_update_staff'))
        or (tablename = 'profiles' and policyname in ('profiles_update_own', 'profiles_update_role_admin'))
      )
  ) then
    raise exception 'legacy overlapping owner/staff policies remain';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'books'
      and policyname = 'books_read_all' and cmd = 'SELECT'
      and 'public' = any(roles)
  ) then
    raise exception 'public books read policy missing';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'posts'
      and policyname = 'posts_update_own_or_staff'
      and cmd = 'UPDATE' and 'authenticated' = any(roles)
      and qual is not null and with_check is not null
  ) then
    raise exception 'combined post update policy missing';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
      and policyname = 'profiles_update_own_or_admin'
      and cmd = 'UPDATE' and 'authenticated' = any(roles)
      and qual is not null and with_check is not null
  ) then
    raise exception 'combined profile update policy missing';
  end if;
end;
$assert$;

commit;
