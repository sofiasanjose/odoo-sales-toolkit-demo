/* Core: data model built from the Odoo snapshot, formatting, router.
 *
 * window.DEMO has the same shape odoo_sync.py writes from a real Odoo
 * database. Everything below works on that snapshot in the browser: no server,
 * nothing to install, and it keeps working on a sales rep's laptop offline. */
(function () {
  "use strict";
  const D = window.DEMO;
  const DAY = 86400000;
  const dayNum = (iso) => Math.floor(Date.parse(iso + "T12:00:00Z") / DAY);
  const TODAY_ISO = D.meta.today;
  const TODAY = dayNum(TODAY_ISO);

  // ------------------------------------------------------------ indexes
  const P = new Map(D.products.map((p) => [p.id, p]));
  const bySku = new Map(D.products.map((p) => [p.sku, p]));
  const C = new Map(D.customers.map((c) => [c.id, c]));
  const PL = new Map(D.pricelists.map((pl) => [pl.id, pl]));
  const REP = new Map(D.reps.map((r) => [r.id, r]));
  for (const pl of D.pricelists) pl.priceOf = new Map(pl.items);

  const orders = D.orders.map((o, i) => ({
    i, name: o[0], cid: o[1], date: o[2], t: dayNum(o[2]), state: o[3], di: o[4],
    delivered: o[5], total: 0, cost: 0, lines: [],
  }));
  const L = D.lines; // [orderIdx, productId, qty, priceUnit, discount%]
  const custOrders = new Map();
  const prodLines = new Map();
  L.forEach((l, li) => {
    const o = orders[l[0]];
    const p = P.get(l[1]);
    const v = l[2] * l[3] * (1 - l[4] / 100);
    o.total += v;
    o.cost += l[2] * p.cost;
    o.lines.push(li);
    if (!prodLines.has(l[1])) prodLines.set(l[1], []);
    prodLines.get(l[1]).push(li);
  });
  for (const o of orders) {
    if (!custOrders.has(o.cid)) custOrders.set(o.cid, []);
    custOrders.get(o.cid).push(o);
  }
  for (const list of custOrders.values()) list.sort((a, b) => a.t - b.t);

  const lineValue = (l) => l[2] * l[3] * (1 - l[4] / 100);

  // ------------------------------------------------------------ stock
  const incomingOf = new Map();
  for (const po of D.purchases) {
    for (const [pid, qty] of po.lines) {
      if (!incomingOf.has(pid)) incomingOf.set(pid, []);
      incomingOf.get(pid).push({ po: po.name, qty, eta: po.eta, state: po.state, supplier: po.supplier, note: po.note });
    }
  }
  for (const list of incomingOf.values()) list.sort((a, b) => (a.eta || "9999").localeCompare(b.eta || "9999"));

  const demandCache = new Map();
  /** average units per day over the last `days` days */
  function dailyDemand(pid, days = 90) {
    const key = pid + ":" + days;
    if (demandCache.has(key)) return demandCache.get(key);
    let q = 0;
    for (const li of prodLines.get(pid) || []) {
      const l = L[li];
      if (TODAY - orders[l[0]].t <= days) q += l[2];
    }
    const v = q / days;
    demandCache.set(key, v);
    return v;
  }

  function stockOf(pid) {
    const s = D.stock[pid] || { on_hand: 0, reserved: 0, lots: [] };
    const p = P.get(pid);
    const free = s.on_hand - s.reserved;
    const inc = incomingOf.get(pid) || [];
    const incomingQty = inc.reduce((a, x) => a + x.qty, 0);
    const next = inc.find((x) => x.eta) || inc[0] || null;
    const perDay = dailyDemand(pid);
    const coverDays = perDay > 0 ? free / perDay : free > 0 ? 999 : 0;
    let status = "ok";
    if (!p.active) status = "archived";
    else if (free <= 0) status = "out";
    else if (coverDays < 14) status = "low";
    else if (coverDays > 150) status = "over";
    return { ...s, free, incoming: inc, incomingQty, next, perDay, coverDays, status };
  }

  // ------------------------------------------------------------ customers
  const median = (arr) => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  function customerStats(cid) {
    const os = custOrders.get(cid) || [];
    const recent = os.filter((o) => TODAY - o.t <= 365);
    const prev = os.filter((o) => TODAY - o.t > 365 && TODAY - o.t <= 730);
    const gaps = [];
    for (let k = 1; k < recent.length; k++) gaps.push(recent[k].t - recent[k - 1].t);
    const interval = median(gaps) || median(os.slice(1).map((o, k) => o.t - os[k].t)) || 30;
    const last = os[os.length - 1];
    const since = last ? TODAY - last.t : null;
    let status = "Active";
    if (!last) status = "No orders";
    else if (since > Math.max(75, interval * 4)) status = "Stopped";
    else if (since > interval * 1.6) status = "Overdue";
    else if (since >= interval * 0.9) status = "Due";
    const sum = (xs, f) => xs.reduce((a, o) => a + f(o), 0);
    return {
      orders: os, recent, last, since, interval: Math.round(interval), status,
      rev12: sum(recent, (o) => o.total), revPrev: sum(prev, (o) => o.total),
      margin12: sum(recent, (o) => o.total - o.cost),
      nextDue: last ? last.t + Math.round(interval) : null,
    };
  }

  /** growth vs the prior year, or "new" when there was hardly a prior year */
  function growth(cur, prev) {
    if (!prev || prev < cur * 0.2) return { txt: "new account", cls: "" };
    const d = cur / prev - 1;
    return { txt: fmt.delta(d), cls: d < 0 ? "neg" : "pos", d };
  }

  /** what a customer buys, one row per product */
  function customerProducts(cid, deliveryIdx = null) {
    const rows = new Map();
    for (const o of custOrders.get(cid) || []) {
      if (deliveryIdx != null && o.di !== deliveryIdx) continue;
      for (const li of o.lines) {
        const l = L[li];
        let r = rows.get(l[1]);
        if (!r) rows.set(l[1], (r = { pid: l[1], dates: [], qty: 0, value: 0, lastQty: 0, open: 0 }));
        if (r.dates[r.dates.length - 1] !== o.t) r.dates.push(o.t);
        r.qty += l[2];
        r.value += lineValue(l);
        r.lastQty = l[2];
        if (o.state === "sale") r.open += l[2];
      }
    }
    const out = [];
    for (const r of rows.values()) {
      const gaps = r.dates.slice(1).map((t, k) => t - r.dates[k]);
      r.first = r.dates[0];
      r.last = r.dates[r.dates.length - 1];
      r.count = r.dates.length;
      // mean gap: a product is not in every order, so the median understates the rhythm
      r.every = gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null;
      r.since = TODAY - r.last;
      r.avgQty = Math.round(r.qty / r.count);
      if (r.count === 1) r.status = r.since > 60 ? "Tried once" : "New";
      else if (r.since > Math.max(r.every * 5, 120)) r.status = "Stopped";
      else if (r.since > Math.max(r.every * 2.5, r.every + 21)) r.status = "Overdue";
      else if (r.since >= r.every * 1.4) r.status = "Due";
      else r.status = "Regular";
      r.isNew = r.first >= dayNum(TODAY_ISO.slice(0, 4) + "-01-01");
      out.push(r);
    }
    return out;
  }

  // ------------------------------------------------------------ formatting
  const eur = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" });
  const eur0 = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  const num = new Intl.NumberFormat("en-IE");
  const fmt = {
    eur: (v) => eur.format(v),
    eur0: (v) => eur0.format(v),
    eurK: (v) => {
      const a = Math.abs(v);
      if (a >= 1e6) return "€" + (v / 1e6).toFixed(a >= 1e7 ? 1 : 2) + "M";
      if (a >= 1e4) return "€" + Math.round(v / 1e3) + "K";
      if (a >= 1e3) return "€" + (v / 1e3).toFixed(1) + "K";
      return eur0.format(v);
    },
    num: (v) => num.format(Math.round(v)),
    pct: (v, d = 0) => (v * 100).toFixed(d) + "%",
    delta: (v) => (v >= 0 ? "+" : "−") + Math.abs(v * 100).toFixed(1) + "%",
    date: (iso) => {
      if (!iso) return "—";
      const d = new Date(iso + "T12:00:00Z");
      return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
    },
    dateShort: (iso) => {
      if (!iso) return "—";
      const d = new Date(iso + "T12:00:00Z");
      return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
    },
    ago: (days) => {
      if (days == null) return "never";
      if (days <= 0) return "today";
      if (days === 1) return "yesterday";
      if (days < 14) return days + " days ago";
      if (days < 60) return Math.round(days / 7) + " weeks ago";
      if (days < 365) return Math.round(days / 30.4) + " months ago";
      const y = days / 365;
      return (y < 1.5 ? "a year" : Math.round(y) + " years") + " ago";
    },
    inDays: (days) => (days <= 0 ? "today" : days === 1 ? "tomorrow" : "in " + days + " days"),
    month: (ym) => {
      const d = new Date(ym + "-15T12:00:00Z");
      return d.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
    },
    monthYear: (ym) => {
      const d = new Date(ym + "-15T12:00:00Z");
      return d.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
    },
  };
  const isoOf = (t) => new Date(t * DAY).toISOString().slice(0, 10);

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  /** words-anywhere search across name, brand, SKU, EAN */
  function matches(p, q) {
    if (!q) return true;
    const hay = norm([p.name, p.brand, p.sku, p.ean, p.subcategory, p.origin].join(" "));
    return norm(q).split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
  }

  const FLAG = { Mexico: "🇲🇽", "United States": "🇺🇸", Japan: "🇯🇵", "South Korea": "🇰🇷", Thailand: "🇹🇭", Peru: "🇵🇪", Brazil: "🇧🇷", Colombia: "🇨🇴", India: "🇮🇳", "United Kingdom": "🇬🇧", Spain: "🇪🇸", ES: "🇪🇸", PT: "🇵🇹", DE: "🇩🇪", FR: "🇫🇷", NL: "🇳🇱", BE: "🇧🇪" };

  // ------------------------------------------------------------ small UI helpers
  const STATUS_CHIP = {
    ok: ["In stock", "good"], low: ["Running low", "warn"], out: ["Out of stock", "bad"], over: ["Overstocked", "info"], archived: ["Discontinued", "muted"],
    Regular: ["Regular", "good"], Due: ["Due to reorder", "warn"], Overdue: ["Overdue", "serious"], Stopped: ["Stopped buying", "bad"],
    "Tried once": ["Tried once", "muted"], New: ["New", "info"], Active: ["Active", "good"], "No orders": ["No orders", "muted"],
  };
  const ICON = { good: "●", warn: "▲", serious: "◆", bad: "■", info: "★", muted: "○" };
  function chip(key, label) {
    const [txt, tone] = STATUS_CHIP[key] || [key, "muted"];
    return `<span class="chip chip-${tone}"><i aria-hidden="true">${ICON[tone]}</i>${esc(label || txt)}</span>`;
  }

  function productCell(p, extra = "") {
    return `<div class="pcell">${window.Packshot.svg(p, 44)}<div><div class="pname">${esc(p.name)}</div>
      <div class="psub">SKU ${esc(p.sku)} · ${esc(p.units_per_case)}/case${extra}</div></div></div>`;
  }

  function stockBadge(pid) {
    const s = stockOf(pid);
    if (s.status === "out") {
      const n = s.next;
      return chip("out", n && n.eta ? "Out · back " + fmt.dateShort(n.eta) : "Out of stock");
    }
    return chip(s.status);
  }

  function downloadCSV(filename, rows) {
    const csv = rows.map((r) => r.map((v) => {
      const s = String(v == null ? "" : v);
      return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(",")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function toast(msg) {
    let t = document.getElementById("toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "toast";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove("show"), 2600);
  }

  // ------------------------------------------------------------ router
  const views = {};
  function parseHash() {
    const h = location.hash.replace(/^#\/?/, "") || "home";
    const [path, qs] = h.split("?");
    const parts = path.split("/");
    const params = Object.fromEntries(new URLSearchParams(qs || ""));
    return { view: parts[0] || "home", arg: parts[1], params };
  }
  function go(view, arg, params) {
    let h = "#/" + view + (arg != null ? "/" + arg : "");
    if (params) {
      const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== "")).toString();
      if (qs) h += "?" + qs;
    }
    location.hash = h;
  }
  function render() {
    const r = parseHash();
    const v = views[r.view] || views.home;
    const main = document.getElementById("main");
    document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.view === r.view));
    document.title = (v.title || "") + " · Puerto Sabor Sales Toolkit";
    main.innerHTML = "";
    main.scrollTop = 0;
    window.scrollTo(0, 0);
    v.render(main, r.arg, r.params);
    document.body.classList.remove("nav-open");
  }
  window.addEventListener("hashchange", render);

  window.App = {
    D, P, C, PL, REP, bySku, orders, L, custOrders, prodLines, TODAY, TODAY_ISO, DAY,
    dayNum, isoOf, lineValue, growth, stockOf, dailyDemand, incomingOf, customerStats, customerProducts, median,
    fmt, esc, norm, matches, FLAG, chip, productCell, stockBadge, downloadCSV, toast,
    views, go, render, parseHash,
    me: D.reps[0],
  };
})();
