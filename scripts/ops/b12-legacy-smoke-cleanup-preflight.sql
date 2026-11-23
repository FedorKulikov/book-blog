-- Read-only, fail-closed inventory gate for one-off B12 synthetic smoke cleanup.
-- This file performs no writes. The four auth.users rows must remain in place.
begin read only;

do $preflight$
declare
  a1 constant uuid := '0c9cb092-2125-46e5-938c-f4c20ad4dcb8';
  b1 constant uuid := '1521176b-06b9-4342-87d4-73e523ef41b8';
  a2 constant uuid := '3f92703b-7c9e-474f-a529-b1f4a74a92aa';
  b2 constant uuid := '85226399-163d-45df-b1cb-23d35bc2e17b';
  target_ids uuid[] := array[
    '0c9cb092-2125-46e5-938c-f4c20ad4dcb8'::uuid,
    '1521176b-06b9-4342-87d4-73e523ef41b8'::uuid,
    '3f92703b-7c9e-474f-a529-b1f4a74a92aa'::uuid,
    '85226399-163d-45df-b1cb-23d35bc2e17b'::uuid
  ];
begin
  if (select count(*) from auth.users where id = any(target_ids)) <> 4 then
    raise exception 'cleanup preflight: expected all four exact synthetic auth.users rows';
  end if;

  if exists (
    select 1 from (values
      (a1, 'data-smoke-a-mwt011i9@example.com'),
      (b1, 'data-smoke-b-mwt011i9@example.com'),
      (a2, 'data-smoke-a-mwt0lik5@example.com'),
      (b2, 'data-smoke-b-mwt0lik5@example.com')
    ) expected(id,email)
    left join auth.users u on u.id=expected.id and u.email=expected.email
    where u.id is null
  ) then
    raise exception 'cleanup preflight: synthetic auth identity/email mapping changed';
  end if;

  if exists (
    select 1 from public.profiles p
    where p.id = any(target_ids)
      and (
        p.role <> 'user'
        or p.username is distinct from case p.id
          when a1 then 'data_edit_mwt011i9'
          when b1 then 'data_smoke_b_mwt011i9'
          when a2 then 'data_edit_mwt0lik5'
          when b2 then 'data_smoke_b_mwt0lik5'
        end
      )
  ) then
    raise exception 'cleanup preflight: one of the target profiles does not match the reviewed smoke fixture';
  end if;

  if (select count(*) from public.profiles where id=any(target_ids)) <> 4 then
    raise exception 'cleanup preflight: unexpected profile count';
  end if;

  if exists (
    select 1 from public.posts p
    where p.user_id = any(target_ids)
      and not (
        (p.id='3b8b96ca-b6fc-43a4-ace6-7449009ec1a5'::uuid and p.user_id=a1
          and p.title='Data security smoke edited mwt011i9' and p.type='creative' and p.status='pending' and p.book_id is null)
        or
        (p.id='b39ecf2d-3540-4105-a165-d56b983af488'::uuid and p.user_id=a2
          and p.title='Data security smoke edited mwt0lik5' and p.type='creative' and p.status='pending' and p.book_id is null)
      )
  ) then
    raise exception 'cleanup preflight: unexpected posts are associated with the target accounts';
  end if;

  if exists (
    select 1 from public.posts p
    where p.id in ('3b8b96ca-b6fc-43a4-ace6-7449009ec1a5','b39ecf2d-3540-4105-a165-d56b983af488')
      and not (
        (p.id='3b8b96ca-b6fc-43a4-ace6-7449009ec1a5'::uuid and p.user_id=a1)
        or (p.id='b39ecf2d-3540-4105-a165-d56b983af488'::uuid and p.user_id=a2)
      )
  ) then
    raise exception 'cleanup preflight: target post id is now owned by another user';
  end if;

  if exists (
    select 1 from public.books b
    where b.created_by = any(target_ids)
      and not (
        (b.id='9785055d-c34c-4aa3-978b-8577ae28d3c2'::uuid and b.created_by=a1
          and b.title='Data security smoke edited mwt011i9' and b.author='Temporary test fixture')
        or
        (b.id='e9733b70-6db1-4e1e-84bc-dd3ca0537dd6'::uuid and b.created_by=a2
          and b.title='Data security smoke edited mwt0lik5' and b.author='Temporary test fixture')
      )
  ) then
    raise exception 'cleanup preflight: unexpected books are associated with the target accounts';
  end if;

  if exists (
    select 1 from public.reports r
    where r.reporter_id = any(target_ids)
      and not (
        r.id='43590827-cbfc-400b-bc02-8ade87ad0dc3'::uuid
        and r.reporter_id=a2
        and r.post_id='b39ecf2d-3540-4105-a165-d56b983af488'::uuid
        and r.comment_id is null
        and r.reason='Temporary report fixture mwt0lik5.'
        and r.status='open'
      )
  ) then
    raise exception 'cleanup preflight: unexpected reports are associated with the target accounts';
  end if;

  if exists (
    select 1 from public.reports r
    where r.post_id in ('3b8b96ca-b6fc-43a4-ace6-7449009ec1a5','b39ecf2d-3540-4105-a165-d56b983af488')
      and r.id <> '43590827-cbfc-400b-bc02-8ade87ad0dc3'::uuid
  ) then
    raise exception 'cleanup preflight: a target post has a report outside the reviewed fixture';
  end if;

  if exists (
    select 1 from public.notifications n
    where (n.user_id = any(target_ids) or n.actor_id = any(target_ids))
      and not (
        (n.id='c3a61a9f-8b70-42fe-bf8f-d9585b0f3842'::uuid and n.user_id=b1 and n.actor_id=a1 and n.type='follow')
        or
        (n.id='0149cc8f-dcc6-4dc6-8aea-be5504528e78'::uuid and n.user_id=b2 and n.actor_id=a2 and n.type='follow')
        or
        (n.id='8db40bad-f39e-4bd3-8ab6-dc750a6f7b20'::uuid and n.user_id=a2 and n.actor_id=b2 and n.type='data_smoke')
      )
  ) then
    raise exception 'cleanup preflight: unexpected notifications are associated with the target accounts';
  end if;

  if exists (
    select 1 from public.notifications n
    where n.id in (
      'c3a61a9f-8b70-42fe-bf8f-d9585b0f3842',
      '0149cc8f-dcc6-4dc6-8aea-be5504528e78',
      '8db40bad-f39e-4bd3-8ab6-dc750a6f7b20'
    )
    and not (
      (n.id='c3a61a9f-8b70-42fe-bf8f-d9585b0f3842'::uuid and n.user_id=b1 and n.actor_id=a1 and n.type='follow')
      or (n.id='0149cc8f-dcc6-4dc6-8aea-be5504528e78'::uuid and n.user_id=b2 and n.actor_id=a2 and n.type='follow')
      or (n.id='8db40bad-f39e-4bd3-8ab6-dc750a6f7b20'::uuid and n.user_id=a2 and n.actor_id=b2 and n.type='data_smoke')
    )
  ) then
    raise exception 'cleanup preflight: one of the exact notification ids changed ownership or type';
  end if;

  if (select count(*) from public.posts where user_id=any(target_ids)) <> 2 then
    raise exception 'cleanup preflight: unexpected target post count';
  end if;

  if (select count(*) from public.books where created_by=any(target_ids)) <> 2 then
    raise exception 'cleanup preflight: unexpected target book count';
  end if;

  if (select count(*) from public.reports where reporter_id=any(target_ids)) <> 1 then
    raise exception 'cleanup preflight: unexpected target report count';
  end if;

  if (select count(*) from public.notifications where user_id=any(target_ids) or actor_id=any(target_ids)) <> 3 then
    raise exception 'cleanup preflight: unexpected target notification count';
  end if;

  if exists (select 1 from public.comments where user_id=any(target_ids))
     or exists (select 1 from public.likes where user_id=any(target_ids))
     or exists (select 1 from public.bookmarks where user_id=any(target_ids))
     or exists (select 1 from public.follows where follower_id=any(target_ids) or following_id=any(target_ids))
     or exists (select 1 from public.user_blocks where blocker_id=any(target_ids) or blocked_id=any(target_ids))
     or exists (select 1 from public.action_log where user_id=any(target_ids))
     or exists (select 1 from public.tickets where user_id=any(target_ids))
     or exists (select 1 from public.ticket_messages where sender_id=any(target_ids))
     or exists (select 1 from public.conversations where user1_id=any(target_ids) or user2_id=any(target_ids))
     or exists (select 1 from public.messages where sender_id=any(target_ids))
     or exists (select 1 from public.external_news where created_by=any(target_ids)) then
    raise exception 'cleanup preflight: another app-data category unexpectedly references a target account';
  end if;

  if exists (
    select 1 from public.posts p
    where p.book_id in ('9785055d-c34c-4aa3-978b-8577ae28d3c2','e9733b70-6db1-4e1e-84bc-dd3ca0537dd6')
      and p.user_id <> all(target_ids)
  ) then
    raise exception 'cleanup preflight: a non-target post references one of the target books';
  end if;

  if exists (
    select 1 from public.bookmarks b
    where b.post_id in ('3b8b96ca-b6fc-43a4-ace6-7449009ec1a5','b39ecf2d-3540-4105-a165-d56b983af488')
      and b.user_id <> all(target_ids)
  ) then
    raise exception 'cleanup preflight: a non-target user bookmarked a target post';
  end if;

  if exists (
    select 1 from public.reports r
    where r.post_id in ('3b8b96ca-b6fc-43a4-ace6-7449009ec1a5','b39ecf2d-3540-4105-a165-d56b983af488')
      and r.reporter_id <> all(target_ids)
  ) then
    raise exception 'cleanup preflight: a non-target user reported a target post';
  end if;

  if (select count(*) from private.personal_data_consents where user_id in (a1,a2)) <> 4 then
    raise exception 'cleanup preflight: expected exactly four existing A-user consent audit rows';
  end if;

  if exists (
    select 1 from private.personal_data_consents c
    where c.user_id in (a1,a2)
      and not (
        (c.user_id=a1 and c.scope='profile_public' and c.document_version='1.1')
        or (c.user_id=a1 and c.scope='publication' and c.document_version='1.0')
        or (c.user_id=a2 and c.scope='profile_public' and c.document_version='1.1')
        or (c.user_id=a2 and c.scope='publication' and c.document_version='1.0')
      )
  ) then
    raise exception 'cleanup preflight: unexpected consent scope/version exists for A users';
  end if;

  if exists (
    select 1 from private.personal_data_consents c
    where c.user_id in (a1,a2) and c.scope='profile_public' and c.revoked_at is null
  ) then
    raise exception 'cleanup preflight: profile_public consent is unexpectedly still active';
  end if;

  if exists (select 1 from private.personal_data_consents where user_id in (b1,b2)) then
    raise exception 'cleanup preflight: paired B users unexpectedly have consent records';
  end if;

  if exists (
    select 1 from storage.objects o
    where (
      o.owner_id::text = any(array[a1::text,a2::text])
      or o.name like any(array[a1::text||'/%',a2::text||'/%'])
    )
    and not (
      (o.bucket_id='avatars' and o.name=a1::text||'/storage-smoke-mwt011i9.png' and o.owner_id::text=a1::text)
      or (o.bucket_id='post-images' and o.name=a1::text||'/storage-smoke-mwt011i9.png' and o.owner_id::text=a1::text)
      or (o.bucket_id='chat-media' and o.name=a1::text||'/storage-smoke-mwt011i9.png' and o.owner_id::text=a1::text)
      or (o.bucket_id='avatars' and o.name=a2::text||'/storage-smoke-mwt0lik5.png' and o.owner_id::text=a2::text)
      or (o.bucket_id='post-images' and o.name=a2::text||'/storage-smoke-mwt0lik5.png' and o.owner_id::text=a2::text)
      or (o.bucket_id='chat-media' and o.name=a2::text||'/storage-smoke-mwt0lik5.png' and o.owner_id::text=a2::text)
    )
  ) then
    raise exception 'cleanup preflight: unexpected Storage object is associated with a target account';
  end if;

  if (select count(*) from storage.objects o
      where o.owner_id::text in (a1::text,a2::text)
        or o.name like any(array[a1::text||'/%',a2::text||'/%'])) <> 6 then
    raise exception 'cleanup preflight: more than six target Storage objects exist';
  end if;
end;
$preflight$;

rollback;
