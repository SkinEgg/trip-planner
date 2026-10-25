/* 資料層：本機模式／雲端模式（Supabase）共用同一組介面。
   資料分三種（2026-10-19 起）：
   - 地點資料庫（pois）：查證過的地點資料，所有旅程共用。下次去同一個地方直接沿用。
   - 旅程（trips）：用「年月＋目的地」區分，例如 2026/11 東京。
   - 旅程清單（trip_pois）：某個地點在某次旅程裡的設定——期待度、目標、必去／已預約、封存、狀態。
     這些只屬於那次旅程，不寫進地點資料庫。
   畫面拿到的 items() 是「目前旅程」的清單：地點資料＋這次旅程的設定合在一起。
   修改一樣是「欄位層級」：只送出改了的欄位，寫入時比對版本，不會蓋掉別人（或 Claude）同時改的其他欄位。
   網路斷掉時修改先排隊（存在本機），恢復連線後自動補上傳。 */
(function () {
  "use strict";
  const CFG = window.APP_CONFIG || {};
  const LS = {
    get(k, fallback) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 空間不足或被封鎖時略過 */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { } }
  };
  // 只屬於某次旅程的欄位：存在旅程清單，不進地點資料庫
  const TRIP_FIELDS = ["expectation", "goals", "must_go", "archived", "archive_date", "archive_reason", "status"];
  const isTripField = k => TRIP_FIELDS.includes(k);

  const K_LOCAL = "tripapp.local.v2";     // 本機模式：整份資料 { places, plans, trips }
  const K_CACHE = "tripapp.cache.v2";     // 雲端模式：上次同步的資料 { places, plans, trips }
  const K_PENDING = "tripapp.pending.v2"; // 雲端模式：尚未上傳的修改 { key: op }
  const K_PENDING_OLD = "tripapp.pending.v1";

  let places = new Map();   // id → 地點資料（含 _v 版本）
  let plans = new Map();    // "旅程|地點" → { trip, poi, data, _v }
  let trips = [];           // [{ id, name, dest, ym, center, zoom, start_date, end_date }]
  let sched = new Map();    // 排程草案：id → { id, trip, data, _v }
  let curTrip = CFG.defaultTrip;
  let items = [];           // 目前旅程的清單（合併後）
  let listeners = [];
  let status = { mode: "local", state: "ok", text: "" };
  let client = null, user = null, channel = null, flushing = false;
  const photoCache = new Map();   // 私人圖片的臨時網址（path → { url, exp }）

  const planKey = (trip, poi) => trip + "|" + poi;
  const byYm = (a, b) => (a.ym || "").localeCompare(b.ym || "");
  function emit() { rebuild(); listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); }
  function setStatus(state, text) { status = Object.assign({}, status, { state, text }); emit(); }
  function split(fields) {
    const place = {}, plan = {};
    Object.keys(fields).forEach(k => {
      if (k === "id" || k === "trip" || k === "_v") return;
      (isTripField(k) ? plan : place)[k] = fields[k];
    });
    return { place, plan };
  }
  function withDefaults(it) {
    if (!Array.isArray(it.tags)) it.tags = [];
    // 目標：這個地點這次要去做什麼（可多個；沒提出就空著），格式 [{ name, exp? }]
    it.goals = window.Logic.goalList(it);
    // 圖片：資料本身沒有時，用 data/photos.js 的整理結果
    const ph = window.SEED_PHOTOS && window.SEED_PHOTOS[it.id];
    if (!Array.isArray(it.photos) && ph) it.photos = ph;
    return it;
  }
  // 目前旅程的清單＝地點資料（去掉舊的旅程欄位）＋這次旅程的設定
  function rebuild() {
    const out = [];
    plans.forEach(p => {
      if (p.trip !== curTrip) return;
      const place = places.get(p.poi);
      if (!place) return;
      const o = Object.assign({}, place);
      TRIP_FIELDS.forEach(k => delete o[k]);
      Object.assign(o, p.data, { id: p.poi, trip: p.trip, _v: place._v });
      out.push(withDefaults(o));
    });
    items = out;
  }
  function pendingCount() { return Object.keys(LS.get(K_PENDING, {})).length; }

  /* ---------------- 本機模式（開發測試用） ---------------- */
  function loadLocal() {
    let db = LS.get(K_LOCAL, null);
    if (!db) {
      // 第一次：從 data/seed.js 建立（seed 是舊格式，地點與旅程欄位混在一起）
      db = { places: [], plans: [], sched: [], trips: (CFG.trips || []).map(t => Object.assign({}, t)) };
      (window.SEED_POIS || []).forEach(x => {
        const { place, plan } = split(x);
        db.places.push(Object.assign({ id: x.id }, place));
        db.plans.push({ trip: x.trip || CFG.defaultTrip, poi: x.id, data: plan });
      });
    }
    places = new Map(db.places.map(p => [p.id, p]));
    plans = new Map(db.plans.map(p => [planKey(p.trip, p.poi), p]));
    trips = db.trips || [];
    sched = new Map((db.sched || []).map(s => [s.id, s]));
    status = { mode: "local", state: "ok", text: "💾 本機模式" };
  }
  function saveLocal() {
    LS.set(K_LOCAL, { places: [...places.values()], plans: [...plans.values()], sched: [...sched.values()], trips });
  }

  /* ---------------- 雲端模式 ---------------- */
  function loadScript(src) {
    return new Promise((ok, fail) => {
      const s = document.createElement("script");
      s.src = src; s.onload = ok; s.onerror = () => fail(new Error("無法載入 " + src));
      document.head.appendChild(s);
    });
  }
  const placeFromRow = r => Object.assign({}, r.data, { id: r.id, _v: r.version });
  const planFromRow = r => ({ trip: r.trip_id, poi: r.poi_id, data: r.data || {}, _v: r.version });
  const tripFromRow = r => ({ id: r.id, name: r.name, dest: r.dest, ym: r.ym, center: r.center, zoom: r.zoom, start_date: r.start_date, end_date: r.end_date });
  const schedFromRow = r => ({ id: r.id, trip: r.trip_id, data: r.data || {}, _v: r.version });

  // 排隊中的修改疊在伺服器資料上，畫面才不會「跳回去」
  function applyPending() {
    const pend = LS.get(K_PENDING, {});
    Object.values(pend).forEach(op => {
      if (op.kind === "trip") { if (!trips.some(t => t.id === op.id)) { trips.push(Object.assign({ id: op.id }, op.fields)); trips.sort(byYm); } }
      if (op.kind === "place") {
        const cur = places.get(op.id);
        if (cur) Object.assign(cur, op.fields); else if (op.isNew) places.set(op.id, Object.assign({ id: op.id }, op.fields));
      }
      if (op.kind === "plan") {
        const k = planKey(op.trip, op.poi);
        if (op.del) { plans.delete(k); return; }
        const cur = plans.get(k);
        if (cur) Object.assign(cur.data, op.fields); else if (op.isNew) plans.set(k, { trip: op.trip, poi: op.poi, data: Object.assign({}, op.fields) });
      }
      if (op.kind === "sched") {
        if (op.del) { sched.delete(op.id); return; }
        const cur = sched.get(op.id);
        if (cur) Object.assign(cur.data, op.fields); else if (op.isNew) sched.set(op.id, { id: op.id, trip: op.trip, data: Object.assign({}, op.fields) });
      }
    });
  }
  function saveCache() {
    LS.set(K_CACHE, { places: [...places.values()], plans: [...plans.values()], sched: [...sched.values()], trips });
  }
  function loadCache() {
    const c = LS.get(K_CACHE, null);
    if (!c) return;
    places = new Map((c.places || []).map(p => [p.id, p]));
    plans = new Map((c.plans || []).map(p => [planKey(p.trip, p.poi), p]));
    trips = c.trips || [];
    sched = new Map((c.sched || []).map(s => [s.id, s]));
  }
  // 舊版的待上傳修改（地點與旅程欄位混在一起）轉成新格式
  function migrateOldPending() {
    const old = LS.get(K_PENDING_OLD, null);
    if (!old) return;
    const pend = LS.get(K_PENDING, {});
    Object.entries(old).forEach(([id, p]) => {
      const { place, plan } = split(p.fields || {});
      const trip = p.trip || CFG.defaultTrip;
      if (Object.keys(place).length || p.isNew) pend["p:" + id] = { kind: "place", id, trip, fields: place, isNew: !!p.isNew };
      if (Object.keys(plan).length || p.isNew) pend["t:" + planKey(trip, id)] = { kind: "plan", trip, poi: id, fields: plan, isNew: !!p.isNew };
    });
    LS.set(K_PENDING, pend);
    LS.del(K_PENDING_OLD);
  }

  async function initCloud() {
    status = { mode: "cloud", state: "loading", text: "⏳ 連線中…" };
    migrateOldPending();
    loadCache(); applyPending();
    emit();
    try {
      if (!window.supabase) await loadScript("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.0/dist/umd/supabase.js");
      client = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
        auth: { persistSession: true, autoRefreshToken: true, storageKey: "tripapp.auth" }
      });
    } catch (e) {
      setStatus("offline", items.length ? "📴 離線（顯示上次資料）" : "📴 離線");
      window.addEventListener("online", () => location.reload(), { once: true });
      return;
    }
    const { data } = await client.auth.getSession();
    user = data && data.session ? data.session.user : null;
    client.auth.onAuthStateChange((_evt, session) => {
      const was = !!user; user = session ? session.user : null;
      if (!was && user) startSync();
      if (was && !user) { stopSync(); setStatus("login", "🔒 請登入"); }
    });
    if (user) startSync(); else setStatus("login", "🔒 請登入");
    window.addEventListener("online", () => { if (user) { refresh(); flush(); } });
    setInterval(() => { if (user && pendingCount()) flush(); }, 30000);
  }

  async function refresh() {
    setStatus("loading", "⏳ 同步中…");
    const [rp, rt, rr, rs] = await Promise.all([
      client.from("pois").select("id,data,version").limit(10000),
      client.from("trip_pois").select("trip_id,poi_id,data,version").limit(20000),
      client.from("trips").select("id,name,dest,ym,center,zoom,start_date,end_date").order("ym"),
      client.from("schedule_items").select("id,trip_id,data,version").limit(5000)
    ]);
    const error = rp.error || rt.error || rr.error || rs.error;
    if (error) {
      setStatus(navigator.onLine ? "error" : "offline", navigator.onLine ? "⚠️ 讀取失敗" : "📴 離線（顯示上次資料）");
      console.warn(error); return;
    }
    places = new Map(rp.data.map(r => [r.id, placeFromRow(r)]));
    plans = new Map(rt.data.map(r => { const p = planFromRow(r); return [planKey(p.trip, p.poi), p]; }));
    trips = rr.data.map(tripFromRow);
    sched = new Map(rs.data.map(r => [r.id, schedFromRow(r)]));
    saveCache();
    applyPending();
    updateSyncedStatus();
  }
  function updateSyncedStatus() {
    const n = pendingCount();
    setStatus(n ? "pending" : "ok", n ? "⏳ " + n + " 筆待上傳" : "☁️ 已同步");
  }

  function startSync() {
    refresh().then(flush);
    if (channel) client.removeChannel(channel);
    const pend = () => LS.get(K_PENDING, {});
    channel = client.channel("trip-data")
      .on("postgres_changes", { event: "*", schema: "public", table: "pois" }, payload => {
        const r = payload.new; if (!r || !r.id) return;
        const p = placeFromRow(r);
        const op = pend()["p:" + r.id]; if (op) Object.assign(p, op.fields);
        places.set(r.id, p); saveCache(); emit();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "trip_pois" }, payload => {
        if (payload.eventType === "DELETE") {
          const o = payload.old || {}; if (o.trip_id) { plans.delete(planKey(o.trip_id, o.poi_id)); saveCache(); emit(); }
          return;
        }
        const r = payload.new; if (!r || !r.trip_id) return;
        const p = planFromRow(r);
        const op = pend()["t:" + planKey(p.trip, p.poi)];
        if (op && op.del) return;
        if (op) Object.assign(p.data, op.fields);
        plans.set(planKey(p.trip, p.poi), p); saveCache(); emit();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "trips" }, payload => {
        const r = payload.new; if (!r || !r.id) return;
        const t = tripFromRow(r);
        const i = trips.findIndex(x => x.id === t.id);
        if (i >= 0) trips[i] = t; else trips.push(t);
        trips.sort(byYm);
        saveCache(); emit();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "schedule_items" }, payload => {
        if (payload.eventType === "DELETE") {
          const o = payload.old || {}; if (o.id) { sched.delete(o.id); saveCache(); emit(); }
          return;
        }
        const r = payload.new; if (!r || !r.id) return;
        const s = schedFromRow(r);
        const op = pend()["s:" + r.id];
        if (op && op.del) return;
        if (op) Object.assign(s.data, op.fields);
        sched.set(r.id, s); saveCache(); emit();
      })
      .subscribe();
  }
  function stopSync() { if (channel) { client.removeChannel(channel); channel = null; } }

  /* 把排隊中的修改一筆一筆送上去：讀最新版本 → 合併我改的欄位 → 帶版本號寫回；版本不符就重試。
     順序：旅程 → 地點 → 旅程清單（清單要參照前兩者）→ 刪除 */
  const ORDER = op => op.kind === "trip" ? 0 : op.del ? 3 : op.kind === "plan" ? 2 : 1;
  async function sendOne(op) {
    if (op.kind === "trip") {
      const { error } = await client.from("trips").insert(Object.assign({ id: op.id }, op.fields));
      if (error && error.code !== "23505") throw error;
      return true;
    }
    if (op.del) {
      const q = op.kind === "sched"
        ? client.from("schedule_items").delete().eq("id", op.id)
        : client.from("trip_pois").delete().eq("trip_id", op.trip).eq("poi_id", op.poi);
      const { error } = await q;
      if (error) throw error;
      return true;
    }
    const table = { place: "pois", plan: "trip_pois", sched: "schedule_items" }[op.kind];
    const match = q => op.kind === "plan" ? q.eq("trip_id", op.trip).eq("poi_id", op.poi) : q.eq("id", op.id);
    for (let attempt = 0; attempt < 4; attempt++) {
      const { data: row, error: e1 } = await match(client.from(table).select("data,version")).maybeSingle();
      if (e1) throw e1;
      if (!row) {
        const ins = op.kind === "place" ? { id: op.id, trip: op.trip || curTrip, data: Object.assign({ id: op.id }, op.fields) }
          : op.kind === "sched" ? { id: op.id, trip_id: op.trip, data: op.fields }
          : { trip_id: op.trip, poi_id: op.poi, data: op.fields };
        const { error: e2 } = await client.from(table).insert(ins);
        if (e2 && e2.code !== "23505") throw e2;   // 23505 = 已存在（別處剛建立），下一輪改用更新
        if (!e2) return true;
        continue;
      }
      const merged = Object.assign({}, row.data, op.fields);
      const { data: upd, error: e3 } = await match(client.from(table).update({ data: merged })).eq("version", row.version).select("version");
      if (e3) throw e3;
      if (upd && upd.length > 0) return true;   // 0 筆 = 剛好有人改過，重讀再合併一次
    }
    return false;
  }
  async function flush() {
    if (!client || !user || flushing) return;
    flushing = true;
    try {
      const pend = LS.get(K_PENDING, {});
      const keys = Object.keys(pend).sort((a, b) => ORDER(pend[a]) - ORDER(pend[b]));
      for (const key of keys) {
        const op = pend[key];
        if (await sendOne(op)) {
          const cur = LS.get(K_PENDING, {});
          // 上傳期間若又有新修改，保留新的那部分
          if (cur[key] && JSON.stringify(cur[key]) === JSON.stringify(op)) delete cur[key];
          LS.set(K_PENDING, cur);
        }
      }
      updateSyncedStatus();
    } catch (e) {
      console.warn(e);
      setStatus(navigator.onLine ? "error" : "offline",
        (navigator.onLine ? "⚠️ 上傳失敗，" : "📴 離線，") + pendingCount() + " 筆待上傳");
    } finally { flushing = false; }
  }
  // 加入待上傳佇列（同一筆還沒送出的修改合併成一次）
  function queue(key, op) {
    const pend = LS.get(K_PENDING, {});
    const prev = pend[key];
    if (prev && !op.del && !prev.del) op = Object.assign({}, prev, op, { fields: Object.assign({}, prev.fields, op.fields), isNew: !!(prev.isNew || op.isNew) });
    pend[key] = op;
    LS.set(K_PENDING, pend);
  }
  function commit() {
    if (status.mode === "local") { saveLocal(); emit(); return; }
    saveCache(); updateSyncedStatus(); flush();
  }

  /* ---------------- 共用介面 ---------------- */
  const Store = {
    TRIP_FIELDS,
    get mode() { return status.mode; },
    get status() { return status; },
    get user() { return user; },
    get trip() { return curTrip; },
    items() { return items; },
    trips() { return trips.length ? trips : (CFG.trips || []); },
    onChange(fn) { listeners.push(fn); },

    async init(tripId) {
      if (tripId) curTrip = tripId;
      // 網址加 ?local=1 強制用本機資料（開發測試用；線上版沒有 data/seed.js，所以會是空的）
      const forceLocal = /[?&]local=1\b/.test(location.search);
      if (CFG.supabaseUrl && CFG.supabaseKey && !forceLocal) await initCloud();
      else {
        // 初始資料只在本機模式需要（含私人資料，不在線上版裡）
        if (!window.SEED_POIS) await loadScript("data/seed.js").catch(() => console.warn("沒有 data/seed.js，本機模式從空白開始"));
        loadLocal(); emit();
      }
    },
    setTrip(id) { curTrip = id; emit(); },

    /* 地點資料庫：所有地點，附上它在哪些旅程的清單裡（給「從地點資料庫加入」用） */
    places() {
      const inTrips = new Map();
      plans.forEach(p => { if (!inTrips.has(p.poi)) inTrips.set(p.poi, []); inTrips.get(p.poi).push(p.trip); });
      return [...places.values()].map(p => {
        const o = Object.assign({}, p); TRIP_FIELDS.forEach(k => delete o[k]);
        o.inTrips = inTrips.get(p.id) || [];
        return withDefaults(o);
      });
    },

    /* 修改一筆：地點資料寫進地點資料庫，旅程設定寫進目前旅程的清單 */
    patch(id, fields) {
      if (!items.some(x => x.id === id)) return;
      const { place, plan } = split(fields);
      if (Object.keys(place).length) {
        Object.assign(places.get(id), place);
        if (status.mode !== "local") queue("p:" + id, { kind: "place", id, trip: curTrip, fields: place });
      }
      if (Object.keys(plan).length) {
        Object.assign(plans.get(planKey(curTrip, id)).data, plan);
        if (status.mode !== "local") queue("t:" + planKey(curTrip, id), { kind: "plan", trip: curTrip, poi: id, fields: plan });
      }
      commit();
    },

    /* 新增一個地點（同時加入目前旅程） */
    add(item) {
      const { place, plan } = split(item);
      places.set(item.id, Object.assign({ id: item.id }, place));
      plans.set(planKey(curTrip, item.id), { trip: curTrip, poi: item.id, data: plan });
      if (status.mode !== "local") {
        queue("p:" + item.id, { kind: "place", id: item.id, trip: curTrip, fields: Object.assign({ id: item.id }, place), isNew: true });
        queue("t:" + planKey(curTrip, item.id), { kind: "plan", trip: curTrip, poi: item.id, fields: plan, isNew: true });
      }
      commit();
    },

    /* 把地點資料庫裡已有的地點加進目前旅程（期待度、目標等從空白開始） */
    addToTrip(poiId, fields) {
      if (!places.has(poiId) || plans.has(planKey(curTrip, poiId))) return;
      const data = Object.assign({ goals: [], must_go: false, archived: false }, fields || {});
      plans.set(planKey(curTrip, poiId), { trip: curTrip, poi: poiId, data });
      if (status.mode !== "local") queue("t:" + planKey(curTrip, poiId), { kind: "plan", trip: curTrip, poi: poiId, fields: data, isNew: true });
      commit();
    },

    /* 從目前旅程移除（地點資料保留在資料庫） */
    removeFromTrip(poiId) {
      const k = planKey(curTrip, poiId);
      if (!plans.has(k)) return;
      plans.delete(k);
      if (status.mode !== "local") queue("t:" + k, { kind: "plan", trip: curTrip, poi: poiId, del: true });
      commit();
    },

    /* 排程草案（目前旅程）：每筆 { id, date, start, end, poi_id, title, note, order } */
    schedule() {
      return [...sched.values()].filter(s => s.trip === curTrip).map(s => Object.assign({ id: s.id }, s.data))
        .sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.order || 0) - (b.order || 0) || (a.start || "99").localeCompare(b.start || "99"));
    },
    addSched(data) {
      const id = "sch_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      sched.set(id, { id, trip: curTrip, data: Object.assign({}, data) });
      if (status.mode !== "local") queue("s:" + id, { kind: "sched", id, trip: curTrip, fields: Object.assign({}, data), isNew: true });
      commit();
      return id;
    },
    patchSched(id, fields) {
      const s = sched.get(id); if (!s) return;
      Object.assign(s.data, fields);
      if (status.mode !== "local") queue("s:" + id, { kind: "sched", id, trip: s.trip, fields });
      commit();
    },
    removeSched(id) {
      const s = sched.get(id); if (!s) return;
      sched.delete(id);
      if (status.mode !== "local") queue("s:" + id, { kind: "sched", id, trip: s.trip, del: true });
      commit();
    },

    /* 新增旅程：名稱＝年月＋目的地，例如「2027/03 岡山」 */
    addTrip({ dest, ym, center, zoom }) {
      const name = ym.replace("-", "/") + " " + dest;
      const id = "trip-" + ym + "-" + Math.random().toString(36).slice(2, 7);
      const t = { id, name, dest, ym, center: center || null, zoom: zoom || 11 };
      trips.push(t); trips.sort(byYm);
      if (status.mode !== "local") queue("r:" + id, { kind: "trip", id, fields: { name, dest, ym, center: t.center, zoom: t.zoom }, isNew: true });
      commit();
      return id;
    },

    async signIn(email, password) {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    async signOut() { if (client) await client.auth.signOut(); },
    refresh() { if (client && user) return refresh().then(flush); },

    /* 私人圖片空間（Supabase Storage「photos」，不公開）：取得 6 小時有效的臨時網址，同一張圖重複使用 */
    async photoUrl(path) {
      if (!client || !user || !path) return null;
      const hit = photoCache.get(path);
      if (hit && hit.exp > Date.now()) return hit.url;
      const { data, error } = await client.storage.from("photos").createSignedUrl(path, 6 * 3600);
      if (error || !data) { console.warn(error); return null; }
      photoCache.set(path, { url: data.signedUrl, exp: Date.now() + 5.5 * 3600 * 1000 });
      return data.signedUrl;
    }
  };
  window.Store = Store;
})();
