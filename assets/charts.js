/* Charts: small, dependency-free SVG charts with hover tooltips.
 * Thin columns with rounded data ends, hairline grid, legend for 2+ series,
 * labels in text colours (never the series colour). */
(function () {
  "use strict";
  const { esc } = window.App;

  function niceMax(v) {
    if (v <= 0) return 1;
    const e = Math.pow(10, Math.floor(Math.log10(v)));
    const f = v / e;
    const n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
    return n * e;
  }

  function tooltip() {
    let t = document.getElementById("chart-tip");
    if (!t) {
      t = document.createElement("div");
      t.id = "chart-tip";
      t.setAttribute("role", "tooltip");
      document.body.appendChild(t);
    }
    return t;
  }
  function showTip(evt, html) {
    const t = tooltip();
    t.innerHTML = html;
    t.style.display = "block";
    const r = t.getBoundingClientRect();
    let x = evt.clientX + 14, y = evt.clientY - r.height - 10;
    if (x + r.width > innerWidth - 8) x = evt.clientX - r.width - 14;
    if (y < 8) y = evt.clientY + 16;
    t.style.left = x + "px";
    t.style.top = y + "px";
  }
  const hideTip = () => { const t = document.getElementById("chart-tip"); if (t) t.style.display = "none"; };

  /** rounded-top column path, square at the baseline */
  function col(x, y, w, h, r = 4) {
    if (h <= 0) return "";
    r = Math.min(r, h, w / 2);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }

  /**
   * columns(el, {labels, series:[{name, values, color}], format, height, tipLabels, highlightLast})
   */
  function columns(el, o) {
    const W = el.clientWidth || 640, H = o.height || 240;
    const m = { t: 14, r: 8, b: 26, l: 52 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const n = o.labels.length, ns = o.series.length;
    const max = niceMax(Math.max(1, ...o.series.flatMap((s) => s.values)));
    const band = iw / n;
    const gap = 2;
    const bw = Math.min(24, (band * 0.72 - gap * (ns - 1)) / ns);
    const groupW = bw * ns + gap * (ns - 1);
    let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${esc(o.aria || "")}">`;
    // pick a tick count that gives round steps (0/10/20/30/40/50, not 12.5)
    const nT = [5, 4, 6, 3].find((k) => { const st = max / k, e = Math.pow(10, Math.floor(Math.log10(st))); return [1, 2, 2.5, 5].includes(+(st / e).toFixed(3)); }) || 4;
    for (let k = 0; k <= nT; k++) {
      const v = (max / nT) * k, y = m.t + ih - (ih * v) / max;
      s += `<line x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}" class="grid"/>`;
      s += `<text x="${m.l - 8}" y="${y + 4}" class="tick" text-anchor="end">${esc(o.format(v, true))}</text>`;
    }
    o.labels.forEach((lab, i) => {
      const gx = m.l + band * i + (band - groupW) / 2;
      o.series.forEach((se, j) => {
        const v = se.values[i] || 0, h = (ih * v) / max;
        s += `<path d="${col(gx + j * (bw + gap), m.t + ih - h, bw, h)}" fill="${se.color}" ${se.opacity ? `opacity="${se.opacity}"` : ""}/>`;
      });
      if (n <= 14 || i % 2 === (n - 1) % 2) {
        s += `<text x="${m.l + band * i + band / 2}" y="${H - 8}" class="tick" text-anchor="middle">${esc(lab)}</text>`;
      }
      s += `<rect x="${m.l + band * i}" y="${m.t}" width="${band}" height="${ih}" fill="transparent" data-i="${i}" class="hit"/>`;
    });
    s += `<line x1="${m.l}" x2="${W - m.r}" y1="${m.t + ih}" y2="${m.t + ih}" class="axis"/></svg>`;
    let legend = "";
    if (ns > 1) {
      legend = `<div class="legend">${o.series.map((se) => `<span><i style="background:${se.color};opacity:${se.opacity || 1}"></i>${esc(se.name)}</span>`).join("")}</div>`;
    }
    el.innerHTML = legend + s;
    el.querySelectorAll(".hit").forEach((r) => {
      r.addEventListener("mousemove", (e) => {
        const i = +r.dataset.i;
        el.querySelectorAll(".hit").forEach((x) => x.classList.toggle("on", x === r));
        const rows = o.series.map((se) => `<div class="tip-row"><i style="background:${se.color};opacity:${se.opacity || 1}"></i>${esc(se.name)}<b>${esc(o.format(se.values[i] || 0))}</b></div>`).join("");
        showTip(e, `<div class="tip-h">${esc((o.tipLabels || o.labels)[i])}</div>${rows}${o.tipExtra ? o.tipExtra(i) : ""}`);
      });
      r.addEventListener("mouseleave", () => { hideTip(); r.classList.remove("on"); });
    });
  }

  /** horizontal bars as HTML rows: [{label, value, sub, href}] */
  function bars(el, rows, o = {}) {
    const max = Math.max(1, ...rows.map((r) => r.value));
    el.innerHTML = `<div class="hbars">${rows.map((r) => `
      <div class="hbar" ${r.href ? `data-href="${esc(r.href)}" tabindex="0"` : ""}>
        <div class="hbar-l">${r.html || esc(r.label)}</div>
        <div class="hbar-t"><div class="hbar-f" style="width:${(100 * r.value) / max}%;background:${o.color || "var(--series-1)"}"></div></div>
        <div class="hbar-v">${esc(o.format ? o.format(r.value) : r.value)}${r.sub ? `<small>${r.sub}</small>` : ""}</div>
      </div>`).join("")}</div>`;
    el.querySelectorAll("[data-href]").forEach((d) => {
      d.addEventListener("click", () => (location.hash = d.dataset.href));
      d.addEventListener("keydown", (e) => e.key === "Enter" && (location.hash = d.dataset.href));
    });
  }

  /** 12-point sparkline, last point in the accent colour */
  function spark(values, w = 96, h = 28) {
    const max = Math.max(...values, 1), min = Math.min(...values, 0);
    const x = (i) => 3 + (i * (w - 6)) / (values.length - 1);
    const y = (v) => h - 4 - ((v - min) / (max - min || 1)) * (h - 8);
    const d = values.map((v, i) => (i ? "L" : "M") + x(i).toFixed(1) + "," + y(v).toFixed(1)).join("");
    const li = values.length - 1;
    return `<svg width="${w}" height="${h}" class="spark" aria-hidden="true"><path d="${d}" fill="none" stroke="var(--deemph)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${x(li)}" cy="${y(values[li])}" r="4" fill="var(--series-1)" stroke="var(--card)" stroke-width="2"/></svg>`;
  }

  window.Charts = { columns, bars, spark, showTip, hideTip };
})();
