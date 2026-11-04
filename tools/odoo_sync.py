#!/usr/bin/env python3
"""
Odoo -> Sales Toolkit sync.

Reads a live Odoo database through its external API (XML-RPC, works with
Odoo 15-18, Community or Enterprise) and writes `data/demo-data.js`, the one
file the web app reads. The demo generator writes exactly the same shape, so
the app cannot tell real data from simulated.

It only ever *reads*. Give it a dedicated Odoo user with read-only access to
Sales, Inventory and Purchase, and an API key (Preferences -> Account
Security -> New API Key). Credentials come from the environment, never from
the code:

    export ODOO_URL=https://yourcompany.odoo.com
    export ODOO_DB=yourcompany
    export ODOO_USERNAME=toolkit@yourcompany.com
    export ODOO_API_KEY=...            # read-only user's key
    python3 tools/odoo_sync.py         # -> data/demo-data.js
    python3 tools/odoo_sync.py --check data/demo-data.js   # validate a data file

Run it nightly (cron, GitHub Actions, Azure Functions timer...) and on demand.

Every Odoo is customised a little differently, so the field names that vary
between companies (brand, origin, which packaging is "the case") live in
FIELD_MAP below rather than being scattered through the code.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import xmlrpc.client
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "data" / "demo-data.js"
HISTORY_DAYS = 730          # two years of orders: enough for year-on-year
BATCH = 2000

# Fields that differ between Odoo databases. Adjust per client.
FIELD_MAP = {
    "brand": "x_studio_brand",              # char/many2one on product.template; falls back to the name
    "origin": "x_studio_origin",            # or "country_of_origin" on Odoo 17+ with the right module
    "case_packaging": ("case", "caja", "carton", "box"),     # product.packaging name for one case
    "pallet_packaging": ("pallet", "palet"),
    "customer_domain": [["customer_rank", ">", 0], ["is_company", "=", True]],
    "internal_location_domain": [["location_id.usage", "=", "internal"]],
}


# --------------------------------------------------------------------------
# Thin client
# --------------------------------------------------------------------------
class Odoo:
    def __init__(self, url: str, db: str, user: str, key: str):
        self.url, self.db, self.key = url.rstrip("/"), db, key
        common = xmlrpc.client.ServerProxy(f"{self.url}/xmlrpc/2/common", allow_none=True)
        self.uid = common.authenticate(db, user, key, {})
        if not self.uid:
            raise SystemExit("Odoo login failed: check ODOO_DB / ODOO_USERNAME / ODOO_API_KEY")
        self.models = xmlrpc.client.ServerProxy(f"{self.url}/xmlrpc/2/object", allow_none=True)
        self._fields: dict[str, set] = {}

    def call(self, model, method, *args, **kw):
        return self.models.execute_kw(self.db, self.uid, self.key, model, method, list(args), kw)

    def has_field(self, model: str, field: str) -> bool:
        if model not in self._fields:
            self._fields[model] = set(self.call(model, "fields_get", attributes=["type"]))
        return field in self._fields[model]

    def read_all(self, model: str, domain: list, fields: list[str], context: dict | None = None) -> list[dict]:
        """search_read in batches, keeping only fields this database actually has"""
        fields = [f for f in fields if "." in f or self.has_field(model, f)]
        out, offset = [], 0
        while True:
            chunk = self.call(model, "search_read", domain, fields=fields, offset=offset, limit=BATCH,
                              order="id", context=context or {"active_test": False})
            out += chunk
            if len(chunk) < BATCH:
                return out
            offset += BATCH


m2o_id = lambda v: v[0] if v else None          # many2one comes back as [id, "Name"]
m2o_name = lambda v: v[1] if v else ""


# --------------------------------------------------------------------------
# Pull + shape
# --------------------------------------------------------------------------
PACK_WORDS = [  # name keyword -> drawing used when there is no photo
    (r"\bcup\b", "cup"), (r"\bcan\b|lata", "can"), (r"tortilla|tostada|wrap", "flatpack"),
    (r"\bjar\b|tarro|mole|paste|chutney", "jar"), (r"\btin\b|jalape|chipotle|beans|frijol", "tin"),
    (r"chips|totopo|gumm|candy|crisps", "bag"), (r"rice|arroz|flour|harina|masa", "sack"),
    (r"sauce|salsa|syrup|vinegar|mirin", "bottle"), (r"soda|drink|water|refresco", "bottle_pet"),
    (r"cereal", "cereal"), (r"bar\b|chocolate", "bar"),
]


def guess_pack(name: str) -> str:
    n = name.lower()
    for pat, shape in PACK_WORDS:
        if re.search(pat, n):
            return shape
    return "box"


def size_of(name: str) -> str:
    m = re.search(r"(\d+(?:[.,]\d+)?)\s?(ml|l|g|gr|kg|oz|u|un)\b", name, re.I)
    return f"{m.group(1)} {m.group(2).lower().replace('gr', 'g')}" if m else ""


def sync(odoo: Odoo, today: date) -> dict:
    since = (today - timedelta(days=HISTORY_DAYS)).isoformat()

    # ---- products and packaging
    prods = odoo.read_all("product.product", [["sale_ok", "=", True]], [
        "default_code", "name", "barcode", "categ_id", "list_price", "standard_price", "active",
        "create_date", "taxes_id", "product_tmpl_id", FIELD_MAP["brand"], FIELD_MAP["origin"],
        "sale_delay", "expiration_time"])
    packs = odoo.read_all("product.packaging", [["product_id", "in", [p["id"] for p in prods]]],
                          ["product_id", "name", "qty", "barcode"])
    case_of, pallet_of = {}, {}
    for pk in packs:
        pid, nm = m2o_id(pk["product_id"]), (pk["name"] or "").lower()
        if any(w in nm for w in FIELD_MAP["pallet_packaging"]):
            pallet_of[pid] = pk
        elif any(w in nm for w in FIELD_MAP["case_packaging"]) or pid not in case_of:
            case_of[pid] = pk
    taxes = {t["id"]: t["amount"] for t in odoo.read_all("account.tax", [["type_tax_use", "=", "sale"]], ["amount"])}

    products = []
    for p in prods:
        cat_path = [s.strip() for s in m2o_name(p["categ_id"]).split("/") if s.strip() not in ("All", "Saleable", "")]
        upc = int(case_of.get(p["id"], {}).get("qty") or 1)
        pallet = pallet_of.get(p["id"])
        brand = p.get(FIELD_MAP["brand"])
        brand = m2o_name(brand) if isinstance(brand, list) else (brand or p["name"].split()[0])
        origin = p.get(FIELD_MAP["origin"])
        origin = m2o_name(origin) if isinstance(origin, list) else (origin or "")
        products.append(dict(
            id=p["id"], sku=p["default_code"] or str(p["id"]), name=p["name"], brand=brand,
            origin=origin, cuisine=origin, category=cat_path[0] if cat_path else "Other",
            subcategory=cat_path[-1] if cat_path else "Other", variant="", word="",
            size=size_of(p["name"]), pack=guess_pack(p["name"]), color="#868E96",
            units_per_case=upc, cases_per_pallet=int(pallet["qty"] / upc) if pallet else None,
            case_weight_kg=None, ean=p["barcode"] or "", ean_case=case_of.get(p["id"], {}).get("barcode") or "",
            list_price=p["list_price"], cost=p["standard_price"],
            vat=max([taxes.get(t, 0) for t in p.get("taxes_id") or []] or [0]),
            shelf_life_days=p.get("expiration_time") or 365, storage="Ambient", horeca=False,
            launched=(p["create_date"] or since)[:10], active=p["active"], supplier="",
        ))
    pids = {p["id"] for p in products}

    # ---- price lists (fixed per-product prices define a list's range)
    pls = odoo.read_all("product.pricelist", [["active", "=", True]], ["name", "currency_id"])
    items = odoo.read_all("product.pricelist.item", [["pricelist_id", "in", [x["id"] for x in pls]]],
                          ["pricelist_id", "applied_on", "product_id", "product_tmpl_id", "compute_price", "fixed_price"])
    tmpl_to_pids = defaultdict(list)
    for p in prods:
        tmpl_to_pids[m2o_id(p["product_tmpl_id"])].append(p["id"])
    pl_items = defaultdict(dict)
    for it in items:
        if it["compute_price"] != "fixed":
            continue
        targets = ([m2o_id(it["product_id"])] if it["applied_on"] == "0_product_variant"
                   else tmpl_to_pids.get(m2o_id(it["product_tmpl_id"]), []))
        for pid in targets:
            if pid in pids:
                pl_items[m2o_id(it["pricelist_id"])][pid] = it["fixed_price"]
    pricelists = [dict(id=pl["id"], name=pl["name"], code="", note="", items=[[k, v] for k, v in pl_items[pl["id"]].items()])
                  for pl in pls if pl_items[pl["id"]]]

    # ---- customers, reps, delivery addresses
    partners = odoo.read_all("res.partner", FIELD_MAP["customer_domain"], [
        "name", "ref", "city", "country_id", "user_id", "property_product_pricelist", "property_payment_term_id",
        "credit_limit", "create_date", "vat", "phone", "child_ids", "category_id"])
    kids = odoo.read_all("res.partner", [["parent_id", "in", [c["id"] for c in partners]], ["type", "=", "delivery"]],
                         ["parent_id", "name", "city", "street"])
    deliveries = defaultdict(list)
    for k in kids:
        deliveries[m2o_id(k["parent_id"])].append(k)
    users = {}
    customers = []
    for c in partners:
        if c["user_id"]:
            users[m2o_id(c["user_id"])] = m2o_name(c["user_id"])
        dl = [dict(id=c["id"], name=c["name"], city=c["city"] or "", street="")] + [
            dict(id=k["id"], name=k["name"] or k["city"] or "Delivery", city=k["city"] or "", street=k["street"] or "")
            for k in deliveries[c["id"]]]
        customers.append(dict(
            id=c["id"], ref=c["ref"] or "", name=c["name"], kind="Customer", city=c["city"] or "",
            country=(m2o_name(c["country_id"])[:2].upper() if c["country_id"] else ""),
            rep_id=m2o_id(c["user_id"]), pricelist_id=m2o_id(c["property_product_pricelist"]),
            payment_terms=m2o_name(c["property_payment_term_id"]), since=(c["create_date"] or since)[:10],
            credit_limit=c["credit_limit"] or 0, vat_number=c["vat"] or "", phone=c["phone"] or "",
            delivery=dl, churned=None))
    cust_ids = {c["id"] for c in customers}
    reps = [dict(id=uid, name=nm, area="", email="") for uid, nm in users.items()]

    # ---- sales orders and lines
    sos = odoo.read_all("sale.order", [["state", "in", ["sale", "done"]], ["date_order", ">=", since],
                                       ["partner_id.commercial_partner_id", "in", list(cust_ids)]],
                        ["name", "partner_id", "partner_shipping_id", "date_order", "state", "commitment_date"])
    so_lines = odoo.read_all("sale.order.line", [["order_id", "in", [s["id"] for s in sos]], ["display_type", "=", False]],
                             ["order_id", "product_id", "product_uom_qty", "qty_delivered", "price_unit", "discount"])
    commercial = {c["id"]: c["id"] for c in customers}
    for k in kids:
        commercial[k["id"]] = m2o_id(k["parent_id"])
    open_qty = defaultdict(float)
    by_order = defaultdict(list)
    for ln in so_lines:
        by_order[m2o_id(ln["order_id"])].append(ln)
    orders, lines = [], []
    for s in sorted(sos, key=lambda x: x["date_order"]):
        cid = commercial.get(m2o_id(s["partner_id"]), m2o_id(s["partner_id"]))
        cust = next((c for c in customers if c["id"] == cid), None)
        if not cust:
            continue
        ship = m2o_id(s["partner_shipping_id"])
        di = next((i for i, d in enumerate(cust["delivery"]) if d["id"] == ship), 0)
        ls = [ln for ln in by_order[s["id"]] if m2o_id(ln["product_id"]) in pids]
        delivered = all(ln["qty_delivered"] >= ln["product_uom_qty"] for ln in ls)
        oi = len(orders)
        orders.append([s["name"], cid, s["date_order"][:10], "done" if delivered else "sale", di,
                       (s["commitment_date"] or s["date_order"])[:10] if delivered else None])
        for ln in ls:
            lines.append([oi, m2o_id(ln["product_id"]), ln["product_uom_qty"], ln["price_unit"], ln["discount"] or 0])
            open_qty[m2o_id(ln["product_id"])] += max(0, ln["product_uom_qty"] - ln["qty_delivered"])

    # ---- stock: quants by lot, with best-before dates
    quants = odoo.read_all("stock.quant", FIELD_MAP["internal_location_domain"] + [["product_id", "in", list(pids)]],
                           ["product_id", "quantity", "reserved_quantity", "lot_id"])
    lot_ids = list({m2o_id(q["lot_id"]) for q in quants if q["lot_id"]})
    lots = {l["id"]: l for l in odoo.read_all("stock.lot", [["id", "in", lot_ids]], ["name", "expiration_date", "use_date"])} if lot_ids else {}
    stock = defaultdict(lambda: dict(on_hand=0, reserved=0, lots=[]))
    for q in quants:
        pid = m2o_id(q["product_id"])
        st = stock[pid]
        st["on_hand"] += q["quantity"]
        st["reserved"] += q["reserved_quantity"]
        if q["lot_id"] and q["quantity"] > 0:
            lot = lots.get(m2o_id(q["lot_id"]), {})
            bbd = (lot.get("expiration_date") or lot.get("use_date") or "")[:10]
            st["lots"].append([m2o_name(q["lot_id"]), q["quantity"], bbd or None])
    for pid, st in stock.items():   # reserved = what confirmed orders still need, capped at stock
        st["reserved"] = min(st["on_hand"], max(st["reserved"], open_qty.get(pid, 0)))

    # ---- inbound: confirmed purchase orders not fully received
    pols = odoo.read_all("purchase.order.line", [["order_id.state", "in", ["purchase", "draft", "sent"]],
                                                 ["product_id", "in", list(pids)]],
                         ["order_id", "product_id", "product_qty", "qty_received", "date_planned"])
    po_ids = list({m2o_id(l["order_id"]) for l in pols})
    pos = {p["id"]: p for p in odoo.read_all("purchase.order", [["id", "in", po_ids]],
                                             ["name", "partner_id", "state", "date_order", "date_planned", "notes"])} if po_ids else {}
    purchases = {}
    for l in pols:
        left = l["product_qty"] - l["qty_received"]
        if left <= 0:
            continue
        po = pos[m2o_id(l["order_id"])]
        rec = purchases.setdefault(po["id"], dict(
            name=po["name"], supplier=m2o_name(po["partner_id"]), supplier_country="",
            date_order=(po["date_order"] or "")[:10], eta=(po["date_planned"] or "")[:10] if po["state"] == "purchase" else None,
            state=po["state"] if po["state"] == "purchase" else "draft",
            note=re.sub("<[^>]+>", "", po.get("notes") or "")[:120], lines=[]))
        rec["lines"].append([m2o_id(l["product_id"]), left])

    company = odoo.call("res.company", "search_read", [], fields=["name", "street", "city", "zip", "email", "phone", "website"], limit=1)[0]
    return dict(
        meta=dict(generated_at=datetime.now().astimezone().isoformat(timespec="seconds"), today=today.isoformat(),
                  source=f"Odoo {odoo.url}", currency="EUR"),
        company=dict(name=company["name"], short=company["name"].split()[0], tagline="",
                     address=", ".join(x for x in [company["street"], company["zip"], company["city"]] if x),
                     vat="", email=company["email"] or "", phone=company["phone"] or "", web=company["website"] or "", founded=None),
        reps=reps, brands={}, suppliers={}, products=products, pricelists=pricelists, customers=customers,
        orders=orders, lines=lines, stock=dict(stock), purchases=list(purchases.values()))


# --------------------------------------------------------------------------
# Data contract: both the generator and the sync must produce this
# --------------------------------------------------------------------------
def check(data: dict) -> list[str]:
    errs = []
    need = {"meta", "company", "reps", "brands", "products", "pricelists", "customers", "orders", "lines", "stock", "purchases"}
    errs += [f"missing top-level key: {k}" for k in need - set(data)]
    pids = {p["id"] for p in data.get("products", [])}
    cids = {c["id"] for c in data.get("customers", [])}
    for p in data.get("products", []):
        for k in ("sku", "name", "brand", "category", "subcategory", "units_per_case", "list_price", "cost"):
            if k not in p:
                errs.append(f"product {p.get('id')} has no {k}")
    for i, o in enumerate(data.get("orders", [])):
        if o[1] not in cids:
            errs.append(f"order {o[0]} points at unknown customer {o[1]}")
        if o[3] not in ("sale", "done"):
            errs.append(f"order {o[0]} has state {o[3]}")
    n = len(data.get("orders", []))
    for ln in data.get("lines", []):
        if not (0 <= ln[0] < n) or ln[1] not in pids:
            errs.append(f"bad order line {ln}")
            break
    for pl in data.get("pricelists", []):
        if any(pid not in pids for pid, _ in pl["items"]):
            errs.append(f"price list {pl['name']} has unknown products")
    for pid in data.get("stock", {}):
        if int(pid) not in pids:
            errs.append(f"stock for unknown product {pid}")
    return errs[:50]


def write(data: dict, path: Path):
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"), default=str)
    path.write_text(f"/* Odoo snapshot {data['meta']['generated_at']} */\nwindow.DEMO={payload};\n", encoding="utf-8")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("--check", type=Path, help="validate an existing data file and exit")
    a = ap.parse_args()
    if a.check:
        t = a.check.read_text(encoding="utf-8")
        data = json.loads(t[t.index("=") + 1:].rstrip().rstrip(";"))
        errs = check(data)
        print("\n".join(errs) if errs else
              f"OK: {len(data['products'])} products, {len(data['customers'])} customers, "
              f"{len(data['orders'])} orders, {len(data['lines'])} lines, {len(data['purchases'])} purchase orders")
        sys.exit(1 if errs else 0)
    env = {k: os.environ.get(k) for k in ("ODOO_URL", "ODOO_DB", "ODOO_USERNAME", "ODOO_API_KEY")}
    missing = [k for k, v in env.items() if not v]
    if missing:
        raise SystemExit("Set " + ", ".join(missing) + " (see the top of this file).")
    odoo = Odoo(env["ODOO_URL"], env["ODOO_DB"], env["ODOO_USERNAME"], env["ODOO_API_KEY"])
    data = sync(odoo, date.today())
    errs = check(data)
    if errs:
        print("Data problems (written anyway):\n  " + "\n  ".join(errs), file=sys.stderr)
    write(data, a.out)
    print(f"wrote {a.out}: {len(data['products'])} products, {len(data['orders'])} orders")


if __name__ == "__main__":
    main()
