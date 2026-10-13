/* 資料層：本機模式／雲端模式（Supabase）共用同一組介面。
   - 本機模式：初始資料來自 data/seed.js，你的修改存在這個瀏覽器（localStorage）。
   - 雲端模式：資料在 Supabase 的 pois 資料表；畫面先用上次的快取，連上後即時同步。
   所有修改都是「欄位層級」：只送出改了的欄位，寫入時比對版本，不會蓋掉別人（或 Claude）同時改的其他欄位。
   網路斷掉時修改先排隊（存在本機），恢復連線後自動補上傳。 */
(function () {
  "use strict";
  const CFG = window.APP_CONFIG || {};
  const LS = {
    get(k, fallback) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 空間不足或被封鎖時略過 */ } }
  };
  const K_LOCAL = "tripapp.local.v1";     // 本機模式：{ overrides: {id: fields}, added: [item] }
  const K_CACHE = "tripapp.cache.v1";     // 雲端模式：上次同步的完整資料
  const K_PENDING = "tripapp.pending.v1"; // 雲端模式：尚未上傳的修改 {id: {fields, isNew, trip}}

  let items = [];
  let listeners = [];
  let status = { mode: "local", state: "ok", text: "" };
  let client = null, user = null, channel = null, flushing = false;

  function emit() { listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); }
  function setStatus(state, text) { status = Object.assign({}, status, { state, text }); emit(); }
  function withDefaults(it) {
    if (!it.trip) it.trip = CFG.defaultTrip;
    if (!Array.isArray(it.tags)) it.tags = [];
    // 圖片：資料本身沒有時，用 data/photos.js 的整理結果（雲端匯入後以雲端為準）
    const ph = window.SEED_PHOTOS && window.SEED_PHOTOS[it.id];
    if (!Array.isArray(it.photos) && ph) it.photos = ph;
    return it;
  }
  function pendingCount() { return Object.keys(LS.get(K_PENDING, {})).length; }

  /* ---------------- 本機模式 ---------------- */
  function loadLocal() {
    const st = LS.get(K_LOCAL, { overrides: {}, added: [] });
    const seed = (window.SEED_POIS || []).map(x => withDefaults(Object.assign({}, x)));
    const all = seed.concat((st.added || []).map(x => withDefaults(Object.assign({}, x))));
    items = all.map(it => Object.assign(it, st.overrides[it.id] || {}));
    status = { mode: "local", state: "ok", text: "💾 本機模式" };
  }
  function saveLocalPatch(id, fields, newItem) {
    const st = LS.get(K_LOCAL, { overrides: {}, added: [] });
    if (newItem) st.added.push(newItem);
    else st.overrides[id] = Object.assign(st.overrides[id] || {}, fields);
    LS.set(K_LOCAL, st);
  }

  /* ---------------- 雲端模式 ---------------- */
  function loadScript(src) {
    return new Promise((ok, fail) => {
      const s = document.createElement("script");
      s.src = src; s.onload = ok; s.onerror = () => fail(new Error("無法載入 " + src));
      document.head.appendChild(s);
    });
  }
  function rowToItem(r) { return withDefaults(Object.assign({}, r.data, { id: r.id, trip: r.trip, _v: r.version })); }
  function applyPendingOnTop(list) {
    const pend = LS.get(K_PENDING, {});
    const byId = new Map(list.map(x => [x.id, x]));
    Object.entries(pend).forEach(([id, p]) => {
      if (byId.has(id)) Object.assign(byId.get(id), p.fields);
      else if (p.isNew) list.push(withDefaults(Object.assign({ id, trip: p.trip }, p.fields)));
    });
    return list;
  }

  async function initCloud() {
    status = { mode: "cloud", state: "loading", text: "⏳ 連線中…" };
    items = applyPendingOnTop((LS.get(K_CACHE, []) || []).map(withDefaults));
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
    const { data, error } = await client.from("pois").select("id,trip,data,version").limit(5000);
    if (error) {
      setStatus(navigator.onLine ? "error" : "offline", navigator.onLine ? "⚠️ 讀取失敗" : "📴 離線（顯示上次資料）");
      console.warn(error); return;
    }
    LS.set(K_CACHE, data.map(rowToItem));
    items = applyPendingOnTop(data.map(rowToItem));
    updateSyncedStatus();
  }
  function updateSyncedStatus() {
    const n = pendingCount();
    setStatus(n ? "pending" : "ok", n ? "⏳ " + n + " 筆待上傳" : "☁️ 已同步");
  }

  function startSync() {
    refresh().then(flush);
    if (channel) client.removeChannel(channel);
    channel = client.channel("pois-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "pois" }, payload => {
        const r = payload.new;
        if (!r || !r.id) return;
        const it = rowToItem(r);
        const pend = LS.get(K_PENDING, {})[r.id];
        if (pend) Object.assign(it, pend.fields);
        const i = items.findIndex(x => x.id === r.id);
        if (i >= 0) items[i] = it; else items.push(it);
        LS.set(K_CACHE, items.map(x => Object.assign({}, x)));
        emit();
      })
      .subscribe();
  }
  function stopSync() { if (channel) { client.removeChannel(channel); channel = null; } }

  /* 把排隊中的修改一筆一筆送上去：讀最新版本 → 合併我改的欄位 → 帶版本號寫回；版本不符就重試 */
  async function flush() {
    if (!client || !user || flushing) return;
    flushing = true;
    try {
      const pend = LS.get(K_PENDING, {});
      for (const id of Object.keys(pend)) {
        const p = pend[id];
        let done = false;
        for (let attempt = 0; attempt < 4 && !done; attempt++) {
          const { data: row, error: e1 } = await client.from("pois").select("data,version").eq("id", id).maybeSingle();
          if (e1) throw e1;
          if (!row) {
            const { error: e2 } = await client.from("pois").insert({ id, trip: p.trip || CFG.defaultTrip, data: Object.assign({ id }, p.fields) });
            if (e2 && e2.code !== "23505") throw e2;   // 23505 = 已存在（別處剛建立），下一輪改用更新
            done = !e2;
            continue;
          }
          const merged = Object.assign({}, row.data, p.fields);
          const { data: upd, error: e3 } = await client.from("pois").update({ data: merged })
            .eq("id", id).eq("version", row.version).select("version");
          if (e3) throw e3;
          done = upd && upd.length > 0;   // 0 筆 = 剛好有人改過，重讀再合併一次
        }
        if (done) {
          const cur = LS.get(K_PENDING, {});
          // 上傳期間若又有新修改，保留新的那部分
          if (cur[id] && JSON.stringify(cur[id].fields) === JSON.stringify(p.fields)) delete cur[id];
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

  /* ---------------- 共用介面 ---------------- */
  const Store = {
    get mode() { return status.mode; },
    get status() { return status; },
    get user() { return user; },
    items() { return items; },
    onChange(fn) { listeners.push(fn); },

    async init() {
      if (CFG.supabaseUrl && CFG.supabaseKey) await initCloud();
      else { loadLocal(); emit(); }
    },

    /* 修改一筆的部分欄位 */
    patch(id, fields) {
      const it = items.find(x => x.id === id);
      if (!it) return;
      Object.assign(it, fields);
      if (status.mode === "local") { saveLocalPatch(id, fields); emit(); return; }
      const pend = LS.get(K_PENDING, {});
      pend[id] = { fields: Object.assign((pend[id] && pend[id].fields) || {}, fields), isNew: pend[id] && pend[id].isNew, trip: it.trip };
      LS.set(K_PENDING, pend);
      updateSyncedStatus();
      flush();
    },

    add(item) {
      withDefaults(item);
      items.unshift(item);
      if (status.mode === "local") { saveLocalPatch(item.id, null, item); emit(); return; }
      const fields = Object.assign({}, item); delete fields._v;
      const pend = LS.get(K_PENDING, {});
      pend[item.id] = { fields, isNew: true, trip: item.trip };
      LS.set(K_PENDING, pend);
      updateSyncedStatus();
      flush();
    },

    async signIn(email, password) {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    async signOut() { if (client) await client.auth.signOut(); },
    refresh() { if (client && user) return refresh().then(flush); }
  };
  window.Store = Store;
})();
