/* Home: what a sales rep should look at this morning. */
(function () {
  "use strict";
  const A = window.App;
  const { D, fmt, esc, TODAY } = A;

  function render(el) {
    const me = A.me;
    const mine = D.customers.filter((c) => c.rep_id === me.id);
    const stats = mine.map((c) => ({ c, s: A.customerStats(c.id) }));
    const due = stats.filter((x) => x.s.status === "Due" || x.s.status === "Overdue")
      .sort((a, b) => b.s.rev12 - a.s.rev12);
    const backIn = (A.Restock ? A.Restock.list() : []).filter((r) => r.state === "waiting" && A.stockOf(r.pid).free >= r.qty);

    const arriving = D.purchases.filter((po) => po.eta && A.dayNum(po.eta) - TODAY <= 21 && A.dayNum(po.eta) >= TODAY)
      .sort((a, b) => a.eta.localeCompare(b.eta));
    let shortDated = [];
    for (const p of D.products) {
      const s = D.stock[p.id];
      for (const lot of (s && s.lots) || []) {
        const d = A.dayNum(lot[2]) - TODAY;
        if (d <= 60) shortDated.push({ p, lot, d });
      }
    }
    shortDated.sort((a, b) => a.d - b.d);
    const launches = D.products.filter((p) => TODAY - A.dayNum(p.launched) <= 120 && TODAY >= A.dayNum(p.launched))
      .sort((a, b) => b.launched.localeCompare(a.launched));

    // last 30 days, me vs the same 30 days last year
    const m0 = TODAY - 29;
    const ly0 = A.dayNum((+A.TODAY_ISO.slice(0, 4) - 1) + A.TODAY_ISO.slice(4)) - 29;
    const span = 29;
    const myIds = new Set(mine.map((c) => c.id));
    let mtd = 0, mtdLy = 0, ordersMtd = 0;
    for (const o of A.orders) {
      if (!myIds.has(o.cid)) continue;
      if (o.t >= m0 && o.t <= TODAY) { mtd += o.total; ordersMtd++; }
      if (o.t >= ly0 && o.t <= ly0 + span) mtdLy += o.total;
    }
    const hour = 9;
    const greet = hour < 12 ? "Good morning" : hour < 19 ? "Good afternoon" : "Good evening";

    el.innerHTML = `
      <section class="hello">
        <h1>${greet}, ${esc(me.name.split(" ")[0])}</h1>
        <p>${fmt.date(A.TODAY_ISO)} · ${mine.length} customers in ${esc(me.area)}. Stock and orders below are as Odoo had them at 07:00 today.</p>
        <svg class="waves" width="360" height="140" viewBox="0 0 360 140" aria-hidden="true">
          <path d="M0 90c40-30 80-30 120 0s80 30 120 0 80-30 120 0" stroke="#F76707" stroke-width="10" fill="none" stroke-linecap="round" opacity=".9"/>
          <path d="M0 122c40-30 80-30 120 0s80 30 120 0 80-30 120 0" stroke="#135D74" stroke-width="10" fill="none" stroke-linecap="round"/>
          <circle cx="290" cy="40" r="22" fill="#FBF3E4"/></svg>
      </section>

      <div class="grid g-main-side">
        <div class="card">
          <div class="card-h"><h2>Today</h2><p>The things worth a phone call</p></div>
          <div class="todo">
            ${backIn.length ? `<a href="#/restock"><span class="n">${backIn.length}</span><span><b>Restock request${backIn.length > 1 ? "s" : ""} back in stock</b>
              <small>${backIn.slice(0, 3).map((r) => esc(A.C.get(r.cid).name) + " — " + esc(A.P.get(r.pid).name)).join("<br>")}</small></span></a>` : ""}
            <a href="#/customer/${due[0] ? due[0].c.id : ""}"><span class="n">${due.length}</span><span><b>Customers due to reorder</b>
              <small>${due.slice(0, 4).map((x) => `${esc(x.c.name)} · last order ${fmt.ago(x.s.since)}, usually every ${x.s.interval} days`).join("<br>")}</small></span></a>
            <a href="#/stock"><span class="n">${arriving.length}</span><span><b>Shipments arriving in the next 3 weeks</b>
              <small>${arriving.slice(0, 4).map((po) => `${fmt.dateShort(po.eta)} · ${esc(po.supplier)} · ${po.lines.length} products`).join("<br>")}</small></span></a>
            <a href="#/dashboard"><span class="n">${shortDated.length}</span><span><b>Short-dated lots to sell first</b>
              <small>${shortDated.slice(0, 3).map((x) => `${esc(x.p.name)} · ${fmt.num(x.lot[1])} u best before ${fmt.dateShort(x.lot[2])}`).join("<br>")}</small></span></a>
            <a href="#/catalog?new=1"><span class="n">${launches.length}</span><span><b>New products to show customers</b>
              <small>${launches.slice(0, 3).map((p) => esc(p.name)).join("<br>")}</small></span></a>
          </div>
        </div>
        <div>
          <div class="tiles" style="grid-template-columns:1fr 1fr">
            <div class="tile"><div class="lab">My sales, last 30 days</div><div class="val">${fmt.eurK(mtd)}</div>
              <div class="delta ${mtd >= mtdLy ? "up" : "down"}">${mtdLy ? fmt.delta(mtd / mtdLy - 1) : ""} <small>vs same days last year</small></div></div>
            <div class="tile"><div class="lab">Orders, last 30 days</div><div class="val">${ordersMtd}</div><div class="delta"><small>${mine.length} customers</small></div></div>
          </div>
          <div class="card">
            <div class="card-h"><h2>Your biggest customers</h2><p>last 12 months</p></div>
            <div id="home-top"></div>
          </div>
        </div>
      </div>

      <h2 style="margin:26px 0 12px">Tools</h2>
      <div class="tools">
        ${tool("dashboard", "▤", "Dashboard", "Sales, margin, customers and stock health on one page. Prints as a monthly report.")}
        ${tool("stock", "▦", "Stock check", "Live stock and arrival dates for a customer's price list. Export to Excel.")}
        ${tool("customer", "☺", "Customer profile", "Before a visit or a call: what they buy, what's overdue, what they stopped buying.")}
        ${tool("reco", "✦", "Recommendations", "What to offer next, from what similar customers buy together.")}
        ${tool("restock", "⟳", "Restock requests", "Note what a customer is waiting for. Get told when it's back.")}
        ${tool("catalog", "▣", "Catalog builder", "Pick products, get a branded PDF catalogue in two minutes.")}
      </div>`;

    window.Charts.bars(el.querySelector("#home-top"),
      stats.sort((a, b) => b.s.rev12 - a.s.rev12).slice(0, 6).map((x) => ({
        label: x.c.name, value: x.s.rev12, href: "#/customer/" + x.c.id,
        sub: A.growth(x.s.rev12, x.s.revPrev).txt + (A.growth(x.s.rev12, x.s.revPrev).d != null ? " vs prior year" : ""),
      })), { format: fmt.eurK });
  }

  function tool(v, ic, h, p) {
    return `<a class="tool" href="#/${v}"><div class="ic">${ic}</div><h3>${h}</h3><p>${p}</p><span>Open →</span></a>`;
  }

  A.views.home = { title: "Home", render };
})();
