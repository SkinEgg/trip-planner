-- 旅遊工具清單（2026-10-27）：旅遊會用到的 App、網站與說明（例：退稅），所有旅程共用。
-- data 內容：title、category、country、content（內文）、links（[{ label, url }]）、source、source_url、checked、order
create table if not exists public.tools (
  id          text primary key,
  data        jsonb not null default '{}'::jsonb,
  version     integer not null default 1,
  updated_at  timestamptz not null default now()
);

drop trigger if exists tools_bump_version on public.tools;
create trigger tools_bump_version
  before update on public.tools
  for each row execute function public.pois_bump_version();

alter table public.tools enable row level security;
drop policy if exists "signed-in users can read" on public.tools;
create policy "signed-in users can read" on public.tools for select to authenticated using (true);
drop policy if exists "signed-in users can insert" on public.tools;
create policy "signed-in users can insert" on public.tools for insert to authenticated with check (true);
drop policy if exists "signed-in users can update" on public.tools;
create policy "signed-in users can update" on public.tools for update to authenticated using (true) with check (true);
drop policy if exists "signed-in users can delete" on public.tools;
create policy "signed-in users can delete" on public.tools for delete to authenticated using (true);

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tools') then
    alter publication supabase_realtime add table public.tools;
  end if;
end $$;
alter table public.tools replica identity full;
