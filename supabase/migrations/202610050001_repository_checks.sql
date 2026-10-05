-- Run in the new Supabase project's SQL editor. No service-role key is needed in the app.
begin;
create table if not exists public.repository_checks (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  repo_url text not null check (length(repo_url) <= 1000),
  checked_at timestamptz not null default now(),
  report jsonb not null check (jsonb_typeof(report) = 'object' and octet_length(report::text) <= 200000)
);
create index if not exists repository_checks_user_date on public.repository_checks(user_id, checked_at desc);
alter table public.repository_checks enable row level security;
revoke all on public.repository_checks from anon;
grant select, insert, update, delete on public.repository_checks to authenticated;
drop policy if exists "Read own checks" on public.repository_checks;
create policy "Read own checks" on public.repository_checks for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Create own checks" on public.repository_checks;
create policy "Create own checks" on public.repository_checks for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Update own checks" on public.repository_checks;
create policy "Update own checks" on public.repository_checks for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Delete own checks" on public.repository_checks;
create policy "Delete own checks" on public.repository_checks for delete to authenticated using ((select auth.uid()) = user_id);

-- Keep at most 100 checks per account to bound storage. This runs with the caller's
-- permissions, so the same RLS rules apply to retention as to ordinary deletes.
create or replace function public.retain_recent_repository_checks()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtext(new.user_id::text));
  delete from public.repository_checks where user_id = new.user_id and id in (
    select id from public.repository_checks where user_id = new.user_id
    order by checked_at desc, id desc offset 100
  );
  return new;
end;
$$;
drop trigger if exists repository_checks_retention on public.repository_checks;
create trigger repository_checks_retention after insert on public.repository_checks
for each row execute function public.retain_recent_repository_checks();
commit;
