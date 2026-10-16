update public.pois set data = jsonb_set(data, '{photos}', '[{"storage":"poi_20261015_uenoxm_poster.jpg","role":"rep","source":"user","credit":"使用者提供（宣傳示意插畫）","license":"私人空間，僅登入可見","checked":"2026-10-15"}]'::jsonb) where id = 'poi_20261015_uenoxm';
select id, data->'photos'->0->>'storage' as photo from public.pois where id = 'poi_20261015_uenoxm';
