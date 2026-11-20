-- 20261135_security_invoker_rpc.sql
--
-- Большинство прежних SECURITY DEFINER RPC не нуждается в обходе RLS:
-- таблицы уже имеют права и политики для authenticated. Переводим их
-- на SECURITY INVOKER, сохраняя EXECUTE только для авторизованной роли.
--
-- check_and_log_action дополнительно получает INSERT policy на action_log:
-- пользователь может записать только собственный user_id. SELECT уже
-- ограничен action_log_read_own.
--
-- increment_*_views остаются SECURITY DEFINER: это публичные счётчики,
-- которым не следует выдавать клиентам UPDATE на таблицы books/posts.
--
-- Идемпотентно.

begin;

drop policy if exists action_log_insert_own on public.action_log;
create policy action_log_insert_own
  on public.action_log
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

alter function public.check_and_log_action(text, integer, integer) security invoker;
alter function public.check_and_log_action(text, integer, integer) set search_path = '';

alter function public.count_unread_messages() security invoker;
alter function public.count_unread_messages() set search_path = '';

alter function public.create_ticket(text, text, text) security invoker;
alter function public.create_ticket(text, text, text) set search_path = '';

alter function public.get_or_create_conversation(uuid) security invoker;
alter function public.get_or_create_conversation(uuid) set search_path = '';

alter function public.is_blocked_by_other(uuid) security invoker;
alter function public.is_blocked_by_other(uuid) set search_path = '';

alter function public.is_blocking(uuid) security invoker;
alter function public.is_blocking(uuid) set search_path = '';

alter function public.is_staff() security invoker;
alter function public.is_staff() set search_path = '';

do $function$
declare
  v_security_definer_count integer;
begin
  select count(*) into v_security_definer_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and p.proname in (
      'check_and_log_action','count_unread_messages','create_ticket',
      'get_or_create_conversation','is_blocked_by_other','is_blocking','is_staff'
    );

  if v_security_definer_count <> 0 then
    raise exception 'authenticated helper RPCs still use SECURITY DEFINER';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public'
      and tablename='action_log'
      and policyname='action_log_insert_own'
      and cmd='INSERT'
      and 'authenticated'=any(roles)
  ) then
    raise exception 'action_log_insert_own policy is missing';
  end if;

  if not has_function_privilege('authenticated','public.check_and_log_action(text,integer,integer)'::regprocedure,'EXECUTE')
     or not has_function_privilege('authenticated','public.count_unread_messages()'::regprocedure,'EXECUTE')
     or not has_function_privilege('authenticated','public.create_ticket(text,text,text)'::regprocedure,'EXECUTE')
     or not has_function_privilege('authenticated','public.get_or_create_conversation(uuid)'::regprocedure,'EXECUTE')
     or not has_function_privilege('authenticated','public.is_blocked_by_other(uuid)'::regprocedure,'EXECUTE')
     or not has_function_privilege('authenticated','public.is_blocking(uuid)'::regprocedure,'EXECUTE')
     or not has_function_privilege('authenticated','public.is_staff()'::regprocedure,'EXECUTE') then
    raise exception 'authenticated lost EXECUTE on an invoker RPC';
  end if;
end;
$function$;

commit;
