# 旅行決策 App（PWA）

舊版「東京旅行決策工具」（claude.ai Artifact，第 11 版）的獨立版。
可以裝到手機主畫面，像 App 一樣使用。地圖底圖正常顯示，沒有網路時也打得開。

- 核心規則不變（依 `東京旅遊_2026-11/決策輔助工具/旅行決策輔助工具_概念規格_v1.0.md`）：
  總分 = 期待度合計 + 網路評價（餐飲類）；期待度合計 = 原本期待度 + 追加目標各自的期待度；必去獨立標記、不進總分；交通一律交給 Google Maps。
- 資料格式沿用 `Claude outputs/schema.json`。地點資料庫所有旅程共用；期待度、目標、必去、封存、狀態屬於各旅程，另外存。

## 跟舊版相比

| | 舊版（Artifact 第 11 版） | 這版 |
|---|---|---|
| 地圖底圖 | 線上版被擋，看不到 | 正常顯示，看過的區域離線也看得到 |
| 手機版面 | 桌機版縮小 | 手機優先：下方分頁、底部抽屜、大按鈕 |
| 卡片資訊 | 全部攤開 | 只放名稱、分數、當天公休、距離、導航；其餘點開才看 |
| 營業判斷 | 只認得「24 小時／年中無休」 | 可選日期，依公休欄位判斷「公休／可能公休」，可隱藏當天公休 |
| 期待度 | 下拉選單 | 1–5 大按鈕，一點就存 |
| 我的位置 | 無 | 按 ◎ 取得一次位置（不追蹤），清單可依距離排序 |
| 安裝 | 不行 | 加到主畫面，全螢幕開啟 |
| 圖片 | 無 | 詳情頁頂端顯示代表／外觀圖片（每筆最多 2 張，附作者與授權），看過的 Commons 圖片離線也看得到 |
| 認門口 | 無 | 有座標的地點可一鍵開 Google 街景 |
| 保留的功能 | — | 篩選（地區、類型、標籤、驗證等級、期待度）、必去、封存、銀杏圖標、選取聚焦、臨時參考點、新增、匯出／匯入、編輯欄位 |

## 檔案

```
index.html, manifest.webmanifest, sw.js   App 本體、安裝設定、離線快取
css/app.css                               版面
js/config.js                              ★ 設定（Supabase 網址與金鑰、旅行清單）
js/logic.js                               評分、分類、公休判斷（純邏輯）
js/store.js                               資料層：本機模式／雲端模式
js/app.js                                 畫面與互動
icons/                                    App 圖示（tools/make-icons.ps1 產生）
data/photos.js                            地點圖片清單（只有圖片網址、作者、授權，沒有私人資料）
data/seed.js                              ⚠️ 初始資料（本機模式用，含私人資料，不要上傳）
supabase/01_建立資料表.sql                 建立雲端資料表（執行一次）
supabase/02_匯入資料.sql                   ⚠️ 匯入 82 筆候選（含私人資料，不要上傳）
supabase/03–07_*.sql                      圖片、地區三層、座標、私人圖片空間等更新（都已執行）
supabase/08_旅程分開.sql                   建立旅程與旅程清單，把旅程設定搬出地點資料庫（已執行）
supabase/09_旅程分開_第二段.sql             從地點資料庫移除旅程欄位、整理備註（已執行）
tools/serve.ps1                           本機測試用伺服器
.gitignore                                排除上面兩個 ⚠️ 檔案，不會被提交到 GitHub
```

圖片來源規則（只用 Wikimedia Commons 或店家官網、只記網址、每張都要實際看過）寫在 `Claude outputs/schema.json` 的 `photos` 欄位說明。

## 在電腦上試用（本機模式）

```powershell
powershell -ExecutionPolicy Bypass -File tools\serve.ps1
```

然後用瀏覽器開 <http://localhost:8765/>。本機模式的修改只存在這個瀏覽器。

## 接上雲端：Supabase（一次性設定，約 15 分鐘）

