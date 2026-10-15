-- 2026-10-15 私人圖片空間：放使用者自己提供的圖片（例如宣傳圖、截圖）。不公開，只有登入 App 的人看得到。
insert into storage.buckets (id, name, public) values ('photos', 'photos', false) on conflict (id) do nothing;
drop policy if exists "signed-in users can read photos" on storage.objects;
create policy "signed-in users can read photos" on storage.objects for select to authenticated using (bucket_id = 'photos');
drop policy if exists "signed-in users can upload photos" on storage.objects;
create policy "signed-in users can upload photos" on storage.objects for insert to authenticated with check (bucket_id = 'photos');
select id, public from storage.buckets where id = 'photos';
