/* Customer profile: everything a rep wants to know before a visit or call. */
(function () {
  "use strict";
  const A = window.App;
  const { D, fmt, esc, TODAY } = A;
  const listState = { q: "", rep: "", status: "" };
  const st = { tab: "all", di: null };

  // ------------------------------------------------------------ list
  function renderList(el) {
    const all = D.customers.map((c) => ({ c, s: A.customerStats(c.id) }));
    el.innerHTML = `
      <div class="page-head"><div><h1>Customers</h1><p>${D.customers.length} accounts. Click one for its profile.</p></div></div>
      <div class="card">
        <div class="filters">
          <input type="search" id="q" placeholder="Name, city or type…" value="${esc(listState.q)}" style="flex:1;min-width:220px">
          <label>Rep <select id="rep"><option value="">Everyone</option>${D.reps.map((r) => `<option value="${r.id}" ${+listState.rep === r.id ? "selected" : ""}>${esc(r.name)}</option>`).join("")}</select></label>
          <label>Status <select id="status"><option value="">Any</option>${["Active", "Due", "Overdue", "Stopped"].map((s) => `<option ${listState.status === s ? "selected" : ""}>${s}</option>`).join("")}</select></label>
        </div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Customer</th><th>Rep</th><th>Price list</th><th class="num">Last 12 months</th><th class="num">vs prior year</th><th>Last order</th><th>Status</th></tr></thead><tbody id="tb"></tbody></table></div>
      </div>`;
    const draw = () => {
      const q = A.norm(listState.q);
      const rows = all.filter((x) => (!q || A.norm(x.c.name + " " + x.c.city + " " + x.c.kind).includes(q))
        && (!listState.rep || x.c.rep_id === +listState.rep) && (!listState.status || x.s.status === listState.status))
        .sort((a, b) => b.s.rev12 - a.s.rev12);
      el.querySelector("#tb").innerHTML = rows.map(({ c, s }) => `<tr class="click" data-id="${c.id}">
        <td><b>${esc(c.name)}</b><div class="psub">${A.FLAG[c.country] || ""} ${esc(c.kind)} · ${esc(c.city)}${c.delivery.length > 1 ? " · " + c.delivery.length + " delivery points" : ""}</div></td>
        <td>${esc(A.REP.get(c.rep_id).name)}</td><td class="psub">${esc(A.PL.get(c.pricelist_id).name)}</td>
        <td class="num">${fmt.eur0(s.rev12)}</td><td class="num ${A.growth(s.rev12, s.revPrev).cls}">${A.growth(s.rev12, s.revPrev).txt}</td>
        <td class="nowrap">${s.last ? fmt.date(s.last.date) : "—"}<div class="psub">${fmt.ago(s.since)}</div></td><td>${A.chip(s.status)}</td></tr>`).join("")
        || `<tr><td colspan="7" class="empty">No customers match.</td></tr>`;
      el.querySelectorAll("tr[data-id]").forEach((tr) => tr.addEventListener("click", () => A.go("customer", tr.dataset.id)));
    };
    el.querySelector("#q").addEventListener("input", (e) => { listState.q = e.target.value; draw(); });
    el.querySelector("#rep").addEventListener("change", (e) => { listState.rep = e.target.value; draw(); });
    el.querySelector("#status").addEventListener("change", (e) => { listState.status = e.target.value; draw(); });
    draw();
  }

  // ------------------------------------------------------------ profile
  function similarAlsoBuy(c, have) {
    const peers = D.customers.filter((x) => x.id !== c.id && x.kind === c.kind);
    const count = new Map();
    for (const peer of peers) {
      const seen = new Set();
      for (const o of A.custOrders.get(peer.id) || []) {
        if (TODAY - o.t > 365) continue;
        for (const li of o.lines) seen.add(A.L[li][1]);
      }
      for (const pid of seen) count.set(pid, (count.get(pid) || 0) + 1);
    }
    return [...count.entries()].filter(([pid, n]) => !have.has(pid) && n >= Math.max(2, peers.length * 0.3) && A.P.get(pid).active)
      .sort((a, b) => b[1] - a[1]).slice(0, 6).map(([pid, n]) => ({ p: A.P.get(pid), n, of: peers.length }));
  }

  function render(el, arg, params = {}) {
    if (!arg) return renderList(el);
    const c = A.C.get(+arg);
    if (!c) return renderList(el);
    if (st.cid !== c.id) { st.cid = c.id; st.di = null; st.tab = "all"; }
    if (params.tab) { st.tab = params.tab; delete params.tab; } // deep link to a tab of "What they buy"
    const s = A.customerStats(c.id);
    const pl = A.PL.get(c.pricelist_id);
    const rep = A.REP.get(c.rep_id);
    const os = s.orders.filter((o) => st.di == null || o.di === st.di);
    const recentOs = os.filter((o) => TODAY - o.t <= 365);
    const rev12 = recentOs.reduce((a, o) => a + o.total, 0);
    const gp12 = recentOs.reduce((a, o) => a + o.total - o.cost, 0);
    const prods = A.customerProducts(c.id, st.di);
    const have = new Set(prods.map((r) => r.pid));
    const open = s.orders.filter((o) => o.state === "sale");
    const nextDue = s.nextDue ? s.nextDue - TODAY : null;

    el.innerHTML = `
      <div class="page-head"><a href="#/customer" class="btn link no-print">← All customers</a></div>
      <div class="card">
        <div class="cust-head">
          <div style="flex:1;min-width:280px">
            <h1>${esc(c.name)}</h1>
            <div class="facts">
              <span>${A.FLAG[c.country] || ""} <b>${esc(c.kind)}</b> · ${esc(c.city)}</span>
              <span>Ref <b>${esc(c.ref)}</b></span><span>Customer since <b>${fmt.date(c.since)}</b></span>
              <span>Rep <b>${esc(rep.name)}</b></span><span>Price list <b>${esc(pl.name)}</b></span>
              <span>Terms <b>${esc(c.payment_terms)}</b></span><span>Credit limit <b>${fmt.eur0(c.credit_limit)}</b></span>
              <span>${esc(c.phone)}</span>
            </div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <a class="btn" href="#/stock?c=${c.id}">Check stock →</a>
            <a class="btn" href="#/reco?c=${c.id}">Recommendations →</a>
            <a class="btn primary" href="#/catalog?c=${c.id}">Build a catalogue for them</a>
          </div>
        </div>
        ${c.delivery.length > 1 ? `<div class="filters" style="margin:14px 0 0"><label>Delivered to</label>
          <div class="seg" id="di"><button data-i="" class="${st.di == null ? "on" : ""}">All ${c.delivery.length} locations</button>
          ${c.delivery.map((d, i) => `<button data-i="${i}" class="${st.di === i ? "on" : ""}">${esc(d.name.replace(/^\S+\s/, c.kind === "Supermarket chain" ? "" : "$&"))}</button>`).join("")}</div></div>` : ""}
      </div>

      <div class="tiles mt">
        <div class="tile"><div class="lab">Bought in the last 12 months</div><div class="val">${fmt.eurK(rev12)}</div>
          ${st.di == null && s.revPrev > s.rev12 * 0.2 ? `<div class="delta ${s.rev12 >= s.revPrev ? "up" : "down"}">${fmt.delta(s.rev12 / s.revPrev - 1)} <small>vs the year before</small></div>` : `<div class="delta"><small>${st.di == null ? "first year" : esc(c.delivery[st.di].name)}</small></div>`}</div>
        <div class="tile"><div class="lab">Gross margin</div><div class="val">${rev12 ? fmt.pct(gp12 / rev12, 1) : "—"}</div><div class="delta"><small>${fmt.eurK(gp12)} profit</small></div></div>
        <div class="tile"><div class="lab">Orders, 12 months</div><div class="val">${recentOs.length}</div><div class="delta"><small>avg ${fmt.eur0(recentOs.length ? rev12 / recentOs.length : 0)} per order</small></div></div>
        <div class="tile"><div class="lab">Orders every</div><div class="val">${s.interval} days</div>
          <div class="delta"><small>${nextDue == null ? "" : nextDue >= 0 ? "next one expected " + fmt.inDays(nextDue) : "next one was due " + -nextDue + " days ago"}</small></div></div>
        <div class="tile"><div class="lab">Last order</div><div class="val">${s.last ? fmt.dateShort(s.last.date) : "—"}</div><div class="delta">${A.chip(s.status)} <small>${fmt.ago(s.since)}</small></div></div>
      </div>

      <div class="grid g-main-side">
        <div class="card"><div class="card-h"><h2>Purchases by month</h2><p>last 24 months${st.di != null ? " · " + esc(c.delivery[st.di].name) : ""}</p></div><div id="ch"></div></div>
        <div class="card"><div class="card-h"><h2>To deliver</h2><p>confirmed, not delivered yet</p></div>
          ${open.length ? `<table class="tbl"><tbody>${open.map((o) => `<tr><td><b>${esc(o.name)}</b><div class="psub">ordered ${fmt.dateShort(o.date)} · ${esc(c.delivery[o.di].name)}</div></td><td class="num">${o.lines.length} lines</td><td class="num">${fmt.eur0(o.total)}</td></tr>`).join("")}</tbody></table>`
            : `<div class="empty">Everything they ordered has been delivered.</div>`}
          <div class="card-h" style="margin-top:16px"><h2>Recent orders</h2></div>
          <table class="tbl"><tbody>${os.slice(-6).reverse().map((o) => `<tr><td><b>${esc(o.name)}</b><div class="psub">${fmt.date(o.date)}${c.delivery.length > 1 ? " · " + esc(c.delivery[o.di].name) : ""}</div></td>
            <td class="num">${o.lines.length} lines</td><td class="num">${fmt.eur0(o.total)}</td></tr>`).join("")}</tbody></table>
        </div>
      </div>

      <div class="card mt">
        <div class="card-h"><h2>What they buy</h2><p>${prods.length} products over two years</p></div>
        <div class="filters"><div class="seg" id="tabs"></div></div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Product</th><th>Last ordered</th><th>How often</th><th class="num">Usual qty</th><th class="num">Total spent</th><th>Status</th><th>Stock now</th></tr></thead><tbody id="tb"></tbody></table></div>
      </div>

      <div class="card mt"><div class="card-h"><h2>Similar shops also buy</h2><p>What other ${esc(c.kind.toLowerCase())} customers buy that ${esc(c.name)} never has</p></div><div id="sim"></div></div>`;

    // purchases by month
    const months = [];
    let y = +A.TODAY_ISO.slice(0, 4), m = +A.TODAY_ISO.slice(5, 7);
    for (let k = 0; k < 24; k++) { months.unshift(`${y}-${String(m).padStart(2, "0")}`); if (--m === 0) { m = 12; y--; } }
    const vals = new Array(24).fill(0), cnt = new Array(24).fill(0);
    const ix = new Map(months.map((x, i) => [x, i]));
    for (const o of os) { const k = ix.get(o.date.slice(0, 7)); if (k != null) { vals[k] += o.total; cnt[k]++; } }
    window.Charts.columns(el.querySelector("#ch"), {
      labels: months.map(fmt.month), tipLabels: months.map(fmt.monthYear),
      series: [{ name: "Purchases", values: vals, color: "var(--series-1)" }],
      format: (v, axis) => (axis ? fmt.eurK(v) : fmt.eur0(v)),
      tipExtra: (i) => `<div class="tip-row">Orders<b>${cnt[i]}</b></div>`, height: 220,
    });

    // what they buy
    const TABS = [["all", "All"], ["due", "Due & overdue"], ["stopped", "Stopped buying"], ["tried", "Tried once"], ["new", "New this year"]];
    const filt = {
      all: () => true, due: (r) => r.status === "Due" || r.status === "Overdue", stopped: (r) => r.status === "Stopped",
      tried: (r) => r.status === "Tried once", new: (r) => r.isNew,
    };
    const drawTable = () => {
      el.querySelector("#tabs").innerHTML = TABS.map(([k, v]) => `<button data-k="${k}" class="${st.tab === k ? "on" : ""}">${v} <small>${prods.filter(filt[k]).length}</small></button>`).join("");
      el.querySelectorAll("#tabs button").forEach((b) => b.addEventListener("click", () => { st.tab = b.dataset.k; drawTable(); }));
      const order = { Overdue: 0, Due: 1, Regular: 2, New: 3, "Tried once": 4, Stopped: 5 };
      const rows = prods.filter(filt[st.tab]).sort((a, b) => order[a.status] - order[b.status] || b.value - a.value);
      el.querySelector("#tb").innerHTML = rows.map((r) => {
        const p = A.P.get(r.pid);
        return `<tr><td>${A.productCell(p, r.isNew ? ` <span class="tag new">New in ${A.TODAY_ISO.slice(0, 4)}</span>` : "")}</td>
          <td class="nowrap">${fmt.date(A.isoOf(r.last))}<div class="psub">${fmt.ago(r.since)}</div></td>
          <td class="nowrap">${r.every ? "every ~" + r.every + " days" : "once"}<div class="psub">${r.count} order${r.count > 1 ? "s" : ""}</div></td>
          <td class="num">${fmt.num(r.avgQty)} u<div class="psub">${Math.round(r.avgQty / p.units_per_case)} cs</div></td>
          <td class="num">${fmt.eur0(r.value)}</td><td>${A.chip(r.status)}</td><td>${A.stockBadge(r.pid)}</td></tr>`;
      }).join("") || `<tr><td colspan="7" class="empty">Nothing here.</td></tr>`;
    };
    drawTable();

    const sim = similarAlsoBuy(c, have);
    el.querySelector("#sim").innerHTML = sim.length ? `<table class="tbl"><tbody>${sim.map((x) => `<tr><td>${A.productCell(x.p)}</td>
      <td>bought by <b>${x.n} of ${x.of}</b> similar customers</td><td>${A.stockBadge(x.p.id)}</td>
      <td class="num">${fmt.eur(A.PL.get(c.pricelist_id).priceOf.get(x.p.id) || x.p.list_price)} <small>/u</small></td></tr>`).join("")}</tbody></table>`
      : `<div class="empty">They already buy everything their peers buy.</div>`;

    el.querySelectorAll("#di button").forEach((b) => b.addEventListener("click", () => { st.di = b.dataset.i === "" ? null : +b.dataset.i; render(el, arg, {}); }));
  }

  A.views.customer = { title: "Customer profile", render };
})();
