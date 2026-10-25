-- 住宿據點（2026-10-25）：每個旅程可以設定一個住宿，App 會在「行程」分頁最上方置頂顯示，地圖上畫 🏠。
-- base 內容：name、address、coord（[緯度, 經度]）、maps_url、checkin、checkout（HH:MM）
-- 實際的住宿資料屬於私人資訊，不放進公開 repo，另外執行。
alter table public.trips add column if not exists base jsonb;
