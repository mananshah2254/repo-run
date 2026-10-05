-- Optional test in a disposable local Supabase database after the migration.
-- Everything rolls back. The two users below are test fixtures.
begin;
insert into auth.users (id, email) values
 ('00000000-0000-4000-8000-000000000001', 'repo-run-one@example.test'),
 ('00000000-0000-4000-8000-000000000002', 'repo-run-two@example.test');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into public.repository_checks(id, user_id, repo_url, report) values
 ('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000001', 'https://github.com/example/one', '{}');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
do $$ begin
  if exists(select 1 from public.repository_checks) then raise exception 'FAIL: cross-account read'; end if;
  update public.repository_checks set report = '{"changed":true}' where id = '00000000-0000-4000-8000-000000000010';
  if found then raise exception 'FAIL: cross-account update'; end if;
  delete from public.repository_checks where id = '00000000-0000-4000-8000-000000000010';
  if found then raise exception 'FAIL: cross-account delete'; end if;
  begin
    insert into public.repository_checks(id, user_id, repo_url, report) values
      ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001', 'https://github.com/example/two', '{}');
    raise exception 'FAIL: cross-account insert';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;
