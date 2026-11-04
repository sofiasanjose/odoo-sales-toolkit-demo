/* Stock check: "can I promise this customer their order?"
 * Pick a price list or a customer and see, for exactly their products, what
 * is free to sell right now and when the next container lands. */
(function () {
  "use strict";
  const A = window.App;
  const { D, fmt, esc, TODAY } = A;
  const RECENT_KEY = "ps.stock.recent";
  const state = { q: "", only: "all", sort: "name", side: "" };

  const recent = () => JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
  function remember(key) {
    const r = recent().filter((x) => x !== key);
    r.unshift(key);
    localStorage.setItem(RECENT_KEY, JSON.stringify(r.slice(0, 6)));
  }

  function sidePanel(sel) {
    const q = A.norm(state.side);
    const pls = D.pricelists.filter((pl) => !q || A.norm(pl.name).includes(q));
    const cs = q ? D.customers.filter((c) => A.norm(c.name + " " + c.city).includes(q)).slice(0, 25) : [];
    const item = (key, title, sub) => `<button class="side-item ${sel === key ? "on" : ""}" data-key="${key}"><b>${esc(title)}</b><small>${esc(sub)}</small></button>`;
    const rec = recent().map((k) => {
      const [t, id] = k.split(":");
      if (t === "c" && A.C.get(+id)) return item(k, A.C.get(+id).name, A.PL.get(A.C.get(+id).pricelist_id).name);
      if (t === "pl" && A.PL.get(+id)) return item(k, A.PL.get(+id).name, A.PL.get(+id).items.length + " products");
      return "";
    }).join("");
    return `${!q && rec ? `<h4>Recent</h4>${rec}` : ""}
      ${cs.length ? `<h4>Customers</h4>${cs.map((c) => item("c:" + c.id, c.name, c.city + " · " + A.PL.get(c.pricelist_id).name)).join("")}` : ""}
      <h4>Price lists</h4>${item("all", "Every product", D.products.filter((p) => p.active).length + " active products")}
      ${pls.map((pl) => item("pl:" + pl.id, pl.name, pl.items.length + " products · " + pl.code)).join("")}
      ${q && !cs.length && !pls.length ? `<div class="empty">Nothing matches “${esc(state.side)}”.</div>` : ""}`;
  }

  function render(el, arg, params) {
    if (params.only) state.only = params.only;
    let key = params.c ? "c:" + params.c : params.pl ? "pl:" + params.pl : "all";
    const cust = params.c ? A.C.get(+params.c) : null;
    const pl = cust ? A.PL.get(cust.pricelist_id) : params.pl ? A.PL.get(+params.pl) : null;
    if (key !== "all") remember(key);

    el.innerHTML = `
      <div class="page-head"><div><h1>Stock check</h1><p>Free to use = on hand minus what's already promised on confirmed orders.</p></div></div>
      <div class="grid g-side">
        <div class="card">
          <input type="search" class="search" id="side-q" placeholder="Customer or price list…" value="${esc(state.side)}">
          <div class="side-list" id="side">${sidePanel(key)}</div>
        </div>
        <div class="card" id="panel"></div>
      </div>`;

    const side = el.querySelector("#side");
    el.querySelector("#side-q").addEventListener("input", (e) => { state.side = e.target.value; side.innerHTML = sidePanel(key); bindSide(); });
    function bindSide() {
      side.querySelectorAll(".side-item").forEach((b) => b.addEventListener("click", () => {
        const [t, id] = b.dataset.key.split(":");
        A.go("stock", null, t === "c" ? { c: id } : t === "pl" ? { pl: id } : {});
      }));
    }
    bindSide();

    // ---------------------------------------------------- the list
    let pids = pl ? pl.items.map((x) => x[0]) : D.products.filter((p) => p.active).map((p) => p.id);
    const bought = cust ? new Map(A.customerProducts(cust.id).map((r) => [r.pid, r])) : null;
    if (cust) for (const pid of bought.keys()) if (!pids.includes(pid)) pids.push(pid); // trials outside their list
    const rows = pids.map((pid) => ({ p: A.P.get(pid), s: A.stockOf(pid), b: bought && bought.get(pid) }))
      .filter((r) => r.p.active || r.s.on_hand > 0);

    const panel = el.querySelector("#panel");
    function draw() {
      const short = (r) => r.s.lots.some((l) => A.dayNum(l[2]) - TODAY <= 60);
      const counts = {
        all: rows.length, ok: rows.filter((r) => r.s.status === "ok" || r.s.status === "over").length,
        low: rows.filter((r) => r.s.status === "low").length, out: rows.filter((r) => r.s.status === "out").length,
        short: rows.filter(short).length, over: rows.filter((r) => r.s.status === "over").length,
      };
      let list = rows.filter((r) => A.matches(r.p, state.q));
      if (state.only === "ok") list = list.filter((r) => r.s.status === "ok" || r.s.status === "over");
      else if (state.only !== "all") list = list.filter((r) => (state.only === "short" ? short(r) : r.s.status === state.only));
      const S = {
        name: (a, b) => a.p.name.localeCompare(b.p.name),
        most: (a, b) => b.s.free - a.s.free,
        least: (a, b) => a.s.free - b.s.free,
        arrival: (a, b) => ((a.s.next && a.s.next.eta) || "9").localeCompare((b.s.next && b.s.next.eta) || "9"),
        bought: (a, b) => ((b.b && b.b.last) || 0) - ((a.b && a.b.last) || 0),
      };
      list.sort(S[state.sort] || S.name);

      const title = cust ? cust.name : pl ? pl.name : "Every product";
      const sub = cust ? `${esc(cust.city)} · price list <b>${esc(pl.name)}</b> · rep ${esc(A.REP.get(cust.rep_id).name)}`
        : pl ? esc(pl.note) : "All active products in Odoo";
      const seg = [["all", "All"], ["ok", "In stock"], ["low", "Running low"], ["out", "Out of stock"], ["short", "Short-dated"], ["over", "Overstock"]];
      panel.innerHTML = `
        <div class="card-h" style="align-items:flex-start"><div><h2 style="font-size:20px">${esc(title)}</h2><p style="font-size:13px;margin-top:3px">${sub}</p></div>
          <div class="right" style="display:flex;gap:8px">${cust ? `<a class="btn" href="#/customer/${cust.id}">Customer profile →</a>` : ""}
          <button class="btn" id="xls">Export to Excel</button></div></div>
        <div class="filters">
          <input type="search" id="q" placeholder="Filter by name, brand, SKU, EAN…" value="${esc(state.q)}" style="flex:1;min-width:200px">
          <div class="seg">${seg.map(([k, v]) => `<button data-k="${k}" class="${state.only === k ? "on" : ""}">${v} <small>${counts[k]}</small></button>`).join("")}</div>
          <label>Sort <select id="sort">
            ${[["name", "Name A–Z"], ["most", "Most free to use"], ["least", "Least free to use"], ["arrival", "Next arrival"]].concat(cust ? [["bought", "They bought most recently"]] : [])
              .map(([k, v]) => `<option value="${k}" ${state.sort === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
        </div>
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Product</th><th class="num">On hand</th><th class="num">Reserved</th><th class="num">Free to use</th><th>Next arrival</th><th>Status</th>${cust ? "<th>They last bought</th>" : ""}</tr></thead>
          <tbody>${list.map((r) => row(r, cust)).join("") || `<tr><td colspan="7" class="empty">No products match.</td></tr>`}</tbody>
        </table></div>
        <p class="muted" style="font-size:12px;margin-top:10px">Click a product for its lots, best-before dates and purchase orders. Quantities in units; one case = the units shown under the name.</p>`;

      panel.querySelector("#q").addEventListener("input", (e) => {
        state.q = e.target.value;
        const pos = e.target.selectionStart;
        draw();
        const q = panel.querySelector("#q"); q.focus(); q.setSelectionRange(pos, pos);
      });
      panel.querySelectorAll(".seg button").forEach((b) => b.addEventListener("click", () => { state.only = b.dataset.k; draw(); }));
      panel.querySelector("#sort").addEventListener("change", (e) => { state.sort = e.target.value; draw(); });
      panel.querySelectorAll("tr[data-pid]").forEach((tr) => tr.addEventListener("click", () => {
        const next = tr.nextElementSibling;
        if (next && next.classList.contains("detail")) return next.remove();
        tr.insertAdjacentHTML("afterend", detail(+tr.dataset.pid, cust ? 7 : 6));
      }));
      panel.querySelector("#xls").addEventListener("click", () => {
        const out = [["SKU", "Product", "Brand", "EAN", "Units per case", "On hand", "Reserved", "Free to use", "Incoming", "Next arrival", "PO", "Status"].concat(cust ? ["They last bought", "Qty"] : [])];
        for (const r of list) {
          out.push([r.p.sku, r.p.name, r.p.brand, r.p.ean, r.p.units_per_case, r.s.on_hand, r.s.reserved, r.s.free, r.s.incomingQty,
            r.s.next ? r.s.next.eta || "No date set" : "", r.s.next ? r.s.next.po : "", r.s.status].concat(cust ? [r.b ? A.isoOf(r.b.last) : "Not bought yet", r.b ? r.b.lastQty : ""] : []));
        }
        A.downloadCSV(`stock-${A.norm(title).replace(/[^a-z0-9]+/g, "-")}-${A.TODAY_ISO}.csv`, out);
        A.toast("Exported " + list.length + " products");
      });
    }
    draw();
  }

  function row(r, cust) {
    const { p, s, b } = r;
    const n = s.next;
    const arr = n ? `<b>${fmt.num(s.incomingQty)}</b> ${n.eta ? `· ${fmt.dateShort(n.eta)} <small>(${fmt.inDays(A.dayNum(n.eta) - TODAY)})</small>` : `<small>· no date set</small>`}<div class="psub">${esc(n.po)}</div>` : `<span class="muted">—</span>`;
    const isNew = TODAY - A.dayNum(p.launched) < 120 ? ` <span class="tag new">New</span>` : "";
    let last = "";
    if (cust) {
      last = b ? `${fmt.date(A.isoOf(b.last))}<div class="psub">${fmt.num(b.lastQty)} u · ${fmt.ago(TODAY - b.last)}</div>` : `<span class="muted">Not bought yet</span>`;
    }
    return `<tr class="click" data-pid="${p.id}"><td>${A.productCell(p, isNew)}</td>
      <td class="num">${fmt.num(s.on_hand)}</td><td class="num">${s.reserved ? fmt.num(s.reserved) : "—"}</td>
      <td class="num"><b>${fmt.num(Math.max(0, s.free))}</b><div class="psub">${s.perDay > 0 && s.free > 0 ? "≈ " + Math.round(s.coverDays / 7) + " wk" : ""}</div></td>
      <td class="nowrap">${arr}</td><td>${A.stockBadge(p.id)}</td>${cust ? `<td class="nowrap">${last}</td>` : ""}</tr>`;
  }

  function detail(pid, cols) {
    const p = A.P.get(pid), s = A.stockOf(pid);
    const lots = s.lots.length ? s.lots.map((l) => {
      const d = A.dayNum(l[2]) - TODAY;
      return `<tr><td>${esc(l[0])}</td><td class="num">${fmt.num(l[1])}</td><td>${fmt.date(l[2])} ${d <= 60 ? A.chip("Due", "Sell first · " + d + " days") : ""}</td></tr>`;
    }).join("") : `<tr><td colspan="3" class="muted">No stock in the warehouse.</td></tr>`;
    const pos = s.incoming.length ? s.incoming.map((x) => `<tr><td>${esc(x.po)}</td><td class="num">${fmt.num(x.qty)}</td><td>${x.eta ? fmt.date(x.eta) : "No date set"}</td><td>${esc(x.supplier)}<div class="psub">${esc(x.note)}</div></td></tr>`).join("")
      : `<tr><td colspan="4" class="muted">Nothing on order.</td></tr>`;
    return `<tr class="detail"><td colspan="${cols}" style="background:#FBFAF6">
      <div class="grid g2">
        <div><h3 style="margin-bottom:6px">Lots in the warehouse <small>(first expiring, first out)</small></h3>
          <table class="tbl"><thead><tr><th>Lot</th><th class="num">Units</th><th>Best before</th></tr></thead><tbody>${lots}</tbody></table></div>
        <div><h3 style="margin-bottom:6px">Purchase orders</h3>
          <table class="tbl"><thead><tr><th>PO</th><th class="num">Units</th><th>ETA</th><th>Supplier</th></tr></thead><tbody>${pos}</tbody></table>
          <p class="psub" style="margin-top:8px">EAN ${esc(p.ean)} · case EAN ${esc(p.ean_case)} · ${p.cases_per_pallet} cases/pallet · ${p.case_weight_kg} kg/case · sells ≈ ${fmt.num(s.perDay * 7)} u/week</p></div>
      </div></td></tr>`;
  }

  A.views.stock = { title: "Stock check", render };
})();
