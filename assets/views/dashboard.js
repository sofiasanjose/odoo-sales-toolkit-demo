/* Dashboard: the owner's one-page view. Same numbers as Odoo's sales
 * reports, but put together the way a small distributor actually asks:
 * are we selling more, at what margin, to whom, and is the stock healthy? */
(function () {
  "use strict";
  const A = window.App;
  const { D, fmt, esc, TODAY } = A;

  const KIND_GROUP = {
    "Supermarket chain": "Chains & cash & carry", "Cash & carry": "Chains & cash & carry",
    "Asian supermarket": "Specialty shops", "Latin shop": "Specialty shops", "Asian shop": "Specialty shops",
    "Candy & soda store": "Specialty shops", "Independent grocery": "Specialty shops", "Portugal shop": "Specialty shops",
    Restaurant: "Restaurants", "Online shop": "Online shops", "Export distributor": "Export",
  };
  const PERIODS = { mtd: "Month to date", qtd: "Quarter to date", ytd: "Year to date", l12: "Last 12 months" };
  const state = { period: "ytd", rep: "", group: "" };

  const shiftYear = (iso, n) => (+iso.slice(0, 4) + n) + iso.slice(4);
  function range(period) {
    const y = A.TODAY_ISO.slice(0, 4), m = +A.TODAY_ISO.slice(5, 7);
    let a;
    if (period === "mtd") a = A.TODAY_ISO.slice(0, 8) + "01";
    else if (period === "qtd") a = `${y}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;
    else if (period === "ytd") a = `${y}-01-01`;
    else a = A.isoOf(TODAY - 364);
    return { a: A.dayNum(a), b: TODAY, la: A.dayNum(shiftYear(a, -1)), lb: A.dayNum(shiftYear(A.TODAY_ISO, -1)) };
  }

  function keep(o) {
    const c = A.C.get(o.cid);
    if (state.rep && c.rep_id !== +state.rep) return false;
    if (state.group && KIND_GROUP[c.kind] !== state.group) return false;
    return true;
  }

  function compute() {
    const r = range(state.period);
    const cur = [], prev = [];
    for (const o of A.orders) {
      if (!keep(o)) continue;
      if (o.t >= r.a && o.t <= r.b) cur.push(o);
      else if (o.t >= r.la && o.t <= r.lb) prev.push(o);
    }
    const sum = (xs, f) => xs.reduce((a, x) => a + f(x), 0);
    const k = (xs) => {
      const rev = sum(xs, (o) => o.total), cost = sum(xs, (o) => o.cost);
      const cust = new Set(xs.map((o) => o.cid));
      return { rev, margin: rev ? (rev - cost) / rev : 0, gp: rev - cost, n: xs.length, aov: xs.length ? rev / xs.length : 0, cust: cust.size };
    };
    const firstOrder = new Map();
    for (const [cid, os] of A.custOrders) firstOrder.set(cid, os[0].t);
    const newCust = new Set(cur.filter((o) => firstOrder.get(o.cid) >= r.a).map((o) => o.cid)).size;
    return { r, cur, prev, K: k(cur), KP: k(prev), newCust };
  }

  function monthly() {
    // 12 months ending this month, and the 12 before
    const ym = (t) => A.isoOf(t).slice(0, 7);
    const months = [];
    let y = +A.TODAY_ISO.slice(0, 4), m = +A.TODAY_ISO.slice(5, 7);
    for (let k = 0; k < 12; k++) {
      months.unshift(`${y}-${String(m).padStart(2, "0")}`);
      if (--m === 0) { m = 12; y--; }
    }
    const idx = new Map(months.map((x, i) => [x, i]));
    const cur = new Array(12).fill(0), prev = new Array(12).fill(0), gp = new Array(12).fill(0);
    for (const o of A.orders) {
      if (!keep(o)) continue;
      const key = ym(o.t);
      if (idx.has(key)) { cur[idx.get(key)] += o.total; gp[idx.get(key)] += o.total - o.cost; }
      const ly = shiftYear(key + "-01", 1).slice(0, 7);
      if (idx.has(ly)) prev[idx.get(ly)] += o.total;
    }
    return { months, cur, prev, gp };
  }

  function render(el) {
    const { r, cur, prev, K, KP, newCust } = compute();
    const mo = monthly();
    const dl = (a, b, upGood = true) => {
      if (!b) return `<div class="delta"><small>no prior-year data</small></div>`;
      const d = a / b - 1;
      return `<div class="delta ${(d >= 0) === upGood ? "up" : "down"}">${fmt.delta(d)} <small>vs last year</small></div>`;
    };
    const repOpts = D.reps.map((x) => `<option value="${x.id}" ${+state.rep === x.id ? "selected" : ""}>${esc(x.name)}</option>`).join("");
    const groups = [...new Set(Object.values(KIND_GROUP))];
    const pLabel = PERIODS[state.period];
    const rangeTxt = `${fmt.date(A.isoOf(r.a))} – ${fmt.date(A.isoOf(r.b))}`;

    el.innerHTML = `
      <div class="page-head">
        <div><h1>Dashboard</h1><p>${pLabel} · ${rangeTxt}, compared with the same days last year.</p></div>
        <div class="actions no-print"><button class="btn" id="csv">Export CSV</button><button class="btn primary" id="print">Print monthly report</button></div>
      </div>
      <div class="filters no-print">
        <div class="seg" id="period">${Object.entries(PERIODS).map(([k, v]) => `<button data-k="${k}" class="${state.period === k ? "on" : ""}">${v}</button>`).join("")}</div>
        <label>Sales rep <select id="rep"><option value="">Everyone</option>${repOpts}</select></label>
        <label>Customers <select id="group"><option value="">All</option>${groups.map((g) => `<option ${state.group === g ? "selected" : ""}>${g}</option>`).join("")}</select></label>
      </div>
      <div class="print-only" style="margin-bottom:8mm"><b>Puerto Sabor Foods · Sales report</b> · ${pLabel}, ${rangeTxt}${state.rep ? " · " + esc(A.REP.get(+state.rep).name) : ""}${state.group ? " · " + esc(state.group) : ""}</div>

      <div class="tiles">
        <div class="tile"><div class="lab">Revenue</div><div class="val">${fmt.eurK(K.rev)}</div>${dl(K.rev, KP.rev)}${window.Charts.spark(mo.cur)}</div>
        <div class="tile"><div class="lab">Gross margin</div><div class="val">${fmt.pct(K.margin, 1)}</div>
          <div class="delta ${K.margin >= KP.margin ? "up" : "down"}">${KP.rev ? (K.margin >= KP.margin ? "+" : "−") + Math.abs((K.margin - KP.margin) * 100).toFixed(1) + " pts" : ""} <small>${fmt.eurK(K.gp)} profit</small></div></div>
        <div class="tile"><div class="lab">Orders</div><div class="val">${fmt.num(K.n)}</div>${dl(K.n, KP.n)}</div>
        <div class="tile"><div class="lab">Average order</div><div class="val">${fmt.eur0(K.aov)}</div>${dl(K.aov, KP.aov)}</div>
        <div class="tile"><div class="lab">Customers who ordered</div><div class="val">${K.cust}</div><div class="delta"><small>${newCust} new · ${KP.cust} last year</small></div></div>
      </div>

      <div class="grid g-main-side">
        <div class="card">
          <div class="card-h"><h2>Revenue by month</h2><p>Last 12 months against the 12 before</p></div>
          <div id="ch-month" class="chart-box"></div>
        </div>
        <div class="card">
          <div class="card-h"><h2>By category</h2><p>${pLabel}</p></div>
          <div id="ch-cat"></div>
        </div>
      </div>

      <div class="grid g2 mt">
        <div class="card">
          <div class="card-h"><h2>Top customers</h2><p>${pLabel}</p><span class="right"><a href="#/customer">All customers →</a></span></div>
          <div class="tbl-wrap"><table class="tbl" id="t-cust"></table></div>
        </div>
        <div class="card">
          <div class="card-h"><h2>Top products</h2><p>${pLabel}</p></div>
          <div class="tbl-wrap"><table class="tbl" id="t-prod"></table></div>
        </div>
      </div>

      <div class="grid g3 mt">
        <div class="card"><div class="card-h"><h2>Stock health</h2><p>today, at cost</p></div><div id="stock-health"></div></div>
        <div class="card"><div class="card-h"><h2>Customers at risk</h2><p>big accounts gone quiet</p></div><div id="risk"></div></div>
        <div class="card"><div class="card-h"><h2>${state.rep ? "By customer type" : "By sales rep"}</h2><p>${pLabel}</p></div><div id="ch-rep"></div></div>
      </div>`;

    // ---- monthly chart
    window.Charts.columns(el.querySelector("#ch-month"), {
      labels: mo.months.map(fmt.month),
      tipLabels: mo.months.map(fmt.monthYear),
      series: [
        { name: "Previous year", values: mo.prev, color: "var(--series-1-soft)" },
        { name: "Last 12 months", values: mo.cur, color: "var(--series-1)" },
      ],
      format: (v, axis) => (axis ? fmt.eurK(v) : fmt.eur0(v)),
      tipExtra: (i) => {
        const d = mo.prev[i] ? fmt.delta(mo.cur[i] / mo.prev[i] - 1) : "—";
        const part = i === 11 ? `<div class="tip-row" style="opacity:.7">Month in progress</div>` : "";
        return `<div class="tip-row">Change<b>${d}</b></div><div class="tip-row">Gross margin<b>${mo.cur[i] ? fmt.pct(mo.gp[i] / mo.cur[i], 1) : "—"}</b></div>${part}`;
      },
      height: 250, aria: "Revenue by month",
    });

    // ---- categories
    const cat = new Map(), catPrev = new Map();
    const addLines = (os, map) => {
      for (const o of os) for (const li of o.lines) {
        const l = A.L[li], c = A.P.get(l[1]).category;
        map.set(c, (map.get(c) || 0) + A.lineValue(l));
      }
    };
    addLines(cur, cat); addLines(prev, catPrev);
    window.Charts.bars(el.querySelector("#ch-cat"), [...cat.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({
      label: k, value: v, sub: catPrev.get(k) ? fmt.delta(v / catPrev.get(k) - 1) : "",
    })), { format: fmt.eurK });

    // ---- customers
    const byC = new Map(), byCp = new Map();
    for (const o of cur) { const x = byC.get(o.cid) || { rev: 0, cost: 0, n: 0 }; x.rev += o.total; x.cost += o.cost; x.n++; byC.set(o.cid, x); }
    for (const o of prev) byCp.set(o.cid, (byCp.get(o.cid) || 0) + o.total);
    const topC = [...byC.entries()].sort((a, b) => b[1].rev - a[1].rev).slice(0, 10);
    el.querySelector("#t-cust").innerHTML = `<thead><tr><th>Customer</th><th class="num">Revenue</th><th class="num">vs LY</th><th class="num">Margin</th><th>Status</th></tr></thead><tbody>${
      topC.map(([cid, x]) => {
        const c = A.C.get(cid), s = A.customerStats(cid), p = byCp.get(cid);
        return `<tr class="click" data-href="#/customer/${cid}"><td><b>${esc(c.name)}</b><div class="psub">${esc(c.kind)} · ${esc(c.city)}</div></td>
          <td class="num">${fmt.eur0(x.rev)}</td><td class="num ${A.growth(x.rev, p).cls}">${A.growth(x.rev, p).txt}</td>
          <td class="num">${fmt.pct((x.rev - x.cost) / x.rev, 1)}</td><td>${A.chip(s.status)}</td></tr>`;
      }).join("")}</tbody>`;

    // ---- products
    const byP = new Map();
    for (const o of cur) for (const li of o.lines) {
      const l = A.L[li]; const x = byP.get(l[1]) || { q: 0, rev: 0 };
      x.q += l[2]; x.rev += A.lineValue(l); byP.set(l[1], x);
    }
    const topP = [...byP.entries()].sort((a, b) => b[1].rev - a[1].rev).slice(0, 10);
    el.querySelector("#t-prod").innerHTML = `<thead><tr><th>Product</th><th class="num">Units</th><th class="num">Revenue</th><th class="num">Margin</th><th>Stock now</th></tr></thead><tbody>${
      topP.map(([pid, x]) => {
        const p = A.P.get(pid);
        return `<tr><td>${A.productCell(p)}</td><td class="num">${fmt.num(x.q)}</td><td class="num">${fmt.eur0(x.rev)}</td>
          <td class="num">${fmt.pct(1 - (x.q * p.cost) / x.rev, 1)}</td><td>${A.stockBadge(pid)}</td></tr>`;
      }).join("")}</tbody>`;

    // ---- stock health
    let value = 0, outN = 0, lostWeek = 0, shortV = 0, shortN = 0, overV = 0, incV = 0;
    for (const p of D.products) {
      if (!p.active) continue;
      const s = A.stockOf(p.id);
      value += s.on_hand * p.cost;
      incV += s.incomingQty * p.cost;
      if (s.status === "out" && s.perDay > 0) { outN++; lostWeek += s.perDay * 7 * p.list_price; }
      if (s.status === "over") overV += Math.max(0, s.on_hand - s.perDay * 90) * p.cost;
      for (const lot of s.lots) if (A.dayNum(lot[2]) - TODAY <= 60) { shortV += lot[1] * p.cost; shortN++; }
    }
    el.querySelector("#stock-health").innerHTML = `<div class="todo">
      <a href="#/stock"><span class="n" style="min-width:74px">${fmt.eurK(value)}</span><span><b>Stock on hand</b><small>${fmt.eurK(incV)} more on the water</small></span></a>
      <a href="#/stock?only=out"><span class="n" style="min-width:74px;background:var(--bad-bg);color:var(--bad-ink)">${outN}</span><span><b>Selling products out of stock</b><small>≈ ${fmt.eurK(lostWeek)} of orders a week at risk</small></span></a>
      <a href="#/stock?only=short"><span class="n" style="min-width:74px;background:var(--warn-bg);color:var(--warn-ink)">${fmt.eurK(shortV)}</span><span><b>Best before in under 60 days</b><small>${shortN} lots: offer them first, or promote</small></span></a>
      <a href="#/stock?only=over"><span class="n" style="min-width:74px;background:var(--info-bg);color:var(--info-ink)">${fmt.eurK(overV)}</span><span><b>Cash tied up in overstock</b><small>stock beyond 3 months of sales</small></span></a></div>`;

    // ---- at risk
    const risk = D.customers.map((c) => ({ c, s: A.customerStats(c.id) }))
      .filter((x) => (x.s.status === "Overdue" || (x.s.status === "Stopped" && x.s.since <= 365)) && keep({ cid: x.c.id }))
      .map((x) => ({ ...x, value: x.s.status === "Stopped" ? x.s.revPrev + x.s.rev12 : x.s.rev12 }))
      .sort((a, b) => b.value - a.value).slice(0, 6);
    el.querySelector("#risk").innerHTML = risk.length ? `<div class="todo">${risk.map((x) => `
      <a href="#/customer/${x.c.id}"><span class="n" style="min-width:74px">${fmt.eurK(x.value)}</span><span><b>${esc(x.c.name)}</b>
      <small>${A.chip(x.s.status)} last order ${fmt.ago(x.s.since)} · usually every ${x.s.interval} days</small></span></a>`).join("")}</div>`
      : `<div class="empty">Nobody important has gone quiet.</div>`;

    // ---- by rep / by type
    const by = new Map();
    for (const o of cur) {
      const c = A.C.get(o.cid);
      const key = state.rep ? KIND_GROUP[c.kind] : A.REP.get(c.rep_id).name;
      by.set(key, (by.get(key) || 0) + o.total);
    }
    window.Charts.bars(el.querySelector("#ch-rep"), [...by.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({
      label: k, value: v, sub: fmt.pct(v / (K.rev || 1)) + " of total",
    })), { format: fmt.eurK });

    // ---- events
    el.querySelectorAll("#period button").forEach((b) => b.addEventListener("click", () => { state.period = b.dataset.k; render(el); }));
    el.querySelector("#rep").addEventListener("change", (e) => { state.rep = e.target.value; render(el); });
    el.querySelector("#group").addEventListener("change", (e) => { state.group = e.target.value; render(el); });
    el.querySelectorAll("tr[data-href]").forEach((tr) => tr.addEventListener("click", () => (location.hash = tr.dataset.href)));
    el.querySelector("#print").addEventListener("click", () => {
      document.body.classList.add("printing-report");
      window.print();
      setTimeout(() => document.body.classList.remove("printing-report"), 500);
    });
    el.querySelector("#csv").addEventListener("click", () => {
      const rows = [["Month", "Revenue last 12 months", "Revenue previous year", "Gross profit"]];
      mo.months.forEach((m, i) => rows.push([m, mo.cur[i].toFixed(2), mo.prev[i].toFixed(2), mo.gp[i].toFixed(2)]));
      rows.push([]);
      rows.push(["Customer", "Kind", "City", "Revenue", "Revenue last year", "Orders"]);
      [...byC.entries()].sort((a, b) => b[1].rev - a[1].rev).forEach(([cid, x]) => {
        const c = A.C.get(cid);
        rows.push([c.name, c.kind, c.city, x.rev.toFixed(2), (byCp.get(cid) || 0).toFixed(2), x.n]);
      });
      A.downloadCSV(`sales-${state.period}-${A.TODAY_ISO}.csv`, rows);
    });
  }

  A.views.dashboard = { title: "Dashboard", render };
})();
