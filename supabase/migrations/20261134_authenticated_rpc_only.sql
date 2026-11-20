-- 20261134_authenticated_rpc_only.sql
--
-- Ограничиваем SECURITY DEFINER RPC, которые требуют пользовательскую
-- сессию. До миграции anon имел прямой EXECUTE, несмотря на проверки
-- auth.uid() внутри функций.
--
-- Публичные счётчики просмотров книг и постов остаются доступны гостям:
-- ViewCounterBook.tsx и ViewCounter.tsx вызывают их на публичных страницах.
--
-- ChatUserPanel больше не вызывает is_blocking для анонимного посетителя.
-- Остальные RPC ниже используются только после входа или в RLS/триггерах.
--
-- Идемпотентно.

begin;

revoke execute on function public.check_and_log_action(text, integer, integer) from anon;
revoke execute on function public.count_unread_messages() from anon;
revoke execute on function public.create_ticket(text, text, text) from anon;
revoke execute on function public.get_or_create_conversation(uuid) from anon;
revoke execute on function public.is_blocked_by_other(uuid) from anon;
revoke execute on function public.is_blocking(uuid) from anon;
revoke execute on function public.is_staff() from anon;

do $function$
begin
  if has_function_privilege('anon', 'public.check_and_log_action(text,integer,integer)'::regprocedure, 'EXECUTE')
     or has_function_privilege('anon', 'public.count_unread_messages()'::regprocedure, 'EXECUTE')
     or has_function_privilege('anon', 'public.create_ticket(text,text,text)'::regprocedure, 'EXECUTE')
     or has_function_privilege('anon', 'public.get_or_create_conversation(uuid)'::regprocedure, 'EXECUTE')
     or has_function_privilege('anon', 'public.is_blocked_by_other(uuid)'::regprocedure, 'EXECUTE')
     or has_function_privilege('anon', 'public.is_blocking(uuid)'::regprocedure, 'EXECUTE')
     or has_function_privilege('anon', 'public.is_staff()'::regprocedure, 'EXECUTE') then
    raise exception 'anon still has EXECUTE on authenticated-only RPCs';
  end if;

  if not has_function_privilege('authenticated', 'public.check_and_log_action(text,integer,integer)'::regprocedure, 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.count_unread_messages()'::regprocedure, 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.create_ticket(text,text,text)'::regprocedure, 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.get_or_create_conversation(uuid)'::regprocedure, 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.is_blocked_by_other(uuid)'::regprocedure, 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.is_blocking(uuid)'::regprocedure, 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.is_staff()'::regprocedure, 'EXECUTE') then
    raise exception 'authenticated lost EXECUTE on a required RPC';
  end if;

  if not has_function_privilege('anon', 'public.increment_book_views(uuid)'::regprocedure, 'EXECUTE')
     or not has_function_privilege('anon', 'public.increment_post_views(uuid)'::regprocedure, 'EXECUTE') then
    raise exception 'public view counters must remain callable by anon';
  end if;
end;
$function$;

commit;
