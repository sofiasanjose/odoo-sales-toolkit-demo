/* How it works: the page to show a business owner (and a reviewer). */
(function () {
  "use strict";
  const A = window.App;
  const { D, fmt } = A;

  function render(el) {
    const n = D.orders.length, l = D.lines.length;
    el.innerHTML = `
      <div class="page-head"><div><h1>How it works</h1><p>One idea: the data already lives in Odoo. The toolkit puts it in front of the people who sell, in the shape they need.</p></div></div>

      <div class="flow">
        <div class="step"><span class="k">1 · Source</span><b>Odoo</b><p>Products, pack sizes, barcodes, price lists, customers, sales orders, stock lots and purchase orders. Nothing is typed twice.</p></div>
        <div class="step"><span class="k">2 · Sync</span><b>Read-only connector</b><p><code>odoo_sync.py</code> logs in with a read-only API user and pulls only what the tools need, every night and on demand.</p></div>
        <div class="step"><span class="k">3 · Snapshot</span><b>One data file</b><p>Cleaned, joined and stamped with the time it was read. Brands and categories derived from Odoo fields.</p></div>
        <div class="step"><span class="k">4 · Tools</span><b>Web app</b><p>Plain HTML and JavaScript. Opens in any browser, on a laptop or a phone, with no installs and no licence per user.</p></div>
        <div class="step"><span class="k">5 · Output</span><b>PDFs, Excel, alerts</b><p>Branded catalogues, stock lists to send a customer, a printable monthly report, restock alerts.</p></div>
      </div>

      <div class="grid g2 mt">
        <div class="card prose">
          <h2 style="margin-top:0">What each tool answers</h2>
          <ul>
            <li><b>Dashboard</b>: are we selling more than last year, at what margin, to whom? Which big customers went quiet? How much cash is stuck in stock?</li>
            <li><b>Stock check</b>: can I promise this customer their usual order? If not, when does it land?</li>
            <li><b>Customer profile</b>: before I call them: what do they buy, how often, what's overdue, what did they stop buying?</li>
            <li><b>Recommendations</b>: what should I offer them next, based on what similar customers buy together?</li>
            <li><b>Restock requests</b>: who's waiting for what, and tell me when it's back.</li>
            <li><b>Catalog builder</b>: a professional PDF catalogue for one customer in two minutes instead of an afternoon in PowerPoint.</li>
          </ul>
          <h2>Design rules</h2>
          <ul>
            <li><b>Odoo stays the single source of truth.</b> The toolkit only reads, so it can never break the ERP.</li>
            <li><b>Plain language.</b> “Free to use”, “Due to reorder”, “Stopped buying”, not field names.</li>
            <li><b>Status is never colour alone.</b> Every chip has an icon and a word, so it works printed in black and white and for colour-blind users.</li>
            <li><b>Customer-facing output is conservative.</b> Prices are off unless switched on, then come from that customer's own price list. Nothing that dates fast goes on a PDF by default.</li>
          </ul>
        </div>
        <div class="card prose">
          <h2 style="margin-top:0">About this demo</h2>
          <p>I built the full working version of this toolkit for the company I currently work at, running on the company's live Odoo data. That data is confidential, so for this public copy I replaced it with <b>made-up data</b>: a fictional company, Puerto Sabor Foods, with a simulated Odoo database:</p>
          <ul>
            <li>${D.products.length} products from ${new Set(D.products.map((p) => p.origin)).size} countries with pack sizes, EANs, costs and shelf lives</li>
            <li>${D.customers.length} customers of 11 kinds, ${D.pricelists.length} price lists, ${D.reps.length} sales reps</li>
            <li>${fmt.num(n)} sales orders and ${fmt.num(l)} order lines over two years, with seasonality (summer drinks, Halloween candy, quiet Augusts), growth, churn and new launches</li>
            <li>Stock lots with best-before dates, reservations and ${D.purchases.length} inbound containers with ETAs</li>
          </ul>
          <p>Barcodes use the GS1 in-store range, so none of them can collide with a real product. The generator is <code>tools/generate_demo_data.py</code>; the real connector is <code>tools/odoo_sync.py</code>, which writes the same file from a live Odoo.</p>
          <h2>Taking it further for a client</h2>
          <ol>
            <li><b>Write back, carefully.</b> Turn a restock request or a recommendation into a draft quotation in Odoo with one click.</li>
            <li><b>Push, don't pull.</b> A Monday email per rep: customers due this week, what's back in stock, short-dated lots to sell.</li>
            <li><b>Forecast purchasing.</b> The same order history predicts when each product runs out, so the buyer gets a draft purchase order before a container is late.</li>
            <li><b>Customer portal.</b> Let shops see their own catalogue, stock and reorder in one click.</li>
            <li><b>AI where it earns its keep.</b> Write a customer email from the profile, or answer “what should I bring to the Valdés meeting?” in plain language.</li>
          </ol>
        </div>
      </div>`;
  }

  A.views.about = { title: "How it works", render };
})();
