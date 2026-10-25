/* 純邏輯：評分、分類、篩選、當天公休判斷。不碰畫面，方便之後測試與沿用。
   評分規則沿用概念規格 v1.0 與舊版工具第 11 版：
   - 餐飲類：總分 = 期待度 + Google 評分 + Tabelog 評分（有幾個加幾個）
   - 非餐飲類：只看期待度
   - 必去是獨立標記，不進總分 */
(function () {
  "use strict";

  function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
  function esc(s) {
    return (s == null ? "" : String(s)).replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function norm(s) { return (s || "").toLowerCase().replace(/[\s　,，。()（）「」『』【】\-・]/g, ""); }

  /* 是否為餐飲類：2026-10-15 起類型是「大類／細類」，大類「餐廳」才算餐飲。
     舊格式（美食／咖啡／茶…）沿用第 8 版規則：主類型是「購物」一律不算。 */
  function deriveIsFood(category) {
    const segs = (category || "").split("／").map(s => s.replace(/（.*?）|\(.*?\)/g, "").trim()).filter(Boolean);
    if (segs[0] === "餐廳") return true;
    if (!segs.length || segs[0] === "購物" || segs[0] === "風景") return false;
    return segs.some(s => ["美食", "咖啡", "茶", "甜點", "飲品", "茶屋", "茶館", "茶房", "茶寮"].includes(s) || /美食|咖啡|甜點/.test(s));
  }
  function gmTierOf(s) { return s == null ? null : s >= 4.5 ? "good" : s >= 4.0 ? "mid" : "bad"; }
  function tabelogTierOf(s) { return s == null ? null : s >= 3.5 ? "good" : s >= 3.0 ? "mid" : "bad"; }

  function comboScore(item) {
    if (!item.is_food) return null;
    const vals = [];
    if (typeof item.gm_score === "number") vals.push(item.gm_score);
    if (typeof item.tabelog_score === "number") vals.push(item.tabelog_score);
    if (!vals.length) return null;
    return round2(vals.reduce((a, b) => a + b, 0));
  }
  /* 目標與期待度合計（使用者 2026-10-19 決定）：原本的期待度（expectation）不動；
     之後追加的目標可以各自有期待度（goals[].exp），加在原本的上面。
     例：飛木稲荷 欣賞銀杏（原本 4）＋ 蕾絲銀杏御守 3 ＝ 7。沒有分數的目標＝已含在原本期待度裡 */
  function goalList(item) {
    return (Array.isArray(item.goals) ? item.goals : [])
      .map(g => typeof g === "string" ? { name: g } : g)
      .filter(g => g && g.name);
  }
  function expTotal(item) {
    const base = typeof item.expectation === "number" ? item.expectation : null;
    const extra = goalList(item).filter(g => typeof g.exp === "number");
    if (base == null && !extra.length) return null;
    return (base || 0) + extra.reduce((a, g) => a + g.exp, 0);
  }
  function totalScore(item) {
    const combo = comboScore(item);
    const exp = expTotal(item);
    if (combo == null && exp == null) return null;
    return round2((combo || 0) + (exp || 0));
  }

  /* 類型分兩層（使用者 2026-10-15 決定）：類型欄位寫成「大類／細類」，例如「餐廳／拉麵」。
     大類只有三種；細類是篩選第二層。改這裡就會同時改篩選選單與編輯選單。 */
  const GROUPS = [
    { id: "sight", label: "風景", icon: "🌿", subs: ["神社寺院", "自然公園", "街道地標", "季節活動"] },
    { id: "shop", label: "購物", icon: "🛍️", subs: ["百貨商場", "工藝器物", "生活雜貨", "伴手禮", "古董二手", "選物服飾"] },
    { id: "food", label: "餐廳", icon: "🍜", subs: ["拉麵", "正餐", "小吃", "咖啡", "茶飲", "甜點"] }
  ];
  function splitCategory(category) {
    const [main, ...rest] = (category || "").split("／");
    return { main: main.trim(), sub: rest.join("／").trim() };
  }
  function groupOf(item) {
    const { main } = splitCategory(item.category);
    const g = GROUPS.find(x => x.label === main);
    if (g) return g.id;
    // 舊格式的類型（尚未改成兩層的資料）
    const c = item.category || "";
    if (/^購物/.test(c)) return "shop";
    if (/美食|拉麵|餐|咖啡|茶|甜點|飲品/.test(c)) return "food";
    return "sight";
  }
  function subOf(item) { return splitCategory(item.category).sub; }

  const SUB_ICON = {
    "神社寺院": "⛩️", "自然公園": "🌳", "街道地標": "🏮", "季節活動": "🎆",
    "百貨商場": "🏬", "工藝器物": "🏺", "生活雜貨": "🛍️", "伴手禮": "🎁", "古董二手": "📚", "選物服飾": "👕",
    "拉麵": "🍜", "正餐": "🍽️", "小吃": "🍢", "咖啡": "☕", "茶飲": "🍵", "甜點": "🍡"
  };
  const TYPE_ICON = [
    ["神社", "⛩️"], ["寺", "⛩️"], ["購物", "🛍️"], ["咖啡", "☕"], ["茶", "🍵"], ["甜點", "🍡"],
    ["美食", "🍜"], ["活動", "🎏"], ["公園", "🌳"], ["自然", "🌿"], ["景點", "📍"], ["伴手禮", "🎁"]
  ];
  function typeIcon(item) {
    const sub = subOf(item);
    if (SUB_ICON[sub]) return SUB_ICON[sub];
    const g = GROUPS.find(x => x.id === groupOf(item));
    const c = item.category || "";
    for (const [k, v] of TYPE_ICON) if (c.includes(k)) return v;
    return g ? g.icon : "📍";
  }
  function isGinkgo(item) { return (item.tags || []).some(t => String(t).startsWith("銀杏")); }

  /* 地區分三層（使用者 2026-10-15 決定）：「都道府縣／區市／車站」，例如「東京都／台東区／浅草」。
     步行超過 30 分鐘的車站寫「無臨近車站」。舊格式（單一區域名）整串當成車站，放在「其他」底下。 */
  const NO_STATION = "無臨近車站";
  function splitRegion(region) {
    const parts = (region || "").split("／").map(s => s.trim());
    if (parts.length >= 3) return { pref: parts[0], muni: parts[1], station: parts.slice(2).join("／") };
    const base = (region || "").replace(/（.*?）|\(.*?\)/g, "").trim() || "未分類";
    return { pref: "其他", muni: "其他", station: base };
  }
  // 篩選用的鍵：用完整路徑，避免不同縣市有同名的區或車站
  function regionKeys(item) {
    const r = splitRegion(item.region);
    return { pref: r.pref, muni: r.pref + "／" + r.muni, station: r.pref + "／" + r.muni + "／" + r.station, r };
  }
  // 卡片上顯示的短名稱：車站；沒有臨近車站時顯示區市
  function regionLabel(item) {
    const r = splitRegion(item.region);
    return r.station === NO_STATION ? r.muni + "・" + NO_STATION : r.station;
  }

  function verifyLevel(v) {
    if (!v) return "none";
    if (v.includes("✅")) return "ok";
    if (v.includes("🟡")) return "partial";
    return "warn";
  }

  /* ---------- 當天公休判斷 ----------
     公休欄位是自由文字，常有多來源並陳。原則：寧可不判斷，也不要誤判。
     回傳 { level: "closed" | "maybe" | "open" | "gone" | "unknown", text } */
  const WD = "日一二三四五六";
  const WD_JA = "日月火水木金土";
  const UNSURE = /設施|並陳|衝突|不一致|推論|可能|若|待確認|未證實|兩者/;

  function weekdaysIn(text) {
    const set = new Set();
    // 週二～週五 這類範圍
    text.replace(/週([一二三四五六日])\s*[～~至\-–]\s*週?([一二三四五六日])/g, (m, a, b) => {
      let i = WD.indexOf(a); const j = WD.indexOf(b);
      for (let k = 0; k < 7; k++) { set.add(i); if (i === j) break; i = (i + 1) % 7; }
      return "";
    });
    // 週二、週三／週一四日／每週一
    const re = /週((?:[一二三四五六日](?:\s*[、,，與和及]\s*(?:週)?)?)+)/g;
    let m;
    while ((m = re.exec(text))) for (const ch of m[1]) { const i = WD.indexOf(ch); if (i >= 0) set.add(i); }
    // 日文：月曜・火曜
    const reJa = /([日月火水木金土])曜/g;
    while ((m = reJa.exec(text))) set.add(WD_JA.indexOf(m[1]));
    return set;
  }

  function closedOn(item, date) {
    const closed = (item.closed || "").trim();
    const hours = item.hours || "";
    const y = date.getFullYear(), mo = date.getMonth() + 1, d = date.getDate(), wd = date.getDay();

    if (/閉業|歇業|停業|已關店/.test(closed + hours) && !/可能已停業.*活躍|並存/.test(item.notes || "")) {
      return { level: "gone", text: "可能已歇業" };
    }

    // 活動期間：hours 裡有完整日期範圍（含年份）時，判斷這天在不在期間內
    const range = /(\d{4})\/(\d{1,2})\/(\d{1,2})[^\d\/]{0,6}?[–\-～~]\s*(?:(\d{4})\/)?(\d{1,2})\/(\d{1,2})/.exec(hours);
    if (range) {
      const start = new Date(+range[1], +range[2] - 1, +range[3]);
      const end = new Date(+(range[4] || range[1]), +range[5] - 1, +range[6]);
      const day = new Date(y, mo - 1, d);
      if (day < start || day > end) {
        return { level: /活動/.test(item.category || "") ? "closed" : "maybe", text: "不在活動期間" };
      }
    }

    if (!closed || /^(未記錄|—|-|不適用|GM 未標公休)$/.test(closed)) return { level: "unknown", text: "" };

    // 明確寫出的日期：「11/18 休」「11/16（一）休園」「為 11/18」
    const dateRe = /(\d{1,2})\/(\d{1,2})(?:（[一二三四五六日]）)?\s*(休|定休|公休|休園|休館|都不開)|為\s*(\d{1,2})\/(\d{1,2})/g;
    let m;
    while ((m = dateRe.exec(closed))) {
      const mm = +(m[1] || m[4]), dd = +(m[2] || m[5]);
      if (mm === mo && dd === d) return { level: "closed", text: "公休" };
    }

    // 只適用特定月份的規則先拿掉（例如「1月第3個週一～週五」「每年2月第3個週三」）
    let t = closed.replace(/(?:每年)?\d{1,2}月第\s*\d\s*個?\s*週[一二三四五六日](?:\s*[～~]\s*週[一二三四五六日])?[^；;。]*/g, "");

    // 每月第 N 個週X
    const nthRe = /每月第\s*(\d)\s*個?\s*週([一二三四五六日])/g;
    let nthHit = false;
    while ((m = nthRe.exec(t))) {
      if (WD.indexOf(m[2]) === wd && Math.ceil(d / 7) === +m[1]) nthHit = true;
    }
    t = t.replace(nthRe, "");
    // 「（2026/11 為 11/18）」這類補充說明裡的日期已在上面處理，括號裡的年月不要當成週幾
    const unsure = UNSURE.test(closed);
    if (nthHit) return { level: unsure ? "maybe" : "closed", text: unsure ? "可能公休" : "公休" };

    if (weekdaysIn(t).has(wd)) return { level: unsure ? "maybe" : "closed", text: unsure ? "可能公休" : "公休" };

    if (/無公休|年中無休|無休|定休日なし|無休園日|^無$/.test(t)) return { level: "open", text: "" };
    return { level: "unknown", text: "" };
  }

  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }
  function dateLabel(date) {
    return (date.getMonth() + 1) + "/" + date.getDate() + "（" + WD[date.getDay()] + "）";
  }

  /* 兩點距離（公尺）：只用在「我的位置」附近排序，不做路線計算 */
  function distanceM(a, b) {
    const R = 6371000, toR = x => x * Math.PI / 180;
    const dLat = toR(b[0] - a[0]), dLng = toR(b[1] - a[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a[0])) * Math.cos(toR(b[0])) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function fmtDistance(m) { return m < 1000 ? Math.round(m / 10) * 10 + " m" : (m / 1000).toFixed(1) + " km"; }

  function newId() {
    const d = new Date();
    const ymd = d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0");
    return "poi_" + ymd + "_" + Math.random().toString(36).slice(2, 8).padEnd(6, "0");
  }
  function mapsUrl(item) {
    const q = [item.name_clean || item.name, item.address].filter(Boolean).join(" ");
    return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q);
  }
  // 導航：開 Google Maps 路線規劃，起點是手機目前位置；有座標就用座標（最準），沒有就用名稱＋地址
  function navUrl(item) {
    const dest = Array.isArray(item.coord) ? item.coord.join(",") : [item.name_clean || item.name, item.address].filter(Boolean).join(" ");
    return "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(dest);
  }

  /* 交通時間粗估（分鐘），只用直線距離，給提醒「建議幾點出發」用；實際以 Google Maps 為準。
     1.5 km 內當步行（繞路係數 1.3、每分鐘 75 m）；更遠當電車（固定 12 分走到車站＋候車，之後每公里約 2.4 分）。
     東京市區實測：中目黒→代々木公園直線 3.1 km 估 19 分，Google Maps 電車 16 分。 */
  function travelMinutes(from, to) {
    if (!from || !to) return null;
    const d = distanceM(from, to);
    if (d <= 1500) return Math.max(1, Math.ceil(d * 1.3 / 75));
    return Math.round(12 + d / 1000 * 2.4);
  }

  /* 沒有排程時的四個選項 → 對應清單裡的類型 */
  const SUGGEST = [
    { id: "shop", label: "購物", icon: "🛍️", test: it => groupOf(it) === "shop" },
    { id: "meal", label: "用餐", icon: "🍜", test: it => groupOf(it) === "food" && ["正餐", "拉麵", "小吃"].includes(subOf(it)) },
    { id: "snack", label: "點心", icon: "🍰", test: it => groupOf(it) === "food" && ["咖啡", "茶飲", "甜點", "小吃"].includes(subOf(it)) },
    { id: "walk-out", label: "散步・戶外", icon: "🌳", test: it => groupOf(it) === "sight" },
    { id: "walk-in", label: "散步・室內", icon: "🏬", test: it => subOf(it) === "百貨商場" }
  ];

  window.Logic = {
    round2, esc, norm, deriveIsFood, gmTierOf, tabelogTierOf, comboScore, totalScore, goalList, expTotal,
    GROUPS, splitCategory, groupOf, subOf, typeIcon, isGinkgo, verifyLevel,
    NO_STATION, splitRegion, regionKeys, regionLabel,
    closedOn, sameDay, dateLabel, distanceM, fmtDistance, newId, mapsUrl, navUrl, travelMinutes, SUGGEST
  };
})();
