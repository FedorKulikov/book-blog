do $tag_normalization_assertions$
declare v_post_id uuid;
begin
  if exists (select 1 from public.tags where slug in (
    'писатель-писательство-творчество',
    'писатель-творчество-писательство',
    'фэнтези-поттериана-гаррипоттер'
  )) then raise exception 'compound tag rows must be removed'; end if;

  if exists (select 1 from public.tags where name ~ '^#') then
    raise exception 'legacy hashtag markers must be removed from all names';
  end if;

  if not exists (select 1 from public.tags where id='10000000-0000-0000-0000-000000000001' and name='писатель' and slug='писатель') then
    raise exception 'original #писатель row must be renamed without changing identity';
  end if;
  if not exists (select 1 from public.tags where name='Фэнтези' and slug='фэнтези') then
    raise exception 'Фэнтези slug was not normalized';
  end if;
  if not exists (select 1 from public.tags where name='гаррипоттер' and slug='гаррипоттер') then
    raise exception 'missing standalone гаррипоттер tag was not created';
  end if;

  foreach v_post_id in array array[
    '20000000-0000-0000-0000-000000000001'::uuid,
    '20000000-0000-0000-0000-000000000002'::uuid,
    '20000000-0000-0000-0000-000000000003'::uuid
  ] loop
    if (select count(*) from public.post_tags where post_tags.post_id=v_post_id) <> 3 then
      raise exception 'former compound tag did not become exactly 3 links for post %', v_post_id;
    end if;
  end loop;

  if (select count(*) from public.post_tags) <> 10 then
    raise exception 'expected 10 deduplicated post/tag relations';
  end if;
  if not exists (
    select 1 from public.post_tags r join public.tags t on t.id=r.tag_id
    where r.post_id='20000000-0000-0000-0000-000000000001' and t.slug='творчество'
  ) then raise exception 'first compound creativity relation missing'; end if;
  if not exists (
    select 1 from public.post_tags r join public.tags t on t.id=r.tag_id
    where r.post_id='20000000-0000-0000-0000-000000000003' and t.slug='гаррипоттер'
  ) then raise exception 'Harry Potter relation missing'; end if;
  if not exists (
    select 1 from public.post_tags r join public.tags t on t.id=r.tag_id
    where r.post_id='20000000-0000-0000-0000-000000000004' and t.name='чтение'
  ) then raise exception 'unrelated hashtag relation was lost'; end if;
end;
$tag_normalization_assertions$;
