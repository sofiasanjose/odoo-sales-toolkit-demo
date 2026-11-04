/* Catalog builder: pick products, get a branded A4 PDF for one customer.
 *
 * Step 1 filters the range (origin, category, subcategory, brand, search) and
 * picks products, or starts from what a customer already buys. Step 2 lays it
 * out (cover, sections, 6 / 12 per page or a table) and prints to PDF.
 * Prices are off unless the rep switches them on, and then come from the
 * customer's own price list, never mixed. */
(function () {
  "use strict";
  const A = window.App;
  const { D, fmt, esc, TODAY } = A;
  const KEY = "ps.catalog.draft.v1";
  const RECENT = "ps.catalog.recent.v1";

  const blank = () => ({ ids: [], customer: "", cid: null, title: "Product catalogue", note: "", layout: "detailed", groupBy: "category", showPrices: false, plId: 1, sections: [], names: {} });
  let draft = Object.assign(blank(), JSON.parse(localStorage.getItem(KEY) || "{}"));
  const save = () => localStorage.setItem(KEY, JSON.stringify(draft));
  const f = { q: "", origin: new Set(), category: new Set(), subcategory: new Set(), brand: new Set(), stock: false, fresh: false };

  const CAT_ORDER = ["Sauces & Condiments", "Pantry", "Snacks", "Confectionery", "Beverages", "Breakfast", "Non-food"];

  function startFromCustomer(cid) {
    const c = A.C.get(cid);
    const prods = A.customerProducts(cid).filter((r) => r.status !== "Stopped" && A.P.get(r.pid).active);
    draft = Object.assign(blank(), {
      ids: prods.map((r) => r.pid), customer: c.name, cid, plId: c.pricelist_id,
      note: `Your regular range with ${D.company.short}, ${fmt.monthYear(A.TODAY_ISO.slice(0, 7))}. New products are marked NEW.`,
    });
    save();
    A.toast(`Started from ${c.name}: ${draft.ids.length} products they buy`);
  }

  // ------------------------------------------------------------ step 1: pick
  function facetCounts(field) {
    const m = new Map();
    for (const p of filtered(field)) m.set(p[field], (m.get(p[field]) || 0) + 1);
    return m;
  }
  function filtered(skip) {
    return D.products.filter((p) => p.active && A.matches(p, f.q)
      && ["origin", "category", "subcategory", "brand"].every((k) => k === skip || !f[k].size || f[k].has(p[k]))
      && (!f.stock || A.stockOf(p.id).free > 0)
      && (!f.fresh || TODAY - A.dayNum(p.launched) <= 365));
  }

  function renderPick(el, params) {
    if (params.c && +params.c !== draft.cid) startFromCustomer(+params.c);
    if (params.new) f.fresh = true;
    const recent = JSON.parse(localStorage.getItem(RECENT) || "[]");
    el.innerHTML = `
      <div class="page-head"><div><h1>Catalog builder</h1><p>Filter, click products to add them, then build a branded PDF.</p></div>
        <div class="actions">
          <select id="from"><option value="">Start from a customer's range…</option>${D.customers.slice().sort((a, b) => a.name.localeCompare(b.name)).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select>
          ${recent.length ? `<select id="recent"><option value="">Recent catalogues…</option>${recent.map((r, i) => `<option value="${i}">${esc(r.customer || "No customer")} · ${r.ids.length} products · ${fmt.dateShort(r.date)}</option>`).join("")}</select>` : ""}
        </div></div>
      <div class="cat-layout">
        <aside class="card" id="facets"></aside>
        <section>
          <div class="selbar">
            <input type="search" id="q" placeholder="Search name, brand, SKU, EAN…" value="${esc(f.q)}" style="flex:1;min-width:200px">
            <span class="count" id="count"></span>
            <button class="btn" id="all">Select all shown</button>
            <button class="btn" id="clear">Clear selection</button>
            <a class="btn primary" href="#/catalog/build" id="build">Build catalogue →</a>
          </div>
          <div class="pgrid" id="grid"></div>
        </section>
      </div>`;

    const drawFacets = () => {
      const block = (field, title) => {
        const counts = facetCounts(field);
        const keys = [...new Set(D.products.filter((p) => p.active).map((p) => p[field]))]
          .sort((a, b) => field === "category" ? CAT_ORDER.indexOf(a) - CAT_ORDER.indexOf(b) : a.localeCompare(b));
        return `<div class="facet"><h4>${title}${f[field].size ? `<button class="btn link" data-reset="${field}">clear</button>` : ""}</h4><div class="more">
          ${keys.map((k) => `<label><input type="checkbox" data-f="${field}" value="${esc(k)}" ${f[field].has(k) ? "checked" : ""}>${field === "origin" ? (A.FLAG[k] || "") + " " : ""}${esc(k)}<small>${counts.get(k) || 0}</small></label>`).join("")}</div></div>`;
      };
      el.querySelector("#facets").innerHTML = `
        <div class="facet"><label><input type="checkbox" id="f-stock" ${f.stock ? "checked" : ""}>Only in stock</label>
        <label><input type="checkbox" id="f-new" ${f.fresh ? "checked" : ""}>Only launched in the last 12 months</label></div>
        ${block("origin", "Origin")}${block("category", "Category")}${block("subcategory", "Subcategory")}${block("brand", "Brand")}`;
      el.querySelectorAll("[data-f]").forEach((cb) => cb.addEventListener("change", () => {
        f[cb.dataset.f][cb.checked ? "add" : "delete"](cb.value); drawFacets(); drawGrid();
      }));
      el.querySelectorAll("[data-reset]").forEach((b) => b.addEventListener("click", () => { f[b.dataset.reset].clear(); drawFacets(); drawGrid(); }));
      el.querySelector("#f-stock").addEventListener("change", (e) => { f.stock = e.target.checked; drawFacets(); drawGrid(); });
      el.querySelector("#f-new").addEventListener("change", (e) => { f.fresh = e.target.checked; drawFacets(); drawGrid(); });
    };
    const sel = () => new Set(draft.ids);
    const drawCount = () => {
      el.querySelector("#count").textContent = `${draft.ids.length} selected${draft.customer ? " for " + draft.customer : ""}`;
      el.querySelector("#build").classList.toggle("disabled", !draft.ids.length);
    };
    const drawGrid = () => {
      const s = sel();
      const list = filtered().sort((a, b) => CAT_ORDER.indexOf(a.category) - CAT_ORDER.indexOf(b.category) || a.subcategory.localeCompare(b.subcategory) || a.name.localeCompare(b.name));
      el.querySelector("#grid").innerHTML = list.map((p) => {
        const st = A.stockOf(p.id);
        const isNew = TODAY - A.dayNum(p.launched) <= 180;
        return `<div class="pcard ${s.has(p.id) ? "sel" : ""}" data-id="${p.id}" tabindex="0" role="checkbox" aria-checked="${s.has(p.id)}">
          <span class="tick">✓</span><div class="badges">${isNew ? '<span class="tag new">NEW</span>' : ""}${st.status === "out" ? A.chip("out", "Out") : ""}</div>
          ${window.Packshot.svg(p, 92)}<div class="pname">${esc(p.name)}</div>
          <div class="psub">SKU ${esc(p.sku)} · ${p.units_per_case}/case</div></div>`;
      }).join("") || `<div class="empty">No products match these filters.</div>`;
      el.querySelectorAll(".pcard").forEach((card) => {
        const toggle = () => {
          const id = +card.dataset.id;
          draft.ids = draft.ids.includes(id) ? draft.ids.filter((x) => x !== id) : draft.ids.concat(id);
          save(); card.classList.toggle("sel"); card.setAttribute("aria-checked", card.classList.contains("sel")); drawCount();
        };
        card.addEventListener("click", toggle);
        card.addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggle(); } });
      });
      drawCount();
    };

    el.querySelector("#q").addEventListener("input", (e) => { f.q = e.target.value; drawFacets(); drawGrid(); });
    el.querySelector("#all").addEventListener("click", () => {
      const s = sel(); filtered().forEach((p) => s.add(p.id)); draft.ids = [...s]; save(); drawGrid();
    });
    el.querySelector("#clear").addEventListener("click", () => { remember(); draft = blank(); save(); drawGrid(); A.toast("Selection cleared (kept in Recent catalogues)"); });
    el.querySelector("#from").addEventListener("change", (e) => { if (e.target.value) { startFromCustomer(+e.target.value); drawGrid(); } });
    const rs = el.querySelector("#recent");
    if (rs) rs.addEventListener("change", (e) => { if (e.target.value !== "") { draft = Object.assign(blank(), recent[+e.target.value]); save(); drawGrid(); A.toast("Reopened " + (draft.customer || "catalogue")); } });
    el.querySelector("#build").addEventListener("click", (e) => { if (!draft.ids.length) { e.preventDefault(); A.toast("Pick at least one product first"); } });
    drawFacets();
    drawGrid();
  }

  function remember() {
    if (!draft.ids.length) return;
    const r = JSON.parse(localStorage.getItem(RECENT) || "[]").filter((x) => !(x.customer === draft.customer && x.ids.join() === draft.ids.join()));
    r.unshift(Object.assign({}, draft, { date: A.TODAY_ISO }));
    localStorage.setItem(RECENT, JSON.stringify(r.slice(0, 20)));
  }

  // ------------------------------------------------------------ step 2: build
  function sections() {
    const groups = new Map();
    const by = draft.groupBy || "category";
    for (const id of draft.ids) {
      const p = A.P.get(id);
      if (!p) continue;
      if (!groups.has(p[by])) groups.set(p[by], []);
      groups.get(p[by]).push(p);
    }
    const keys = [...groups.keys()];
    let order = draft.sections.filter((k) => groups.has(k));
    const fresh = keys.filter((k) => !order.includes(k)).sort((a, b) => {
      const pa = groups.get(a)[0], pb = groups.get(b)[0];
      if (by === "brand") return a.localeCompare(b);
      return CAT_ORDER.indexOf(pa.category) - CAT_ORDER.indexOf(pb.category) || a.localeCompare(b);
    });
    order = order.concat(fresh);
    draft.sections = order;
    const within = by === "brand" ? (a, b) => a.subcategory.localeCompare(b.subcategory) || a.name.localeCompare(b.name)
      : (a, b) => a.subcategory.localeCompare(b.subcategory) || a.brand.localeCompare(b.brand) || a.name.localeCompare(b.name);
    return order.map((k) => ({ key: k, title: draft.names[k] || k, products: groups.get(k).sort(within) }));
  }

  const LAYOUT = {
    detailed: { cols: 3, rowH: 76, label: "Detailed · up to 9 per page" },
    compact: { cols: 4, rowH: 57, label: "Compact · up to 16 per page" },
    table: { cols: 1, rowH: 13.2, label: "Table · up to 17 per page" },
  };
  const PAGE_H = 256, HEAD_H = 14, TABLE_HEAD = 8;

  function paginate(secs) {
    const L = LAYOUT[draft.layout];
    const pages = [];
    let page = null, used = 0;
    const newPage = () => { page = []; pages.push(page); used = 0; };
    newPage();
    for (const s of secs) {
      const rows = [];
      for (let i = 0; i < s.products.length; i += L.cols) rows.push(s.products.slice(i, i + L.cols));
      const extra = draft.layout === "table" ? TABLE_HEAD : 0;
      if (used + HEAD_H + extra + L.rowH > PAGE_H) newPage();
      let block = { title: s.title, cont: false, rows: [] };
      page.push(block); used += HEAD_H + extra;
      for (const r of rows) {
        if (used + L.rowH > PAGE_H) {
          newPage();
          block = { title: s.title, cont: true, rows: [] };
          page.push(block); used += HEAD_H + extra;
        }
        block.rows.push(r); used += L.rowH;
      }
    }
    return pages;
  }

  function priceTxt(p) {
    if (!draft.showPrices) return "";
    const pl = A.PL.get(draft.plId);
    const v = pl.priceOf.get(p.id);
    if (!v) return `<div class="price" style="color:#999;font-weight:500">Price on request</div>`;
    return `<div class="price">${fmt.eur(v)} <small style="font-weight:500;color:#777">/ unit · ${fmt.eur(v * p.units_per_case)} / case</small></div>`;
  }
  const isNew = (p) => TODAY - A.dayNum(p.launched) <= 180;

  function card(p, size) {
    return `<div class="ccard" style="height:${LAYOUT[draft.layout].rowH - (draft.layout === "detailed" ? 5 : 3.5)}mm;position:relative">
      ${isNew(p) ? '<span class="tag new" style="position:absolute;top:2mm;left:2mm">NEW</span>' : ""}
      ${window.Packshot.svg(p, size)}<div class="n">${esc(p.name)}</div>
      <div class="meta">SKU <b>${esc(p.sku)}</b> · ${p.units_per_case} units/case${draft.layout === "detailed" ? `<br>${p.cases_per_pallet} cases/pallet · ${p.case_weight_kg} kg/case<br>EAN ${esc(p.ean)}` : ""}
      <div class="flag">${A.FLAG[p.origin] || ""} ${esc(p.origin)}</div></div>${priceTxt(p)}</div>`;
  }

  function pagesHTML() {
    const secs = sections();
    const pages = paginate(secs);
    const total = pages.length + 2;
    const c = D.company, me = A.me;
    const head = `<div class="sheet-head"><svg viewBox="0 0 40 40" width="24" height="24"><path d="M6 24c5-5 9-5 14 0s9 5 14 0" stroke="#F76707" stroke-width="3.6" fill="none" stroke-linecap="round"/><circle cx="27" cy="12.5" r="4.5" fill="#FBF3E4"/></svg>
      <b>${esc(c.short)}</b><span class="t">${esc(draft.title)}${draft.customer ? " · " + esc(draft.customer) : ""}</span></div>`;
    const foot = (n) => `<div class="sheet-foot"><span>${esc(c.name)} · ${esc(c.phone)} · ${esc(c.email)}</span><span>${n} / ${total}</span></div>`;
    const cover = `<div class="sheet"><div class="cover">
      <div class="cover-top">
        <div class="brandline"><svg viewBox="0 0 40 40" width="46" height="46"><rect width="40" height="40" rx="10" fill="#0E4A60"/><path d="M6 24c5-5 9-5 14 0s9 5 14 0" stroke="#F76707" stroke-width="3.4" fill="none" stroke-linecap="round"/><circle cx="27" cy="12.5" r="4.5" fill="#FBF3E4"/></svg>
          <div><b style="font-size:16pt">${esc(c.short)}</b><div style="color:#cfe2e8;font-size:10pt">${esc(c.tagline)}</div></div></div>
        <h1>${esc(draft.title)}</h1>
        ${draft.customer ? `<div class="for">Prepared for ${esc(draft.customer)}</div>` : ""}
        ${draft.note ? `<div class="note">${esc(draft.note)}</div>` : ""}
        <div class="note">${draft.ids.length} products · ${secs.length} sections · ${fmt.monthYear(A.TODAY_ISO.slice(0, 7))}</div>
      </div>
      <svg class="cover-waves" viewBox="0 0 800 120" preserveAspectRatio="none" height="120"><path d="M0 60c70-45 130-45 200 0s130 45 200 0 130-45 200 0 130 45 200 0" stroke="#F76707" stroke-width="16" fill="none"/><path d="M0 100c70-45 130-45 200 0s130 45 200 0 130-45 200 0 130 45 200 0" stroke="#135D74" stroke-width="16" fill="none"/></svg>
      <div class="cover-bottom"><div>Your contact<br><b>${esc(me.name)}</b><br>${esc(me.email)}</div><div style="text-align:right">${esc(c.address)}<br>${esc(c.web)}</div></div>
    </div></div>`;
    const size = draft.layout === "detailed" ? 96 : 70;
    const body = pages.map((pg, i) => `<div class="sheet">${head}<div class="sheet-body">${pg.map((b) => `
      <div class="sec-h">${esc(b.title)}${b.cont ? "<small>continued</small>" : ""}</div>
      ${draft.layout === "table" ? `<table class="ctable"><thead><tr><th></th><th>Product</th><th>SKU</th><th>EAN</th><th class="num">Units/case</th><th class="num">Cases/pallet</th>${draft.showPrices ? '<th class="num">Price / unit</th>' : ""}</tr></thead><tbody>${
        b.rows.map(([p]) => `<tr style="height:${LAYOUT.table.rowH}mm"><td style="width:12mm">${window.Packshot.svg(p, 34)}</td><td><b>${esc(p.name)}</b> ${isNew(p) ? '<span class="tag new">NEW</span>' : ""}<div style="color:#888;font-size:7.5pt">${A.FLAG[p.origin] || ""} ${esc(p.origin)}</div></td><td>${esc(p.sku)}</td><td>${esc(p.ean)}</td><td class="num">${p.units_per_case}</td><td class="num">${p.cases_per_pallet}</td>${draft.showPrices ? `<td class="num"><b>${A.PL.get(draft.plId).priceOf.get(p.id) ? fmt.eur(A.PL.get(draft.plId).priceOf.get(p.id)) : "on request"}</b></td>` : ""}</tr>`).join("")}</tbody></table>`
        : `<div class="${draft.layout === "detailed" ? "cards6" : "cards12"}">${b.rows.flat().map((p) => card(p, size)).join("")}</div>`}`).join("")}
      </div>${foot(i + 2)}</div>`).join("");
    const pl = A.PL.get(draft.plId);
    const back = `<div class="sheet">${head}<div class="sheet-body" style="padding-top:18mm">
      <div class="sec-h">How to order</div>
      <table class="ctable" style="font-size:10pt;margin-top:4mm"><tbody>
        <tr><td style="width:55mm"><b>Your contact</b></td><td>${esc(me.name)} · ${esc(me.email)} · ${esc(c.phone)}</td></tr>
        <tr><td><b>Orders</b></td><td>${esc(c.email)}, or through your sales rep. Order by SKU; quantities in full cases.</td></tr>
        <tr><td><b>Delivery</b></td><td>${esc(pl.note)}</td></tr>
        <tr><td><b>Warehouse</b></td><td>${esc(c.address)}</td></tr>
        ${draft.showPrices ? `<tr><td><b>Prices</b></td><td>${esc(pl.name)}, in euros, VAT not included. Valid while stocks last.</td></tr>` : ""}
      </tbody></table>
      <p style="color:#777;font-size:9pt;margin-top:10mm">Pack details, EANs and availability as recorded in our system on ${fmt.date(A.TODAY_ISO)}. NEW = launched in the last six months.</p>
      </div>${foot(total)}</div>`;
    return { html: cover + body + back, pages: total, secs };
  }

  function renderBuild(el, params = {}) {
    // deep link: #/catalog/build?c=12&layout=compact&prices=1&by=subcategory
    if (params.c && +params.c !== draft.cid) startFromCustomer(+params.c);
    if (params.layout && LAYOUT[params.layout]) draft.layout = params.layout;
    if (params.by) draft.groupBy = params.by;
    if (params.prices) draft.showPrices = params.prices === "1";
    if (!draft.ids.length) return A.go("catalog");
    el.innerHTML = `
      <div class="page-head no-print"><div><a href="#/catalog" class="btn link">← Back to products</a><h1 style="margin-top:6px">Build the catalogue</h1></div>
        <div class="actions"><button class="btn" id="csv">Export CSV</button><button class="btn accent" id="pdf">Save as PDF</button></div></div>
      <div class="card no-print" id="form"></div>
      <p class="psub no-print" style="margin:14px 0 8px" id="info"></p>
      <div class="preview-wrap catalog-print" id="pv"></div>`;

    const form = el.querySelector("#form");
    const drawForm = () => {
      const secs = sections();
      form.innerHTML = `<div class="grid g3">
        <div>
          <label class="form-row"><span>Customer</span><input id="customer" type="text" value="${esc(draft.customer)}" placeholder="Who is it for?"></label>
          <label class="form-row"><span>Title</span><input id="title" type="text" value="${esc(draft.title)}"></label>
          <label class="form-row"><span>Note on the cover</span><textarea id="note" rows="3">${esc(draft.note)}</textarea></label>
        </div>
        <div>
          <div class="form-row"><span>Layout</span><div class="seg" id="layout">${Object.entries(LAYOUT).map(([k, v]) => `<button data-k="${k}" class="${draft.layout === k ? "on" : ""}">${v.label.split(" · ")[0]}</button>`).join("")}</div>
            <small>${LAYOUT[draft.layout].label}</small></div>
          <div class="form-row"><span>Sections by</span><div class="seg" id="groupby">${[["category", "Category"], ["subcategory", "Subcategory"], ["brand", "Brand"]].map(([k, v]) => `<button data-k="${k}" class="${(draft.groupBy || "category") === k ? "on" : ""}">${v}</button>`).join("")}</div></div>
          <label class="check"><input type="checkbox" id="prices" ${draft.showPrices ? "checked" : ""}> Show prices</label>
          <label class="form-row" style="${draft.showPrices ? "" : "opacity:.45"}"><span>From price list</span><select id="pl" ${draft.showPrices ? "" : "disabled"}>${D.pricelists.map((pl) => `<option value="${pl.id}" ${draft.plId === pl.id ? "selected" : ""}>${esc(pl.name)}</option>`).join("")}</select></label>
          <p class="psub">Prices are off by default. A catalogue gets kept and forwarded; prices go stale, pack sizes don't.</p>
        </div>
        <div>
          <div class="form-row"><span>Sections · click a name to rename</span></div>
          <div id="secs" style="max-height:220px;overflow-y:auto">${secs.map((s, i) => `<div style="display:flex;gap:6px;align-items:center;margin-bottom:4px">
            <input type="text" data-sec="${esc(s.key)}" value="${esc(s.title)}" style="flex:1;padding:4px 8px"><small>${s.products.length}</small>
            <button class="btn small" data-up="${i}" ${i ? "" : "disabled"} aria-label="Move up">▲</button><button class="btn small" data-down="${i}" ${i < secs.length - 1 ? "" : "disabled"} aria-label="Move down">▼</button></div>`).join("")}</div>
        </div></div>`;
      const upd = () => { save(); drawPreview(); };
      form.querySelector("#customer").addEventListener("input", (e) => { draft.customer = e.target.value; upd(); });
      form.querySelector("#title").addEventListener("input", (e) => { draft.title = e.target.value; upd(); });
      form.querySelector("#note").addEventListener("input", (e) => { draft.note = e.target.value; upd(); });
      form.querySelectorAll("#layout button").forEach((b) => b.addEventListener("click", () => { draft.layout = b.dataset.k; save(); drawForm(); drawPreview(); }));
      form.querySelectorAll("#groupby button").forEach((b) => b.addEventListener("click", () => { draft.groupBy = b.dataset.k; draft.sections = []; save(); drawForm(); drawPreview(); }));
      form.querySelector("#prices").addEventListener("change", (e) => { draft.showPrices = e.target.checked; save(); drawForm(); drawPreview(); });
      form.querySelector("#pl").addEventListener("change", (e) => { draft.plId = +e.target.value; upd(); });
      form.querySelectorAll("[data-sec]").forEach((i) => i.addEventListener("input", () => { draft.names[i.dataset.sec] = i.value; upd(); }));
      const move = (i, d) => { const s = draft.sections; [s[i], s[i + d]] = [s[i + d], s[i]]; save(); drawForm(); drawPreview(); };
      form.querySelectorAll("[data-up]").forEach((b) => b.addEventListener("click", () => move(+b.dataset.up, -1)));
      form.querySelectorAll("[data-down]").forEach((b) => b.addEventListener("click", () => move(+b.dataset.down, 1)));
    };
    const drawPreview = () => {
      const r = pagesHTML();
      el.querySelector("#pv").innerHTML = r.html;
      const priced = draft.showPrices ? draft.ids.filter((id) => A.PL.get(draft.plId).priceOf.get(id)).length : 0;
      el.querySelector("#info").textContent = `${draft.ids.length} products · ${r.secs.length} sections · ${r.pages} A4 pages` +
        (draft.showPrices ? ` · ${priced} priced from ${A.PL.get(draft.plId).name}, ${draft.ids.length - priced} “on request”` : "");
    };
    drawForm();
    drawPreview();

    el.querySelector("#pdf").addEventListener("click", () => {
      remember();
      document.body.classList.add("printing-catalog");
      const old = document.title;
      document.title = `${D.company.short} catalogue${draft.customer ? " - " + draft.customer : ""} - ${A.TODAY_ISO}`;
      window.print();
      setTimeout(() => { document.body.classList.remove("printing-catalog"); document.title = old; }, 500);
    });
    el.querySelector("#csv").addEventListener("click", () => {
      const rows = [["Section", "SKU", "Product", "Brand", "Origin", "EAN", "Case EAN", "Units per case", "Cases per pallet", "Case weight kg"].concat(draft.showPrices ? ["Price per unit"] : [])];
      for (const s of sections()) for (const p of s.products) rows.push([s.title, p.sku, p.name, p.brand, p.origin, p.ean, p.ean_case, p.units_per_case, p.cases_per_pallet, p.case_weight_kg].concat(draft.showPrices ? [A.PL.get(draft.plId).priceOf.get(p.id) || ""] : []));
      A.downloadCSV(`catalogue-${A.norm(draft.customer || "products").replace(/[^a-z0-9]+/g, "-")}.csv`, rows);
    });
  }

  function render(el, arg, params) {
    if (arg === "build") renderBuild(el, params);
    else renderPick(el, params);
  }

  A.views.catalog = { title: "Catalog builder", render };
})();
