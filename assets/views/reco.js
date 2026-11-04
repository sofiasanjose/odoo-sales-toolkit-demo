/* Recommendations: what to offer next.
 *
 * "Bought together" is market-basket analysis over the last 12 months of
 * orders: of the customers who buy X, how many also buy Y, and is that more
 * than you'd expect by chance (lift > 1)? "Similar" is a content match on
 * category, brand and origin for products nobody has bought together yet.
 * It never suggests another size of something they already have. */
(function () {
  "use strict";
  const A = window.App;
  const { D, fmt, esc, TODAY } = A;
  const st = { mode: "both", side: "", q: "" };
  let model = null;

  function build() {
    if (model) return model;
    const baskets = [];
    for (const [cid, os] of A.custOrders) {
      const set = new Set();
      for (const o of os) if (TODAY - o.t <= 365) for (const li of o.lines) set.add(A.L[li][1]);
      if (set.size) baskets.push({ cid, set });
    }
    const cnt = new Map(), co = new Map();
    for (const { set } of baskets) {
      const arr = [...set];
      for (const a of arr) {
        cnt.set(a, (cnt.get(a) || 0) + 1);
        let m = co.get(a);
        if (!m) co.set(a, (m = new Map()));
        for (const b of arr) if (a !== b) m.set(b, (m.get(b) || 0) + 1);
      }
    }
    model = { N: baskets.length, cnt, co };
    return model;
  }

  const family = (p) => p.brand + "|" + p.word + "|" + p.variant; // same product, other size

  function together(s, have, haveFam) {
    const M = build();
    const n = M.cnt.get(s) || 0;
    if (!n) return [];
    const out = [];
    for (const [t, both] of M.co.get(s) || []) {
      const p = A.P.get(t);
      if (have.has(t) || haveFam.has(family(p)) || !p.active || both < 2) continue;
      const conf = both / n, base = M.cnt.get(t) / M.N, lift = conf / base;
      if (lift <= 1.1) continue;
      out.push({ pid: t, conf, lift, both, n, score: conf * Math.log2(1 + lift) });
    }
    return out.sort((a, b) => b.score - a.score);
  }

  function similar(s, have, haveFam, exclude) {
    const M = build();
    const p = A.P.get(s);
    const out = [];
    for (const q of D.products) {
      if (!q.active || have.has(q.id) || exclude.has(q.id) || haveFam.has(family(q))) continue;
      let sc = 0;
      if (q.subcategory === p.subcategory) sc += 3;
      else if (q.category === p.category) sc += 1;
      if (q.brand === p.brand) sc += 2;
      if (q.origin === p.origin) sc += 1;
      if (q.word === p.word) sc += 1;
      if (sc < 3) continue;
      const pop = (M.cnt.get(q.id) || 0) / M.N;
      out.push({ pid: q.id, score: sc + pop * 2, why: q.subcategory === p.subcategory ? (q.brand === p.brand ? "same range, other flavour" : "same shelf, other brand") : "same brand" , pop });
    }
    return out.sort((a, b) => b.score - a.score);
  }

  function sidePanel(sel) {
    const q = A.norm(st.side);
    const item = (key, title, sub) => `<button class="side-item ${sel === key ? "on" : ""}" data-key="${key}"><b>${esc(title)}</b><small>${esc(sub)}</small></button>`;
    const cs = D.customers.filter((c) => !q || A.norm(c.name + c.city).includes(q)).slice(0, q ? 30 : 0);
    return `${cs.length ? `<h4>Customers</h4>${cs.map((c) => item("c:" + c.id, c.name, c.kind + " · " + c.city)).join("")}` : ""}
      <h4>Price lists</h4>${D.pricelists.filter((pl) => !q || A.norm(pl.name).includes(q)).map((pl) => item("pl:" + pl.id, pl.name, pl.items.length + " products")).join("")}`;
  }

  function render(el, arg, params) {
    const cust = params.c ? A.C.get(+params.c) : null;
    const pl = !cust ? A.PL.get(+(params.pl || 3)) : null;
    const key = cust ? "c:" + cust.id : "pl:" + pl.id;
    let haveIds;
    if (cust) {
      haveIds = A.customerProducts(cust.id).filter((r) => r.status !== "Stopped" && r.status !== "Tried once").map((r) => r.pid);
    } else haveIds = pl.items.map((x) => x[0]);
    const have = new Set(haveIds);
    const haveFam = new Set(haveIds.map((pid) => family(A.P.get(pid))));

    el.innerHTML = `
      <div class="page-head"><div><h1>Recommendations</h1><p>Two ideas per product from twelve months of orders across all ${build().N} active customers, plus two look-alikes.</p></div></div>
      <div class="grid g-side">
        <div class="card"><input type="search" class="search" id="side-q" placeholder="Search customers…" value="${esc(st.side)}"><div class="side-list" id="side">${sidePanel(key)}</div></div>
        <div id="panel"></div>
      </div>`;
    const side = el.querySelector("#side");
    const bindSide = () => side.querySelectorAll(".side-item").forEach((b) => b.addEventListener("click", () => {
      const [t, id] = b.dataset.key.split(":");
      A.go("reco", null, t === "c" ? { c: id } : { pl: id });
    }));
    el.querySelector("#side-q").addEventListener("input", (e) => { st.side = e.target.value; side.innerHTML = sidePanel(key); bindSide(); });
    bindSide();

    // per-SKU suggestions + overall best additions
    const per = [];
    const totals = new Map();
    for (const s of haveIds) {
      const tg = together(s, have, haveFam);
      const used = new Set(tg.slice(0, 2).map((x) => x.pid));
      const sm = similar(s, have, haveFam, used);
      per.push({ s, tg: tg.slice(0, st.mode === "together" ? 4 : 2), sm: sm.slice(0, st.mode === "similar" ? 4 : 2) });
      for (const x of tg.slice(0, 6)) {
        const t = totals.get(x.pid) || { score: 0, with: [] };
        t.score += x.score; t.with.push(s); totals.set(x.pid, t);
      }
    }
    const best = [...totals.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, 8);
    const priceOf = (pid) => {
      const list = cust ? A.PL.get(cust.pricelist_id) : pl;
      const v = list.priceOf.get(pid);
      return v ? fmt.eur(v) : `<span class="muted" title="Not on this price list yet">${fmt.eur(A.P.get(pid).list_price)}*</span>`;
    };

    const panel = el.querySelector("#panel");
    const draw = () => {
      const rows = per.filter((r) => A.matches(A.P.get(r.s), st.q));
      panel.innerHTML = `
        <div class="card">
          <div class="card-h"><div><h2 style="font-size:20px">${esc(cust ? cust.name : pl.name)}</h2>
            <p style="font-size:13px">${cust ? `Based on the ${have.size} products they buy regularly · price list ${esc(A.PL.get(cust.pricelist_id).name)}` : esc(pl.note)}</p></div>
            ${cust ? `<a class="btn right" href="#/customer/${cust.id}">Customer profile →</a>` : ""}</div>
          <h3 style="margin:6px 0 10px">Best additions ${cust ? "for this customer" : "to this price list"}</h3>
          ${best.length ? `<div class="pgrid">${best.map(([pid, t]) => {
            const p = A.P.get(pid);
            return `<div class="pcard" style="cursor:default">${window.Packshot.svg(p, 84)}<div class="pname">${esc(p.name)}</div>
              <div class="psub">goes with ${t.with.length} of ${cust ? "their" : "the list's"} products</div><div style="margin-top:6px">${A.stockBadge(pid)}</div>
              <div class="psub" style="margin-top:4px">${priceOf(pid)} /u</div></div>`;
          }).join("")}</div>` : `<div class="empty">Not enough order history to suggest anything yet.</div>`}
        </div>
        <div class="card">
          <div class="card-h"><h2>Suggestions per product</h2>
            <span class="right"><div class="seg" id="mode">${[["both", "2 + 2"], ["together", "Bought together"], ["similar", "Similar"]].map(([k, v]) => `<button data-k="${k}" class="${st.mode === k ? "on" : ""}">${v}</button>`).join("")}</div></span></div>
          <input type="search" id="q" placeholder="Find a product on the list…" value="${esc(st.q)}" style="width:100%;margin-bottom:10px">
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th style="width:32%">On the list</th>${st.mode !== "similar" ? "<th>Bought together</th>" : ""}${st.mode !== "together" ? "<th>Similar</th>" : ""}</tr></thead>
          <tbody>${rows.map((r) => `<tr><td>${A.productCell(A.P.get(r.s))}</td>
            ${st.mode !== "similar" ? `<td>${r.tg.map((x) => sugg(x.pid, `<b>${fmt.pct(x.conf)}</b> of its ${x.n} buyers also buy it · ${x.lift.toFixed(1)}× more than usual`)).join("") || '<span class="muted">—</span>'}</td>` : ""}
            ${st.mode !== "together" ? `<td>${r.sm.map((x) => sugg(x.pid, x.why)).join("") || '<span class="muted">—</span>'}</td>` : ""}</tr>`).join("")}</tbody></table></div>
          <p class="psub">* not on this price list yet: list price shown.</p>
        </div>`;
      panel.querySelectorAll("#mode button").forEach((b) => b.addEventListener("click", () => { st.mode = b.dataset.k; render(el, arg, params); }));
      panel.querySelector("#q").addEventListener("input", (e) => { st.q = e.target.value; const pos = e.target.selectionStart; draw(); const q = panel.querySelector("#q"); q.focus(); q.setSelectionRange(pos, pos); });
    };
    const sugg = (pid, why) => {
      const p = A.P.get(pid);
      return `<div class="pcell" style="margin:3px 0">${window.Packshot.svg(p, 30)}<div><div class="pname" style="font-size:12.5px">${esc(p.name)} ${A.stockOf(pid).status === "out" ? A.chip("out") : ""}</div><div class="psub">${why}</div></div></div>`;
    };
    draw();
  }

  A.views.reco = { title: "Recommendations", render };
})();
