-- Normalize legacy hashtag rows and split compound tags without losing post links.
begin;

update public.tags as tag
   set slug = 'фэнтези'
 where tag.name = 'Фэнтези'
   and tag.slug = 'fentezi'
   and not exists (
     select 1 from public.tags canonical where canonical.slug = 'фэнтези'
   );

insert into public.tags (name, slug)
values ('гаррипоттер', 'гаррипоттер')
on conflict do nothing;

do $required_targets$
declare missing_slugs text[];
begin
  select array_agg(required.slug order by required.slug)
    into missing_slugs
    from (values
      ('писатель'), ('писательство'), ('творчество'),
      ('фэнтези'), ('поттериана'), ('гаррипоттер')
    ) as required(slug)
   where not exists (
     select 1 from public.tags target where target.slug = required.slug
   );
  if missing_slugs is not null then
    raise exception 'Cannot split legacy compound tags; missing canonical slugs: %', missing_slugs;
  end if;
end;
$required_targets$;

with mapping (compound_slug, target_slug) as (
  values
    ('писатель-писательство-творчество', 'писатель'),
    ('писатель-писательство-творчество', 'писательство'),
    ('писатель-писательство-творчество', 'творчество'),
    ('писатель-творчество-писательство', 'писатель'),
    ('писатель-творчество-писательство', 'писательство'),
    ('писатель-творчество-писательство', 'творчество'),
    ('фэнтези-поттериана-гаррипоттер', 'фэнтези'),
    ('фэнтези-поттериана-гаррипоттер', 'поттериана'),
    ('фэнтези-поттериана-гаррипоттер', 'гаррипоттер')
)
insert into public.post_tags (post_id, tag_id)
select relation.post_id, target.id
  from mapping
  join public.tags compound on compound.slug = mapping.compound_slug
  join public.post_tags relation on relation.tag_id = compound.id
  join public.tags target on target.slug = mapping.target_slug
on conflict (post_id, tag_id) do nothing;

delete from public.post_tags relation
 using public.tags compound
 where relation.tag_id = compound.id
   and compound.slug in (
     'писатель-писательство-творчество',
     'писатель-творчество-писательство',
     'фэнтези-поттериана-гаррипоттер'
   );

delete from public.tags
 where slug in (
   'писатель-писательство-творчество',
   'писатель-творчество-писательство',
   'фэнтези-поттериана-гаррипоттер'
 );

update public.tags
   set name = regexp_replace(name, '^#+[[:space:]]*', '')
 where name ~ '^#+';

commit;
