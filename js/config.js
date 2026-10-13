/* 設定檔：接上 Supabase 時只需要改這裡。
   supabaseUrl / supabaseKey 留空 = 本機模式（資料存在這支手機／這台電腦的瀏覽器裡）。
   supabaseKey 填 Supabase 後台的「publishable key」（或舊名 anon key），這把是公開用的，
   放在網頁裡沒關係；資料安全靠登入＋資料表的存取規則保護。
   絕對不要填 secret key／service_role key。 */
window.APP_CONFIG = {
  supabaseUrl: "",
  supabaseKey: "",

  // 旅行清單：之後岡山等新旅行加在這裡。center/zoom 是地圖預設位置。
  trips: [
    { id: "tokyo-2026-11", name: "東京 2026/11", center: [35.69, 139.75], zoom: 12 }
  ],
  defaultTrip: "tokyo-2026-11"
};
