-- 2026-10-15 補上 11 筆活動／公園的座標（Chrome 開 Google Maps 查會場位置），並依新位置重算最近車站與區市

update public.pois set data = data || $p${"coord":[35.6736115,139.7558769],"region":"東京都／千代田区／日比谷","region_note":"原區域：跨區（季節活動）｜最近車站 日比谷 267m（第二近 内幸町 430m）｜會場位置：Google Maps「日比谷公園」（2026-10-15）"}$p$::jsonb where id = 'poi_018_7b4e74c1';
update public.pois set data = data || $p${"coord":[35.7618852,139.4417874],"region":"東京都／東村山市／多摩湖","region_note":"原區域：跨區（季節活動）｜最近車站 多摩湖 453m（第二近 武蔵大和 639m）｜會場位置：Google Maps「都立狭山公園（GM 地址：東村山市多摩湖町）」（2026-10-15）"}$p$::jsonb where id = 'poi_019_d475e7c0';
update public.pois set data = data || $p${"coord":[35.6259039,139.2502861],"region":"東京都／八王子市／高尾山","region_note":"原區域：跨區（季節活動）｜最近車站 高尾山 777m（第二近 清滝 1597m）｜會場位置：Google Maps「高尾山薬王院」（2026-10-15）"}$p$::jsonb where id = 'poi_020_f4afaec9';
update public.pois set data = data || $p${"coord":[35.6810403,139.7638027],"region":"東京都／千代田区／東京","region_note":"原區域：跨區（季節活動）｜最近車站 東京 114m（第二近 二重橋前 168m）｜會場位置：Google Maps「丸ビル（丸の内仲通り一帶）」（2026-10-15）"}$p$::jsonb where id = 'poi_021_a30bda95';
update public.pois set data = data || $p${"coord":[35.6727172,139.7205745],"region":"東京都／港区／青山一丁目","region_note":"原區域：跨區（季節活動）｜最近車站 青山一丁目 307m（第二近 外苑前 346m）｜會場位置：Google Maps「明治神宮外苑銀杏林（GM 地址：北青山2-7付近）」（2026-10-15）"}$p$::jsonb where id = 'poi_022_b26556aa';
update public.pois set data = data || $p${"coord":[35.6851763,139.7100517],"region":"東京都／新宿区／新宿御苑前","region_note":"原區域：跨區（季節活動）｜最近車站 新宿御苑前 384m（第二近 千駄ケ谷 462m）｜會場位置：Google Maps「新宿御苑」（2026-10-15）"}$p$::jsonb where id = 'poi_023_cb094532';
update public.pois set data = data || $p${"coord":[35.7056913,139.7492718],"region":"東京都／文京区／後楽園","region_note":"原區域：跨區（季節活動）｜最近車站 後楽園 339m（第二近 飯田橋 493m）｜會場位置：Google Maps「小石川後楽園」（2026-10-15）"}$p$::jsonb where id = 'poi_024_fc3b9fc7';
update public.pois set data = data || $p${"coord":[35.7798056,139.0375259],"region":"東京都／奥多摩町／無臨近車站","region_note":"原區域：跨區（季節活動）｜最近車站 奥多摩 直線 6.3 km，步行超過 30 分→無臨近車站｜會場位置：Google Maps「奥多摩湖」（2026-10-15）"}$p$::jsonb where id = 'poi_026_748bc11c';
update public.pois set data = data || $p${"coord":[35.7147557,139.7734312],"region":"東京都／台東区／上野","region_note":"原區域：跨區（季節活動）｜最近車站 上野 343m（第二近 京成上野 392m）｜會場位置：Google Maps「上野恩賜公園」（2026-10-15）"}$p$::jsonb where id = 'poi_027_f8683dae';
update public.pois set data = data || $p${"coord":[35.6700649,139.6949656],"region":"東京都／渋谷区／代々木公園","region_note":"原區域：跨區（季節活動）｜最近車站 代々木公園 539m（第二近 代々木八幡 548m）｜會場位置：Google Maps「代々木公園」（2026-10-15）"}$p$::jsonb where id = 'poi_028_8961c203';
update public.pois set data = data || $p${"coord":[35.7331005,139.7457335],"region":"東京都／文京区／駒込","region_note":"原區域：跨區（季節活動）｜最近車站 駒込 434m（第二近 千石 578m）｜會場位置：Google Maps「六義園」（2026-10-15）"}$p$::jsonb where id = 'poi_029_8324d312';

select count(*) filter (where jsonb_typeof(data->'coord') = 'array') as 有座標, count(*) filter (where jsonb_typeof(data->'coord') is distinct from 'array') as 沒座標 from public.pois;
