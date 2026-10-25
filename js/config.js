/* 設定檔：接上 Supabase 時只需要改這裡。
   supabaseUrl / supabaseKey 留空 = 本機模式（資料存在這支手機／這台電腦的瀏覽器裡）。
   supabaseKey 填 Supabase 後台的「publishable key」（或舊名 anon key），這把是公開用的，
   放在網頁裡沒關係；資料安全靠登入＋資料表的存取規則保護。
   絕對不要填 secret key／service_role key。 */
window.APP_CONFIG = {
  supabaseUrl: "https://jftwkboltjmvxcbvtldi.supabase.co",
  supabaseKey: "sb_publishable_nsVhS7OU5eQ87hkY_t1EyQ_SW9eiU3Q",

  // 旅程：雲端模式從 Supabase 的 trips 資料表讀取（在 App 裡就能新增）；
  // 這裡的清單只在本機模式、或雲端還沒載入時使用。center/zoom 是地圖預設位置。
  trips: [
    { id: "tokyo-2026-11", name: "2026/11 東京", dest: "東京", ym: "2026-11", center: [35.69, 139.75], zoom: 12, start_date: "2026-11-15", end_date: "2026-11-19" },
    { id: "okayama-2027-03", name: "2027/03 岡山", dest: "岡山", ym: "2027-03", center: [34.6661, 133.9185], zoom: 9, start_date: "2027-03-05", end_date: "2027-03-10" }
  ],
  defaultTrip: "tokyo-2026-11"
};
