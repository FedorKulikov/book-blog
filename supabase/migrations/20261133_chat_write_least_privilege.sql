-- 20261133_chat_write_least_privilege.sql
--
-- Сужаем UPDATE переписки до действий, которые реально использует клиент:
--   messages      -> только read_at (получатель отмечает входящее сообщение);
--   conversations -> только mute-флаги, причём участник меняет только свой.
--
-- До этого RLS проверял только участие в беседе. Из-за этого участник мог
-- обновить text/image/audio чужого сообщения или поменять user1_id/user2_id,
-- сохранив себя участником и потенциально передав историю другому аккаунту.
--
-- Клиентские вызовы проверены:
--   app/messages/[id]/page.tsx     -> UPDATE messages.read_at
--   app/components/ChatMuteButton.tsx -> UPDATE собственного muted_by_user*
--
-- Серверные триггеры update_conversation_last_message остаются SECURITY DEFINER
-- и продолжают обновлять last_message_at при INSERT сообщения.
-- Service role и postgres сохраняют административные UPDATE-права.
--
-- Идемпотентно.

begin;

-- Не даём клиенту редактировать текст/вложения, автора или принадлежность
-- сообщения к беседе. Для обычного интерфейса нужен только read_at.
revoke update on table public.messages from public, anon, authenticated;
grant update (read_at) on table public.messages to authenticated;

-- Участник может менять только mute-настройки; состав беседы и timestamps
-- не должны быть изменяемы через клиентский Data API.
revoke update on table public.conversations from public, anon, authenticated;
grant update (muted_by_user1, muted_by_user2)
  on table public.conversations to authenticated;

-- Дополнительная защита на уровне строки:
-- даже при случайном расширении GRANT участник не может менять mute второго
-- пользователя или менять идентификаторы участников.
create or replace function public.protect_conversation_fields()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
begin
  -- Доверенные backend/DB операции не должны зависеть от пользовательского JWT.
  if current_user in ('postgres', 'service_role') then
    return new;
  end if;

  if new.user1_id is distinct from old.user1_id
     or new.user2_id is distinct from old.user2_id then
    raise exception 'нельзя менять участников беседы';
  end if;

  if v_uid = old.user1_id then
    if new.muted_by_user2 is distinct from old.muted_by_user2 then
      raise exception 'нельзя менять настройки собеседника';
    end if;
  elsif v_uid = old.user2_id then
    if new.muted_by_user1 is distinct from old.muted_by_user1 then
      raise exception 'нельзя менять настройки собеседника';
    end if;
  else
    raise exception 'только участники беседы могут менять настройки';
  end if;

  return new;
end;
$function$;

drop trigger if exists conversations_protect_fields on public.conversations;
create trigger conversations_protect_fields
  before update of user1_id, user2_id, muted_by_user1, muted_by_user2
  on public.conversations
  for each row execute function public.protect_conversation_fields();

-- read_at может выставить только получатель входящего сообщения и только
-- один раз. RLS продолжает дополнительно проверять участие в беседе.
create or replace function public.protect_message_read_at()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if current_user in ('postgres', 'service_role') then
    return new;
  end if;

  if v_uid is null or v_uid = old.sender_id then
    raise exception 'только получатель может отметить сообщение прочитанным';
  end if;

  if new.read_at is null then
    raise exception 'нельзя сбрасывать отметку прочтения';
  end if;

  if old.read_at is not null and new.read_at is distinct from old.read_at then
    raise exception 'нельзя менять установленную отметку прочтения';
  end if;

  return new;
end;
$function$;

drop trigger if exists messages_protect_read_at on public.messages;
create trigger messages_protect_read_at
  before update of read_at on public.messages
  for each row execute function public.protect_message_read_at();

-- Убираем последнее предупреждение search_path у триггера целостности.
-- Все используемые объекты квалифицированы схемой.
create or replace function public.protect_message_fields()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if current_user in ('postgres', 'service_role') then
    return new;
  end if;

  if not public.is_staff() then
    if new.sender_id is distinct from old.sender_id then
      raise exception 'нельзя менять автора сообщения';
    end if;

    if new.conversation_id is distinct from old.conversation_id then
      raise exception 'нельзя переносить сообщение в другую беседу';
    end if;

    if new.created_at is distinct from old.created_at then
      raise exception 'нельзя менять дату создания сообщения';
    end if;
  end if;

  return new;
end;
$function$;

-- Проверка least-privilege в той же транзакции: ошибка откатит миграцию.
do $function$
begin
  if has_column_privilege('anon', 'public.messages', 'read_at', 'UPDATE')
     or has_column_privilege('anon', 'public.messages', 'text', 'UPDATE')
     or has_column_privilege('anon', 'public.conversations', 'muted_by_user1', 'UPDATE') then
    raise exception 'anon still has UPDATE privileges on chat tables';
  end if;

  if not has_column_privilege('authenticated', 'public.messages', 'read_at', 'UPDATE') then
    raise exception 'authenticated must retain UPDATE on messages.read_at';
  end if;

  if has_column_privilege('authenticated', 'public.messages', 'text', 'UPDATE')
     or has_column_privilege('authenticated', 'public.messages', 'image_url', 'UPDATE')
     or has_column_privilege('authenticated', 'public.messages', 'audio_url', 'UPDATE')
     or has_column_privilege('authenticated', 'public.messages', 'audio_duration', 'UPDATE')
     or has_column_privilege('authenticated', 'public.messages', 'sender_id', 'UPDATE')
     or has_column_privilege('authenticated', 'public.messages', 'conversation_id', 'UPDATE')
     or has_column_privilege('authenticated', 'public.messages', 'created_at', 'UPDATE') then
    raise exception 'authenticated has excess UPDATE privileges on messages';
  end if;

  if not has_column_privilege('authenticated', 'public.conversations', 'muted_by_user1', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.conversations', 'muted_by_user2', 'UPDATE') then
    raise exception 'authenticated must retain UPDATE on conversation mute flags';
  end if;

  if has_column_privilege('authenticated', 'public.conversations', 'user1_id', 'UPDATE')
     or has_column_privilege('authenticated', 'public.conversations', 'user2_id', 'UPDATE')
     or has_column_privilege('authenticated', 'public.conversations', 'last_message_at', 'UPDATE')
     or has_column_privilege('authenticated', 'public.conversations', 'created_at', 'UPDATE') then
    raise exception 'authenticated has excess UPDATE privileges on conversations';
  end if;
end;
$function$;

commit;
