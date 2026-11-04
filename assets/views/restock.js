/* Restock requests: "tell me when it's back".
 * A rep notes what a customer is waiting for; every time stock is synced the
 * list is checked and anything now free to sell lights up (badge in the menu,
 * line on the home page). Kept in the rep's browser, like a personal list. */
(function () {
  "use strict";
  const A = window.App;
  const { D, fmt, esc, TODAY } = A;
  const KEY = "ps.restock.v1";

  function seed() {
    // a believable starting list: things that ran out, some of which are back
    const out = D.products.filter((p) => p.active && A.stockOf(p.id).status === "out");
    const okNow = D.products.filter((p) => p.active && A.stockOf(p.id).free > p.units_per_case * 20);
    const pickBuyer = (pid) => {
      for (const [cid, os] of A.custOrders) {
        if (A.C.get(cid).rep_id !== A.me.id) continue;
        if (os.some((o) => o.lines.some((li) => A.L[li][1] === pid))) return cid;
      }
      return D.customers.find((c) => c.rep_id === A.me.id).id;
    };
    const mk = (p, daysAgo, cases, note, state = "waiting") => ({
      id: Math.random().toString(36).slice(2, 9), pid: p.id, cid: pickBuyer(p.id), qty: cases * p.units_per_case,
      note, state, created: A.isoOf(TODAY - daysAgo),
    });
    const list = [];
    if (out[0]) list.push(mk(out[0], 6, 4, "Wants it for the weekend promo"));
    if (out[1]) list.push(mk(out[1], 12, 2, "Asked twice, call when it lands"));
    if (out[2]) list.push(mk(out[2], 3, 6, ""));
    if (okNow[3]) list.push(mk(okNow[3], 15, 3, "Was out mid-October"));
    if (okNow[9]) list.push(mk(okNow[9], 9, 5, "Full layer if possible"));
    if (okNow[14]) list.push(mk(okNow[14], 24, 2, "", "told"));
    return list;
  }

  function list() {
    let l = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!l) { l = seed(); save(l); }
    return l;
  }
  function save(l) {
    localStorage.setItem(KEY, JSON.stringify(l));
    badge();
  }
  function badge() {
    const n = JSON.parse(localStorage.getItem(KEY) || "[]").filter((r) => r.state === "waiting" && A.stockOf(r.pid).free >= r.qty).length;
    const b = document.getElementById("restock-badge");
    if (b) { b.hidden = !n; b.textContent = n; }
  }

  function render(el) {
    const l = list();
    const optsP = D.products.filter((p) => p.active).map((p) => `<option value="${esc(p.sku)} — ${esc(p.name)}">`).join("");
    const optsC = D.customers.filter((c) => c.rep_id === A.me.id).concat(D.customers.filter((c) => c.rep_id !== A.me.id))
      .map((c) => `<option value="${c.id}">${esc(c.name)} · ${esc(c.city)}</option>`).join("");

    const rows = l.map((r) => {
      const p = A.P.get(r.pid), c = A.C.get(r.cid), s = A.stockOf(r.pid);
      const back = s.free >= r.qty;
      let status;
      if (r.state === "handled") status = A.chip("Tried once", "Handled");
      else if (r.state === "told") status = A.chip("New", "Told client");
      else if (back) status = A.chip("ok", "Back in stock");
      else if (s.next && s.next.eta) status = A.chip("Due", "Waiting · ETA " + fmt.dateShort(s.next.eta));
      else status = A.chip("out", "Waiting · no date");
      return { r, p, c, s, back, status };
    }).sort((a, b) => (b.back && b.r.state === "waiting") - (a.back && a.r.state === "waiting") || a.r.state.localeCompare(b.r.state) || b.r.created.localeCompare(a.r.created));

    el.innerHTML = `
      <div class="page-head"><div><h1>Restock requests</h1><p>Note what a customer is waiting for. When the stock sync finds it free to sell, it shows here, on Home and in the menu.</p></div>
        <div class="actions"><button class="btn" id="check">Check now</button></div></div>
      <div class="grid" style="grid-template-columns:minmax(0,1fr) 290px;align-items:start">
        <div class="card">
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Product</th><th>Customer</th><th class="num">Needs</th><th class="num">Free now</th><th>Status</th><th></th></tr></thead>
          <tbody>${rows.map(({ r, p, c, s, back, status }) => `<tr ${back && r.state === "waiting" ? 'style="background:#F3FBF3"' : ""}>
            <td>${A.productCell(p)}${r.note ? `<div class="psub" style="margin:4px 0 0 54px">“${esc(r.note)}”</div>` : ""}</td>
            <td><a href="#/customer/${c.id}">${esc(c.name)}</a><div class="psub">asked ${fmt.ago(TODAY - A.dayNum(r.created))}</div></td>
            <td class="num">${fmt.num(r.qty)} u<div class="psub">${r.qty / p.units_per_case} cs</div></td>
            <td class="num">${fmt.num(Math.max(0, s.free))}</td><td>${status}</td>
            <td class="nowrap">${r.state === "waiting" && back ? `<button class="btn small primary" data-act="told" data-id="${r.id}">Told client</button>` : ""}
              ${r.state !== "handled" ? `<button class="btn small" data-act="handled" data-id="${r.id}">Done</button>` : `<button class="btn small" data-act="del" data-id="${r.id}">Remove</button>`}</td></tr>`).join("")
            || `<tr><td colspan="6" class="empty">No requests yet</td></tr>`}</tbody></table></div>
        </div>
        <div class="card">
          <div class="card-h"><h2>Add a request</h2></div>
          <form id="f">
            <label class="form-row"><span>Customer</span><select name="cid" required>${optsC}</select></label>
            <label class="form-row"><span>Product (SKU or name)</span><input name="p" list="plist" required placeholder="e.g. 31051 or fire noodles"><datalist id="plist">${optsP}</datalist></label>
            <label class="form-row"><span>Cases needed</span><input name="cases" type="number" min="1" value="2" required></label>
            <label class="form-row"><span>Notes</span><input name="note" type="text" placeholder="optional"></label>
            <button class="btn primary">Add request</button>
            <p class="psub" id="msg" style="margin-top:8px"></p>
          </form>
        </div>
      </div>`;

    el.querySelector("#f").addEventListener("submit", (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const txt = String(f.get("p")).trim();
      const sku = txt.split(/\s/)[0];
      const p = A.bySku.get(sku) || D.products.find((x) => A.matches(x, txt));
      if (!p) { el.querySelector("#msg").textContent = "No product with that SKU or name."; return; }
      const l2 = list();
      l2.unshift({ id: Math.random().toString(36).slice(2, 9), pid: p.id, cid: +f.get("cid"), qty: +f.get("cases") * p.units_per_case, note: String(f.get("note") || ""), state: "waiting", created: A.TODAY_ISO });
      save(l2);
      A.toast("Added: " + p.name);
      render(el);
    });
    el.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => {
      let l2 = list();
      const r = l2.find((x) => x.id === b.dataset.id);
      if (b.dataset.act === "del") l2 = l2.filter((x) => x !== r);
      else r.state = b.dataset.act;
      save(l2);
      render(el);
    }));
    el.querySelector("#check").addEventListener("click", () => {
      const n = list().filter((r) => r.state === "waiting" && A.stockOf(r.pid).free >= r.qty).length;
      A.toast(n ? `${n} request${n > 1 ? "s are" : " is"} back in stock` : "Nothing new in stock yet");
    });
  }

  A.Restock = { list, badge };
  A.views.restock = { title: "Restock requests", render };
  setTimeout(() => { list(); badge(); }, 0);
})();
