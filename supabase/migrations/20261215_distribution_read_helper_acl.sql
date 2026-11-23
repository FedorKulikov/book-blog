-- Restore the narrowly scoped EXECUTE grants required by public RLS policies.
-- These two SECURITY DEFINER predicates are called directly by policies on
-- public.profiles and public.posts, so anon/authenticated need EXECUTE on them.
-- Nested private helpers remain closed; PUBLIC and service_role stay revoked.

begin;

revoke all on function private.can_read_distribution_profile(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.can_read_distribution_profile(uuid)
  to anon, authenticated;

revoke all on function private.can_read_distribution_post(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.can_read_distribution_post(uuid)
  to anon, authenticated;

commit;
