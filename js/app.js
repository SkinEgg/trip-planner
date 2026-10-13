/* 畫面與互動。資料存取一律透過 Store，計算一律透過 Logic。 */
(function () {
  "use strict";
  const CFG = window.APP_CONFIG;
  const L_ = window.Logic;
  const { esc } = L_;
  const $ = s => document.querySelector(s);
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
  };
  const APP_VERSION = "1.0.0";

  const GINKGO_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21.5V13" stroke="#8a6508" stroke-width="1.8" stroke-linecap="round"/><path d="M12 13.5C7 13.5 2.6 10 2.6 5.8 5.2 3.3 8.6 2.7 11.2 3.6L12 7.4l.8-3.8c2.6-.9 6-.3 8.6 2.2 0 4.2-4.4 7.7-9.4 7.7Z" fill="#f2c230" stroke="#b8860b" stroke-width="1"/><path d="M12 13V8.2M12 13 8 6.5M12 13l4-6.5" stroke="#d49a12" stroke-width=".7" fill="none"/></svg>';

  /* ---------------- 狀態 ---------------- */
  const saved = LS.get("tripapp.ui.v1", {});
  const state = {
    tab: saved.tab || "map",
    trip: saved.trip || CFG.defaultTrip,
    date: new Date(),
    sort: saved.sort || "rec",
    q: "",
    sel: null,          // 地圖上選取中的地點
    detail: null,       // 詳情開啟中的地點
    me: null,           // 我的位置 [lat, lng]
    f: Object.assign({ must: false, groups: [], regions: [], cats: [], tags: [], verify: "", minExp: "", hideClosed: false, showArchived: false }, saved.f || {})
  };
  if (!CFG.trips.some(t => t.id === state.trip)) state.trip = CFG.defaultTrip;
  function persistUi() { LS.set("tripapp.ui.v1", { tab: state.tab, trip: state.trip, sort: state.sort, f: state.f }); }
  function tripCfg() { return CFG.trips.find(t => t.id === state.trip) || CFG.trips[0]; }

  /* ---------------- 共用小工具 ---------------- */
  let toastTimer = null;
  function toast(msg) {
    const el = $("#toast"); el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }
  function today() { return new Date(); }
  function dayWord() { return L_.sameDay(state.date, today()) ? "今天" : (state.date.getMonth() + 1) + "/" + state.date.getDate(); }
  function nameOf(it) { return it.name_clean || it.name || "（未命名）"; }
  function iconHtml(it) { return L_.isGinkgo(it) ? GINKGO_SVG : L_.typeIcon(it); }
  function getItem(id) { return window.Store.items().find(x => x.id === id); }
  function tripItems() { return window.Store.items().filter(x => x.trip === state.trip); }

  function closedInfo(it) {
    const c = L_.closedOn(it, state.date);
    if (c.level === "closed") return { cls: "b-closed", text: c.text === "公休" ? dayWord() + "公休" : c.text, dim: true };
    if (c.level === "gone") return { cls: "b-closed", text: "⚠️ " + c.text, dim: true };
    if (c.level === "maybe") return { cls: "b-maybe", text: c.text === "可能公休" ? dayWord() + "可能公休" : c.text, dim: false };
    return null;
  }

  function passes(it) {
    const f = state.f;
    if (!f.showArchived && it.archived) return false;
    if (f.must && !it.must_go) return false;
    if (f.groups.length && !f.groups.includes(L_.groupOf(it))) return false;
    if (f.regions.length && !f.regions.includes(L_.regionGroup(it.region))) return false;
    if (f.cats.length && !f.cats.includes(it.category)) return false;
    if (f.tags.length && !(it.tags || []).some(t => f.tags.includes(t))) return false;
    if (f.verify && L_.verifyLevel(it.verify) !== f.verify) return false;
    if (f.minExp && !(typeof it.expectation === "number" && it.expectation >= +f.minExp)) return false;
    if (f.hideClosed) { const c = L_.closedOn(it, state.date).level; if (c === "closed" || c === "gone") return false; }
    if (state.q) {
      const hay = L_.norm([it.name, it.name_clean, it.region, it.category, it.address, it.notes, (it.tags || []).join(" ")].join(" "));
      if (!hay.includes(L_.norm(state.q))) return false;
    }
    return true;
  }
  function filtered() { return tripItems().filter(passes); }
  function activeFilterCount() {
    const f = state.f;
    return f.regions.length + f.cats.length + f.tags.length + (f.verify ? 1 : 0) + (f.minExp ? 1 : 0) + (f.hideClosed ? 1 : 0) + (f.showArchived ? 1 : 0);
  }

  /* 分數顯示：餐飲＝總分（顏色依目前篩選結果中的相對排名，前／中／後三分之一）；非餐飲＝期待度 */
  function rankMap(list) {
    const food = list.filter(d => d.is_food && L_.totalScore(d) != null)
      .map(d => ({ id: d.id, s: L_.totalScore(d) })).sort((a, b) => b.s - a.s);
    const n = food.length, m = {};
    food.forEach((d, i) => { m[d.id] = n <= 2 ? (i === 0 ? "good" : "low") : i < n / 3 ? "good" : i < 2 * n / 3 ? "mid" : "low"; });
    return m;
  }
  function scoreInfo(it, ranks) {
    if (it.is_food) {
      const t = L_.totalScore(it);
      return { num: t == null ? "—" : (Math.round(t * 10) / 10), label: "總分", tier: t == null ? "low" : (ranks[it.id] || "low") };
    }
    const e = it.expectation;
    return { num: e == null ? "—" : e, label: "期待", tier: e >= 4 ? "good" : e === 3 ? "mid" : "low" };
  }
  function recCompare(a, b) {
    if (!!b.must_go !== !!a.must_go) return b.must_go ? 1 : -1;
    const ea = a.expectation == null ? -1 : a.expectation, eb = b.expectation == null ? -1 : b.expectation;
    if (eb !== ea) return eb - ea;
    const ca = L_.comboScore(a), cb = L_.comboScore(b);
    if ((cb == null ? -1 : cb) !== (ca == null ? -1 : ca)) return (cb == null ? -1 : cb) - (ca == null ? -1 : ca);
    return nameOf(a).localeCompare(nameOf(b), "ja");
  }
  function distOf(it) { return state.me && it.coord ? L_.distanceM(state.me, it.coord) : null; }

  /* ---------------- 頂部 ---------------- */
  function renderTop() {
    $("#tripTitle").textContent = tripCfg().name;
    $("#dateLabel").textContent = L_.sameDay(state.date, today()) ? "今天 " + L_.dateLabel(state.date) : L_.dateLabel(state.date);
    $("#dateBtn").classList.toggle("not-today", !L_.sameDay(state.date, today()));
    $("#syncPill").textContent = window.Store.status.text || "";
    const groupsPresent = new Set(tripItems().map(L_.groupOf));
    const n = activeFilterCount();
    $("#quickRow").innerHTML =
      `<button class="chip must ${state.f.must ? "on" : ""}" data-q="must">⭐ 必去</button>` +
      L_.GROUPS.filter(g => groupsPresent.has(g.id) && g.id !== "other").map(g =>
        `<button class="chip ${state.f.groups.includes(g.id) ? "on" : ""}" data-q="g:${g.id}">${g.icon} ${g.label}</button>`).join("") +
      `<button class="chip filter-btn" data-q="filter">⚙️ 篩選${n ? `<span class="dot">${n}</span>` : ""}</button>`;
  }
  $("#quickRow").addEventListener("click", e => {
    const b = e.target.closest("[data-q]"); if (!b) return;
    const q = b.dataset.q;
    if (q === "must") state.f.must = !state.f.must;
    else if (q === "filter") { openFilter(); return; }
    else if (q.startsWith("g:")) toggleIn(state.f.groups, q.slice(2));
    changed();
  });
  function toggleIn(arr, v) { const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v); }

  $("#dateBtn").addEventListener("click", () => {
    const inp = $("#dateInput");
    const d = state.date;
    inp.value = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    try { inp.showPicker(); } catch (e) { inp.focus(); inp.click(); }
  });
  $("#dateInput").addEventListener("change", e => {
    const v = e.target.value;
    if (!v) { state.date = today(); } else { const [y, m, d] = v.split("-").map(Number); state.date = new Date(y, m - 1, d); }
    changed();
    toast("查看 " + L_.dateLabel(state.date) + " 的公休狀態");
  });

  /* ---------------- 清單 ---------------- */
  function cardHtml(it, ranks, withGo) {
    const s = scoreInfo(it, ranks);
    const c = closedInfo(it);
    const d = distOf(it);
    const subs = [esc(L_.regionGroup(it.region))];
    if (c) subs.push(`<span class="badge ${c.cls}">${esc(c.text)}</span>`);
    if (d != null) subs.push("📍 " + L_.fmtDistance(d));
    if (it.archived) subs.push(`<span class="badge b-arch">封存</span>`);
    return `<div class="card ${c && c.dim ? "dim" : ""}" data-id="${esc(it.id)}">
      <div class="card-icon">${iconHtml(it)}</div>
      <div class="card-main">
        <div class="card-name">${it.must_go ? '<span class="star">★</span>' : ""}${esc(nameOf(it))}</div>
        <div class="card-sub">${subs.join("")}</div>
      </div>
      <div class="score t-${s.tier}">${s.num}<small>${s.label}</small></div>
      ${withGo ? `<a class="go-btn" href="${esc(it.maps_url || L_.mapsUrl(it))}" target="_blank" rel="noopener" title="在 Google Maps 開啟" data-go>🧭</a>` : ""}
    </div>`;
  }

  function renderList() {
    let list = filtered();
    const ranks = rankMap(list);
    let sort = state.sort;
    if (sort === "dist" && !state.me) sort = "rec";
    if (sort === "dist") list.sort((a, b) => (distOf(a) ?? 1e12) - (distOf(b) ?? 1e12));
    else list.sort(recCompare);

    const total = tripItems().filter(x => !x.archived).length;
    $("#listCount").textContent = `${list.length} 筆${list.length !== total ? `（共 ${total} 筆）` : ""}` +
      (sort === "rec" ? " · 必去優先，再依期待度、網路評價" : sort === "dist" ? " · 依距離" : "");

    if (!list.length) { $("#list").innerHTML = `<div class="empty">目前的條件下沒有符合的地點。<br>試著放寬篩選或清除搜尋。</div>`; return; }
    if (sort === "region") {
      const groups = new Map();
      list.forEach(it => { const g = L_.regionGroup(it.region); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(it); });
      const names = [...groups.keys()].sort((a, b) => a.localeCompare(b, "zh-Hant"));
      $("#list").innerHTML = names.map(g => `<div class="group-head">${esc(g)}（${groups.get(g).length}）</div>` +
        groups.get(g).map(it => cardHtml(it, ranks, true)).join("")).join("");
    } else {
      $("#list").innerHTML = list.map(it => cardHtml(it, ranks, true)).join("");
    }
  }
  $("#list").addEventListener("click", e => {
    if (e.target.closest("[data-go]")) return;   // 導航按鈕直接開 Google Maps
    const c = e.target.closest(".card"); if (c) openDetail(c.dataset.id);
  });
  $("#searchInput").addEventListener("input", e => { state.q = e.target.value.trim(); renderList(); });
  $("#sortSel").addEventListener("change", e => {
    state.sort = e.target.value;
    if (state.sort === "dist" && !state.me) { toast("先在地圖頁按 ◎ 取得目前位置"); }
    persistUi(); renderList();
  });

  /* ---------------- 地圖 ---------------- */
  let map = null, markerLayer = null, meLayer = null, refMarker = null, refPopup = null, fitted = false;
  function ensureMap() {
    if (map) return;
    const t = tripCfg();
    // 關掉圖磚淡入：瀏覽器在背景或省電時可能暫停動畫，圖磚會卡在半透明看不到
    map = L.map("map", { zoomControl: false, fadeAnimation: false }).setView(t.center, t.zoom);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);
    markerLayer = L.layerGroup().addTo(map);
    meLayer = L.layerGroup().addTo(map);
    map.on("click", e => { if (state.sel) clearSel(); else placeRefPin(e.latlng); });
  }
  function pinHtml(it, ranks) {
    const sel = it.id === state.sel ? " sel" : "";
    const c = closedInfo(it);
    const dim = c && c.dim ? " dim" : "";
    const must = it.must_go ? '<span class="must">★</span>' : "";
    if (it.is_food) {
      const s = scoreInfo(it, ranks);
      const color = s.tier === "good" ? "#2f8f55" : s.tier === "mid" ? "#c08a1e" : "#8a8072";
      return `<div class="pin${sel}${dim}" style="background:${color}">${s.num === "—" ? "?" : Math.round(s.num)}${must}</div>`;
    }
    if (L_.isGinkgo(it)) return `<div class="pin ginkgo${sel}${dim}">${GINKGO_SVG}${must}</div>`;
    const e = it.expectation;
    const bg = e >= 4 ? "#2f8f55" : e === 3 ? "#c08a1e" : "#8a8072";
    return `<div class="pin sq${sel}${dim}" style="background:${bg}">${L_.typeIcon(it)}${must}</div>`;
  }
  function renderMap() {
    ensureMap();
    markerLayer.clearLayers();
    const list = filtered();
    const ranks = rankMap(list);
    const withCoord = list.filter(it => Array.isArray(it.coord) && it.coord.length === 2);
    withCoord.forEach(it => {
      const icon = L.divIcon({ html: pinHtml(it, ranks), className: "", iconSize: [28, 28], iconAnchor: [14, 14] });
      const mk = L.marker(it.coord, { icon, title: nameOf(it), zIndexOffset: it.id === state.sel ? 1000 : (it.must_go ? 500 : 0), keyboard: false }).addTo(markerLayer);
      mk.on("click", ev => { L.DomEvent.stopPropagation(ev); if (state.sel === it.id) clearSel(); else selectOnMap(it.id, false); });
    });
    if (!fitted && withCoord.length) {
      // 初始範圍：旅行中心 15 km 內的地點＋必去，避免福島、秩父這類遠點把地圖縮得太小
      fitted = true;
      const near = withCoord.filter(it => it.must_go || L_.distanceM(tripCfg().center, it.coord) < 15000);
      const pts = (near.length ? near : withCoord).map(it => it.coord);
      map.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 14 });
    }
    const missing = list.length - withCoord.length;
    let note = $("#mapView .map-note");
    if (!note) { note = document.createElement("div"); note.className = "map-note"; $("#mapView").appendChild(note); }
    note.textContent = missing ? `另有 ${missing} 筆沒有座標，只在清單顯示` : "";
    note.hidden = !missing || !!state.sel;
    renderPeek();
  }
  // 選取：標記放大＋光圈，地圖移過去並放大到至少 15 級（沿用舊版第 9 版的行為）
  function selectOnMap(id) {
    state.sel = id;
    renderMap();
    const it = getItem(id);
    if (it && it.coord) map.flyTo(it.coord, Math.max(map.getZoom(), 15), { duration: 0.6 });
  }
  function clearSel() { state.sel = null; renderMap(); }
  function renderPeek() {
    const el = $("#peek");
    const it = state.sel && getItem(state.sel);
    if (!it) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = cardHtml(it, rankMap(filtered()), false) +
      `<div class="peek-actions">
        <a class="btn primary" href="${esc(it.maps_url || L_.mapsUrl(it))}" target="_blank" rel="noopener">🧭 Google Maps</a>
        <button class="btn" data-act="detail">詳細資訊</button>
      </div>`;
  }
  $("#peek").addEventListener("click", e => {
    if (e.target.closest("a")) return;
    if (e.target.closest("[data-act='detail']") || e.target.closest(".card")) openDetail(state.sel);
  });

  /* 臨時參考點：只在這次開啟期間存在，不存進資料 */
  function placeRefPin(latlng) {
    const icon = L.divIcon({ html: '<div class="ref-pin"></div>', className: "", iconSize: [26, 26], iconAnchor: [13, 30] });
    if (refMarker) refMarker.setLatLng(latlng);
    else { refMarker = L.marker(latlng, { icon, zIndexOffset: 900, keyboard: false }).addTo(meLayer); refMarker.on("click", removeRefPin); }
    const lat = latlng.lat.toFixed(5), lng = latlng.lng.toFixed(5);
    const box = document.createElement("div");
    box.className = "ref-popup";
    box.innerHTML = `<b>📍 臨時參考點</b><div style="color:#777;font-size:12px">再點一次藍點可取消；不會存進資料</div>
      <div class="row"><a href="https://www.google.com/maps/search/?api=1&query=${lat},${lng}" target="_blank" rel="noopener">Google Maps</a><button type="button">移除</button></div>`;
    box.querySelector("button").addEventListener("click", ev => { ev.stopPropagation(); removeRefPin(); });
    if (refPopup) map.closePopup(refPopup);
    refPopup = L.popup({ offset: [0, -28] }).setLatLng(latlng).setContent(box);
    map.openPopup(refPopup);
  }
  function removeRefPin() {
    if (refPopup) { map.closePopup(refPopup); refPopup = null; }
    if (refMarker) { meLayer.removeLayer(refMarker); refMarker = null; }
  }

  /* 我的位置：按一次取得一次，不持續追蹤 */
  let meMarker = null, meCircle = null;
  $("#locateBtn").addEventListener("click", () => {
    if (!navigator.geolocation) { toast("這個瀏覽器不支援定位"); return; }
    toast("取得位置中…");
    navigator.geolocation.getCurrentPosition(pos => {
      state.me = [pos.coords.latitude, pos.coords.longitude];
      ensureMap();
      if (meMarker) { meLayer.removeLayer(meMarker); meLayer.removeLayer(meCircle); }
      meCircle = L.circle(state.me, { radius: pos.coords.accuracy, color: "#2b6cb0", weight: 1, fillOpacity: .08 }).addTo(meLayer);
      meMarker = L.marker(state.me, { icon: L.divIcon({ html: '<div class="me-dot"></div>', className: "", iconSize: [18, 18], iconAnchor: [9, 9] }), keyboard: false, zIndexOffset: 800 }).addTo(meLayer);
      map.flyTo(state.me, Math.max(map.getZoom(), 15), { duration: 0.6 });
      $("#locateBtn").classList.add("on");
      toast("已取得位置；清單可依距離排序");
      if (state.tab === "list") renderList();
    }, err => {
      toast(err.code === 1 ? "沒有定位權限，請在瀏覽器設定允許" : "無法取得位置，請稍後再試");
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
  });

  /* ---------------- 抽屜（篩選／詳情）與返回鍵 ---------------- */
  let overlay = null;
  function showOverlay(name) {
    hideOverlays(true);
    overlay = name;
    $("#" + name + "Backdrop").hidden = false;
    $("#" + name + "Sheet").hidden = false;
    if (!(history.state && history.state.ov)) history.pushState({ ov: 1 }, "");
  }
  function hideOverlays(keepHistory) {
    ["filter", "detail"].forEach(n => { $("#" + n + "Backdrop").hidden = true; $("#" + n + "Sheet").hidden = true; });
    if (overlay === "detail") state.detail = null;
    overlay = null;
    if (!keepHistory && history.state && history.state.ov) history.back();
  }
  function closeOverlay() { if (history.state && history.state.ov) history.back(); else hideOverlays(true); }
  window.addEventListener("popstate", () => { if (overlay) hideOverlays(true); });
  $("#filterBackdrop").addEventListener("click", closeOverlay);
  $("#detailBackdrop").addEventListener("click", closeOverlay);
  document.addEventListener("keydown", e => { if (e.key === "Escape" && overlay) closeOverlay(); });

  /* ---------------- 篩選 ---------------- */
  function filterHtml(inSheet) {
    const items = tripItems();
    const f = state.f;
    const uniq = arr => [...new Set(arr)].filter(Boolean).sort((a, b) => a.localeCompare(b, "zh-Hant"));
    const regions = uniq(items.map(it => L_.regionGroup(it.region)));
    const cats = uniq(items.map(it => it.category));
    const tags = uniq(items.flatMap(it => it.tags || []));
    const chip = (kind, v, label, on) => `<button class="chip ${on ? "on" : ""}" data-f="${kind}" data-v="${esc(v)}">${esc(label)}</button>`;
    const sw = (key, label) => `<div class="f-row"><span>${label}</span><label class="switch"><input type="checkbox" data-sw="${key}" ${f[key] ? "checked" : ""}><span></span></label></div>`;
    const count = filtered().length;
    return `
      <div class="sheet-head"><h2>篩選</h2><button class="icon-btn" data-close aria-label="關閉">✕</button></div>
      <div class="f-sec">
        <div class="f-title">日期與營業<button data-f="today">回到今天</button></div>
        <div class="f-row"><span>查看日期</span><button class="chip" data-f="date">📅 ${esc(L_.dateLabel(state.date))}</button></div>
        ${sw("hideClosed", "隱藏這天公休的地點")}
        <div class="small">公休只依資料裡寫得明確的規則判斷；寫法模糊的標示「可能公休」，不會被隱藏。</div>
      </div>
      <div class="f-sec">
        ${sw("must", "只看必去")}
        ${sw("showArchived", "顯示已封存")}
      </div>
      <div class="f-sec">
        <div class="f-title">地區${f.regions.length ? '<button data-f="clr-regions">清除</button>' : ""}</div>
        <div class="chips">${regions.map(r => chip("regions", r, r, f.regions.includes(r))).join("")}</div>
      </div>
      <div class="f-sec">
        <div class="f-title">類別</div>
        <div class="chips">${L_.GROUPS.filter(g => items.some(it => L_.groupOf(it) === g.id)).map(g => chip("groups", g.id, g.icon + " " + g.label, f.groups.includes(g.id))).join("")}</div>
      </div>
      <div class="f-sec">
        <div class="f-row"><span>期待度至少</span><select data-sel="minExp">
          <option value="">不限</option>${[5, 4, 3, 2, 1].map(n => `<option value="${n}" ${String(f.minExp) === String(n) ? "selected" : ""}>${n}</option>`).join("")}
        </select></div>
        <div class="f-row"><span>驗證等級</span><select data-sel="verify">
          <option value="">不限</option>
          <option value="ok" ${f.verify === "ok" ? "selected" : ""}>✅ 已驗證</option>
          <option value="partial" ${f.verify === "partial" ? "selected" : ""}>🟡 部分驗證</option>
          <option value="warn" ${f.verify === "warn" ? "selected" : ""}>🔴 未驗證／有疑慮</option>
        </select></div>
      </div>
      <details class="more" ${f.tags.length ? "open" : ""}><summary>標籤${f.tags.length ? `（已選 ${f.tags.length}）` : ""}</summary>
        <div class="chips" style="margin-top:8px">${tags.map(t => chip("tags", t, t, f.tags.includes(t))).join("")}</div>
      </details>
      <details class="more" ${f.cats.length ? "open" : ""}><summary>細分類型${f.cats.length ? `（已選 ${f.cats.length}）` : ""}</summary>
        <div class="chips" style="margin-top:8px">${cats.map(c => chip("cats", c, c, f.cats.includes(c))).join("")}</div>
      </details>
      <div class="sheet-foot">
        <button class="btn" data-f="reset">全部清除</button>
        ${inSheet ? `<button class="btn primary" data-close>顯示 ${count} 筆</button>` : `<span class="small" style="align-self:center">${count} 筆符合</span>`}
      </div>`;
  }
  function bindFilter(root) {
    root.onclick = e => {
      if (e.target.closest("[data-close]")) { closeOverlay(); return; }
      const b = e.target.closest("[data-f]"); if (!b) return;
      const k = b.dataset.f;
      if (k === "date") { $("#dateBtn").click(); return; }
      if (k === "today") state.date = today();
      else if (k === "reset") { Object.assign(state.f, { must: false, groups: [], regions: [], cats: [], tags: [], verify: "", minExp: "", hideClosed: false, showArchived: false }); }
      else if (k === "clr-regions") state.f.regions = [];
      else toggleIn(state.f[k], b.dataset.v);
      changed();
    };
    root.onchange = e => {
      const t = e.target;
      if (t.dataset.sw) state.f[t.dataset.sw] = t.checked;
      if (t.dataset.sel) state.f[t.dataset.sel] = t.value;
      changed();
    };
  }
  function renderFilters() {
    const side = $("#sidebar");
    if (getComputedStyle(side).display !== "none") { side.innerHTML = filterHtml(false); bindFilter(side); }
    if (overlay === "filter") {
      const sh = $("#filterSheet"); const st = sh.scrollTop;
      sh.innerHTML = filterHtml(true); bindFilter(sh); sh.scrollTop = st;
    }
  }
  function openFilter() { showOverlay("filter"); renderFilters(); $("#filterSheet").scrollTop = 0; }

  /* ---------------- 詳情 ---------------- */
  function openDetail(id) {
    if (!getItem(id)) return;
    showOverlay("detail");
    state.detail = id;
    renderDetail();
    $("#detailSheet").scrollTop = 0;
  }
  function renderDetail() {
    const it = state.detail && getItem(state.detail);
    const sh = $("#detailSheet");
    if (!it) return;
    // 正在編輯欄位時不要重畫（避免打字到一半被雲端更新打斷）
    if (sh.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
    const st = sh.scrollTop;
    const openState = [...sh.querySelectorAll("details")].map(d => d.open);
    const c = closedInfo(it);
    const total = L_.totalScore(it);
    const gm = it.gm_score != null ? `Google ${it.gm_score}` : null;
    const tb = it.tabelog_score != null ? `Tabelog ${it.tabelog_score}` : null;
    const scoreLine = it.is_food
      ? `<b style="font-size:20px">${total ?? "—"}</b> 總分 ＝ 期待度 ${it.expectation ?? "未填"}${gm ? " ＋ " + gm : ""}${tb ? " ＋ " + tb : ""}`
      : `非餐飲類，看期待度${gm ? `（參考：${gm}）` : ""}`;
    const badges = [
      it.must_go ? '<span class="badge b-must">★ 必去</span>' : "",
      it.archived ? '<span class="badge b-arch">已封存</span>' : "",
      c ? `<span class="badge ${c.cls}">${esc(c.text)}</span>` : "",
      { ok: "✅ 已驗證", partial: "🟡 部分驗證", warn: "🔴 未驗證／有疑慮", none: "" }[L_.verifyLevel(it.verify)]
    ].filter(Boolean).join(" ");
    const kv = (k, v) => v ? `<div class="k">${k}</div><div>${esc(v)}</div>` : "";
    // 圖片：直接從來源網站讀取（不複製檔案），讀不到就整張隱藏
    const photos = (Array.isArray(it.photos) ? it.photos : []).filter(p => p && p.url);
    const photoHtml = photos.length ? `<div class="photos">${photos.map(p => `
      <figure class="photo">
        <img src="${esc(p.url)}" alt="${esc(nameOf(it))}" loading="lazy" referrerpolicy="no-referrer" onerror="this.closest('figure').remove()">
        <figcaption><span class="ph-role">${p.role === "ext" ? "外觀" : "代表"}</span>
          ${p.page ? `<a href="${esc(p.page)}" target="_blank" rel="noopener">${esc(p.credit || "來源")}</a>` : esc(p.credit || "")}${p.license ? " · " + esc(p.license) : ""}</figcaption>
      </figure>`).join("")}</div>` : "";
    const streetView = it.coord ? `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${it.coord[0]},${it.coord[1]}` : "";
    const field = (key, label, area) => `<div class="field"><label>${label}</label>${area
      ? `<textarea data-edit="${key}">${esc(it[key] || "")}</textarea>`
      : `<input data-edit="${key}" value="${esc(key === "tags" ? (it.tags || []).join("、") : (it[key] || ""))}">`}</div>`;

    sh.innerHTML = `
      <div class="sheet-head">
        <h2>${L_.isGinkgo(it) ? `<span class="ginkgo-inline">${GINKGO_SVG}</span>` : ""}${esc(nameOf(it))}</h2>
        <button class="icon-btn" data-close aria-label="關閉">✕</button>
      </div>
      ${photoHtml}
      <div class="status-line">${badges}</div>
      <div class="d-actions">
        <a class="btn primary" href="${esc(it.maps_url || L_.mapsUrl(it))}" target="_blank" rel="noopener">🧭 Google Maps</a>
        <button class="btn ${it.must_go ? "must-on" : ""}" data-act="must">${it.must_go ? "★ 必去" : "☆ 必去"}</button>
        ${it.coord ? '<button class="btn" data-act="onmap">📍 地圖</button>' : ""}
      </div>
      <div class="d-block">
        <div class="d-label">期待度</div>
        <div class="exp-seg">${[1, 2, 3, 4, 5].map(n => `<button data-exp="${n}" class="${it.expectation === n ? "on" : ""}">${n}</button>`).join("")}
          <button class="clear" data-exp="">清除</button></div>
      </div>
      <div class="d-block">
        <div class="d-label">分數</div>
        <div>${scoreLine}</div>
      </div>
      <div class="d-block">
        <div class="kv">
          ${kv("地區", it.region)}${kv("類型", it.category)}${kv("營業時間", it.hours)}${kv("公休", it.closed)}${kv("地址", it.address)}
        </div>
        ${streetView ? `<a class="sv-link" href="${streetView}" target="_blank" rel="noopener">👀 看街景（認門口）</a>` : ""}
        ${(it.tags || []).length ? `<div class="tags" style="margin-top:10px">${it.tags.map(t => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}
      </div>
      <details class="more"><summary>備註與查證來源</summary>
        <div class="small">
          ${it.notes ? `<p>📝 ${esc(it.notes)}</p>` : ""}
          ${it.gm_note ? `<p>Google：${esc(it.gm_note)}</p>` : ""}
          ${it.tabelog_note ? `<p>Tabelog：${esc(it.tabelog_note)}</p>` : ""}
          ${it.verify ? `<p>驗證：${esc(it.verify)}</p>` : ""}
          ${it.status ? `<p>狀態：${esc(it.status)}</p>` : ""}
          ${it.confidence ? `<p>可信度：${esc(it.confidence)}</p>` : ""}
          ${it.source ? `<p>資料來源：${esc(it.source)}</p>` : ""}
          ${it.archived && it.archive_reason ? `<p>封存原因：${esc(it.archive_reason)}（${esc(it.archive_date || "")}）</p>` : ""}
        </div>
      </details>
      <details class="more"><summary>✏️ 編輯資料</summary>
        <div class="edit-grid">
          ${field("region", "地區")}${field("category", "類型")}${field("tags", "標籤（用、分隔）")}
          ${field("hours", "營業時間")}${field("closed", "公休日")}${field("address", "地址")}
          ${field("verify", "驗證等級")}${field("notes", "備註", true)}
        </div>
        <p class="small">改完離開欄位就會儲存。</p>
      </details>
      <div class="d-block">
        <button class="btn danger" style="width:100%" data-act="archive">${it.archived ? "↩️ 取消封存" : "🗄️ 封存（不想去了）"}</button>
      </div>`;
    sh.querySelectorAll("details").forEach((d, i) => { if (openState[i]) d.open = true; });
    sh.scrollTop = st;
  }
  $("#detailSheet").addEventListener("click", e => {
    const id = state.detail; const it = id && getItem(id);
    if (e.target.closest("[data-close]")) { closeOverlay(); return; }
    if (!it) return;
    const exp = e.target.closest("[data-exp]");
    if (exp) {
      const v = exp.dataset.exp === "" ? null : +exp.dataset.exp;
      window.Store.patch(id, { expectation: v });
      toast(v == null ? "已清除期待度" : "期待度 " + v);
      return;
    }
    const a = e.target.closest("[data-act]"); if (!a) return;
    if (a.dataset.act === "must") window.Store.patch(id, { must_go: !it.must_go });
    if (a.dataset.act === "onmap") { closeOverlay(); switchTab("map"); setTimeout(() => selectOnMap(id, true), 120); }
    if (a.dataset.act === "archive") {
      if (it.archived) window.Store.patch(id, { archived: false });
      else {
        const reason = window.prompt("封存原因（例如：已歇業／評價普通／太遠／有更好的選擇）：", "");
        if (reason === null) return;
        window.Store.patch(id, { archived: true, archive_date: new Date().toISOString().slice(0, 10), archive_reason: reason || "未填寫原因" });
        toast("已封存；在篩選裡打開「顯示已封存」可以找回");
      }
    }
  });
  $("#detailSheet").addEventListener("change", e => {
    const t = e.target; const key = t.dataset.edit; if (!key || !state.detail) return;
    const fields = {};
    if (key === "tags") fields.tags = t.value.split(/[、,，]/).map(s => s.trim()).filter(Boolean);
    else fields[key] = t.value;
    if (key === "category") {
      const it = getItem(state.detail);
      fields.is_food = L_.deriveIsFood(t.value);
      fields.gm_tier = fields.is_food ? L_.gmTierOf(it.gm_score) : null;
      fields.tabelog_tier = fields.is_food ? L_.tabelogTierOf(it.tabelog_score) : null;
    }
    t.blur();
    window.Store.patch(state.detail, fields);
    toast("已儲存");
  });

  /* ---------------- 更多 ---------------- */
  let installEvt = null;
  window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; if (state.tab === "more") renderMore(); });
  function platform() {
    const ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) return "ios";
    if (/Android/.test(ua)) return "android";
    return "desktop";
  }
  function isStandalone() { return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true; }

  function renderMore() {
    const S = window.Store;
    const items = tripItems();
    const filled = items.filter(x => x.expectation != null).length;
    const must = items.filter(x => x.must_go).length;
    const arch = items.filter(x => x.archived).length;
    const p = platform();
    const installSteps = isStandalone() ? `<p>✅ 已經是安裝後的 App 模式。</p>`
      : p === "ios" ? `<ol class="steps"><li>用 <b>Safari</b> 打開這個網址</li><li>點下方的「分享」按鈕 <b>⎋</b></li><li>選「<b>加入主畫面</b>」→「新增」</li></ol>`
      : p === "android" ? (installEvt ? `<button class="btn primary" data-m="install">安裝 App</button>` :
        `<ol class="steps"><li>用 <b>Chrome</b> 打開這個網址</li><li>點右上角「⋮」</li><li>選「<b>安裝應用程式</b>」或「加到主畫面」</li></ol>`)
      : (installEvt ? `<button class="btn primary" data-m="install">安裝成電腦 App</button>` : `<p class="small">在手機上用 Safari（iPhone）或 Chrome（Android）打開這個網址即可安裝。</p>`);

    $("#moreView").innerHTML = `
      <div class="panel">
        <h3>資料同步</h3>
        ${S.mode === "local"
          ? `<p>💾 <b>本機模式</b>：資料只存在這個瀏覽器。</p><p class="small">接上雲端（Supabase）後，手機、電腦和 Claude 會使用同一份資料。設定方式見專案裡的 README。</p>`
          : `<p>${esc(S.status.text)}</p>${S.user ? `<p class="small">登入帳號：${esc(S.user.email || "")}</p>
             <div class="btn-col"><button class="btn" data-m="refresh">🔄 重新同步</button><button class="btn" data-m="logout">登出</button></div>` : ""}`}
      </div>
      ${CFG.trips.length > 1 ? `<div class="panel"><h3>旅行</h3><select data-m="trip" style="width:100%;padding:10px;border-radius:10px;border:1px solid var(--line);background:var(--paper)">
        ${CFG.trips.map(t => `<option value="${esc(t.id)}" ${t.id === state.trip ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select></div>` : ""}
      <div class="panel">
        <h3>${esc(tripCfg().name)}</h3>
        <p>候選 ${items.length - arch} 筆（封存 ${arch} 筆）· 必去 ${must} 筆 · 已填期待度 ${filled} 筆</p>
        <div class="btn-col">
          <button class="btn" data-m="add">＋ 新增候選地點</button>
          <button class="btn" data-m="export">⬇️ 匯出 JSON（備份／交給 Claude）</button>
          <button class="btn" data-m="import">⬆️ 匯入 JSON</button>
        </div>
        <input type="file" id="importFile" accept="application/json,.json" hidden>
      </div>
      <div class="panel">
        <h3>安裝到手機主畫面</h3>
        ${installSteps}
      </div>
      <div class="panel small">
        旅行決策 v${APP_VERSION} · 地圖 © OpenStreetMap ·
        ${S.mode === "local" ? `初始資料 ${esc(window.SEED_EXPORTED_AT || "")}` : "雲端資料"}
      </div>`;
  }
  $("#moreView").addEventListener("click", async e => {
    const b = e.target.closest("[data-m]"); if (!b) return;
    const m = b.dataset.m;
    if (m === "refresh") { await window.Store.refresh(); toast("已重新同步"); }
    if (m === "logout") { if (confirm("確定要登出？")) await window.Store.signOut(); }
    if (m === "install" && installEvt) { installEvt.prompt(); installEvt = null; }
    if (m === "add") addItem();
    if (m === "export") exportJson();
    if (m === "import") $("#importFile").click();
  });
  $("#moreView").addEventListener("change", e => {
    if (e.target.dataset.m === "trip") { state.trip = e.target.value; fitted = false; state.sel = null; persistUi(); changed(); }
    if (e.target.id === "importFile" && e.target.files[0]) importJson(e.target.files[0]);
  });

  function addItem() {
    const name = (window.prompt("新地點名稱：") || "").trim();
    if (!name) return;
    const it = {
      id: L_.newId(), trip: state.trip, name, name_clean: name, region: "未分類待確認", region_note: null,
      category: "", is_food: false, tags: [], expectation: null, must_go: false,
      gm_score: null, gm_note: "", gm_tier: null, tabelog_score: null, tabelog_note: "", tabelog_tier: null,
      hours: "", closed: "", verify: "🔴未驗證（新增，尚未查證）", status: "候選（剛新增）", confidence: "",
      address: "", notes: "", source: "使用者手動新增", coord: null, archived: false
    };
    it.maps_url = L_.mapsUrl(it);
    window.Store.add(it);
    openDetail(it.id);
    toast("已新增；可以請 Claude 幫忙查證並補上座標");
  }

  async function exportJson() {
    const items = tripItems().map(x => { const o = Object.assign({}, x); delete o._v; return o; });
    const payload = { exported_at: new Date().toISOString(), tool_version: "app-" + APP_VERSION, trip: state.trip,
      note: "旅行決策 App 匯出資料。欄位依 Claude outputs/schema.json。", items };
    const text = JSON.stringify(payload, null, 1);
    const d = new Date();
    const filename = `${tripCfg().name.replace(/[\/\s]/g, "_")}_候選資料_${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}.json`;
    try {
      const file = new File([text], filename, { type: "application/json" });
      if (platform() !== "desktop" && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        return;
      }
    } catch (e) { if (e && e.name === "AbortError") return; }
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast("已匯出 " + items.length + " 筆");
  }

  function importJson(file) {
    const r = new FileReader();
    r.onload = () => {
      let parsed;
      try { parsed = JSON.parse(r.result); } catch (e) { alert("檔案不是有效的 JSON。"); return; }
      const incoming = Array.isArray(parsed) ? parsed : (parsed.items || []);
      if (!incoming.length) { alert("檔案裡找不到地點資料。"); return; }
      const key = it => L_.norm(it.name_clean || it.name) + "|" + L_.norm(it.address);
      const all = window.Store.items();
      const byId = new Map(all.map(x => [x.id, x])), byKey = new Map(all.map(x => [key(x), x]));
      const updates = [], adds = [];
      incoming.forEach(inc => {
        const ex = (inc.id && byId.get(inc.id)) || byKey.get(key(inc));
        if (ex) {
          const fields = {};
          Object.keys(inc).forEach(k => {
            if (k === "id" || k === "_v" || inc[k] === undefined) return;
            if (["expectation", "must_go", "archived"].includes(k) && inc[k] == null) return;   // 沒給值就保留你填的
            if (JSON.stringify(inc[k]) !== JSON.stringify(ex[k])) fields[k] = inc[k];
          });
          if (Object.keys(fields).length) updates.push([ex.id, fields]);
        } else {
          adds.push(Object.assign({ id: L_.newId(), trip: state.trip, archived: false, must_go: false, expectation: null, tags: [] }, inc));
        }
      });
      if (!updates.length && !adds.length) { alert("資料都一樣，沒有需要更新的地方。"); return; }
      if (!confirm(`將更新 ${updates.length} 筆、新增 ${adds.length} 筆，確定匯入？`)) return;
      updates.forEach(([id, f]) => window.Store.patch(id, f));
      adds.forEach(it => { if (!it.maps_url) it.maps_url = L_.mapsUrl(it); window.Store.add(it); });
      toast(`已更新 ${updates.length} 筆、新增 ${adds.length} 筆`);
    };
    r.readAsText(file);
  }

  /* ---------------- 分頁與整體重畫 ---------------- */
  function switchTab(tab) {
    state.tab = tab; persistUi();
    document.querySelectorAll(".bottom-nav button").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
    ["map", "list", "more"].forEach(t => $("#" + t + "View").classList.toggle("active", t === tab));
    $("#quickRow").hidden = tab === "more";
    render();
    if (tab === "map" && map) setTimeout(() => map.invalidateSize(), 30);
  }
  document.querySelector(".bottom-nav").addEventListener("click", e => {
    const b = e.target.closest("[data-tab]"); if (b) switchTab(b.dataset.tab);
  });

  // 合併同一輪的多次重畫請求（不用 requestAnimationFrame：背景或省電時會被暫停）
  let renderQueued = false;
  function render() {
    if (renderQueued) return;
    renderQueued = true;
    setTimeout(() => {
      renderQueued = false;
      renderTop();
      renderFilters();
      if (state.tab === "map") renderMap();
      if (state.tab === "list") renderList();
      if (state.tab === "more") renderMore();
      if (overlay === "detail") renderDetail();
      const st = window.Store.status.state;
      $("#loginScreen").hidden = st !== "login";
    });
  }
  function changed() { persistUi(); render(); }
  window.addEventListener("resize", () => render());

  /* ---------------- 登入 ---------------- */
  $("#loginForm").addEventListener("submit", async e => {
    e.preventDefault();
    $("#loginError").textContent = "";
    $("#loginSubmit").disabled = true;
    try { await window.Store.signIn($("#loginEmail").value.trim(), $("#loginPassword").value); $("#loginPassword").value = ""; }
    catch (err) { $("#loginError").textContent = /Invalid login/i.test(err.message) ? "Email 或密碼不正確" : ("登入失敗：" + err.message); }
    finally { $("#loginSubmit").disabled = false; }
  });

  /* ---------------- 啟動 ---------------- */
  $("#sortSel").value = state.sort;
  window.Store.onChange(render);
  window.Store.init().then(() => switchTab(state.tab));
  switchTab(state.tab);

  if ("serviceWorker" in navigator && /^https?:/.test(location.protocol)) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(e => console.warn("SW", e)));
  }
})();
