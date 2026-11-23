-- Enforce distribution consent at the database boundary as well as in the web route.
-- A direct authenticated INSERT into posts must not bypass the separate consent step.

begin;

create or replace function public.enforce_post_distribution_consent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication is required to publish a post'
      using errcode = '28000';
  end if;

  if new.user_id is distinct from v_user_id then
    raise exception 'Нельзя создать публикацию от имени другого пользователя'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
      from private.personal_data_consents as c
     where c.user_id = v_user_id
       and c.scope = 'publication'
       and c.revoked_at is null
  ) then
    raise exception 'Для публикации требуется отдельное согласие на распространение персональных данных'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

comment on function public.enforce_post_distribution_consent() is
  'BEFORE INSERT guard: only the authenticated author with an active publication distribution-consent record can create a post.';

drop trigger if exists posts_require_distribution_consent on public.posts;

create trigger posts_require_distribution_consent
before insert on public.posts
for each row
execute function public.enforce_post_distribution_consent();

-- The function is invoked only by the trigger, not as a client-callable RPC.
revoke all on function public.enforce_post_distribution_consent()
  from public, anon, authenticated, service_role;

commit;