1. 到 <https://supabase.com> 用你自己的帳號註冊並登入，按「New project」。名稱隨意，例如 `trip`，Region 選 **Northeast Asia (Tokyo)**。資料庫密碼請自己保管，App 用不到。
2. 左側 **SQL Editor** → New query → 貼上 `supabase/01_建立資料表.sql` 全部內容 → **Run**。
3. 再開一個 query，貼上 `supabase/02_匯入資料.sql` 全部內容 → **Run**（匯入 81 筆）。
4. 左側 **Authentication → Sign In / Providers**：把 **Allow new users to sign up** 關掉，只有你自己後台建立的帳號能登入。
5. **Authentication → Users → Add user → Create new user**：填你的 email 和一組密碼，勾 **Auto Confirm User**。這組 email 和密碼就是 App 的登入帳密。
6. **Project Settings → API**（或 Data API／API Keys）：複製 **Project URL** 和 **publishable key**（舊介面叫 anon public key）。
   - ⚠️ 不要用 secret key 或 service_role key。
7. 打開 `js/config.js`，填進 `supabaseUrl` 和 `supabaseKey` 存檔。也可以把這兩個值貼給 Claude，請 Claude 幫你填。
8. 重新整理 App，應該會出現登入畫面。登入後頂端顯示「☁️ 已同步」。

⚠️ 切換之前如果你又在舊版工具裡改過資料，請 Claude 重新從舊版雲端資料庫匯出一次 `02_匯入資料.sql`，再執行第 3 步。

## 上線：GitHub Pages（一次性設定）

1. 到 <https://github.com> 用你自己的帳號註冊並登入，按右上「+」→ **New repository**。名稱例如 `trip`，選 **Public**（免費方案的 Pages 需要公開）。
2. 在新的 repository 頁面按 **uploading an existing file**，把下面這些檔案和資料夾**拖進去**：
   - `index.html`、`manifest.webmanifest`、`sw.js`
   - `css/`、`js/`、`icons/` 三個資料夾
   - **不要**上傳 `data/`、`supabase/`、`tools/`、`README.md`。前兩個有你的私人資料；程式庫是公開的，沒登入的人看不到 Supabase 的資料，但看得到你上傳的檔案。
3. 按 **Commit changes**。
4. **Settings → Pages**：Source 選 **Deploy from a branch**，Branch 選 `main`、`/ (root)` → Save。
5. 等 1–2 分鐘，網址會是 `https://你的帳號.github.io/trip/`。
6. 手機用這個網址打開，登入，再加到主畫面：
   - **iPhone**：用 Safari 開 → 分享按鈕 → 加入主畫面
   - **Android**：用 Chrome 開 → 右上 ⋮ → 安裝應用程式

之後改版：在 GitHub 上傳新的檔案覆蓋舊的即可。手機下次打開 App 就是新版，可能需要關掉再開一次。

## 給 Claude（接手的對話）

- 改版：直接改這個資料夾的檔案，用 `tools/serve.ps1` 在本機測試。依交接區規則，要確認地圖底圖有顯示，並用手機寬度（375px）檢查。
- 雲端資料（2026-10-19 起分三個表）：
  - `public.pois`：地點資料庫，所有旅程共用。欄位 `id`、`data`（jsonb，內容依 schema.json）、`version`（每次更新自動 +1）；`trip` 只記錄最早加入的旅程。
  - `public.trips`：旅程，`id`、`name`（例：2026/11 東京）、`dest`、`ym`、`center`、`zoom`。
  - `public.trip_pois`：旅程清單，`trip_id`＋`poi_id`，`data` 只放旅程設定（expectation、goals、must_go、archived、archive_date、archive_reason、status）。
  App 寫入時只合併改了的欄位，並比對 version，避免互相覆蓋。
- 期待度、目標、必去、封存、地區、類型、標籤是使用者的判斷，AI 不代填。
- Claude 直接寫入雲端的方式（REST API＋金鑰怎麼保管）還沒設定，等使用者決定。在那之前，請產出 SQL 或 JSON，由使用者貼上或匯入。
