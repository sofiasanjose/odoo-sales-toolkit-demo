/* Packshots: a drawn product picture for every SKU.
 *
 * The demo has no real photography, so each product gets an SVG drawing of
 * its pack (bottle, can, bag, tortilla pack...) in its brand colours, with the
 * brand, flavour and size on the label. Pure SVG, so it prints sharp in the
 * PDF catalogue and needs no network. */
(function () {
  "use strict";
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function lum(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }
  const ink = (bg) => (lum(bg) > 0.6 ? "#1d1d1b" : "#ffffff");
  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const ch = (v) => Math.max(0, Math.min(255, Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f)));
    const r = ch((n >> 16) & 255), g = ch((n >> 8) & 255), b = ch(n & 255);
    return "#" + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  }

  /** text squeezed to a maximum width */
  function txt(x, y, s, size, color, maxW, weight = 700, anchor = "middle") {
    const est = s.length * size * 0.56;
    const fit = est > maxW ? ` textLength="${maxW}" lengthAdjust="spacingAndGlyphs"` : "";
    return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${color}" text-anchor="${anchor}" font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"${fit}>${esc(s)}</text>`;
  }

  /** standard label: brand band, flavour, size */
  function label(x, y, w, h, b, p, opts = {}) {
    const cx = x + w / 2;
    const bandH = Math.max(11, h * 0.3);
    const fs = Math.min(10, w / 6.2);
    let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${opts.bg || "#fffdf8"}" rx="${opts.rx || 2}"/>`;
    s += `<rect x="${x}" y="${y}" width="${w}" height="${bandH}" fill="${b.color}" rx="${opts.rx || 2}"/>`;
    s += txt(cx, y + bandH * 0.7, p.brand, Math.min(fs, bandH * 0.62), ink(b.color), w - 6);
    const vy = y + bandH + (h - bandH) * 0.48;
    s += `<rect x="${x}" y="${vy - fs * 0.95}" width="${w}" height="${fs * 1.35}" fill="${p.color}" opacity=".9"/>`;
    s += txt(cx, vy, p.variant, fs * 0.82, ink(p.color), w - 6);
    if (h > 34) s += txt(cx, y + h - 4, p.size || "", fs * 0.7, "#555", w - 8, 600);
    return s;
  }

  const SHAPES = {
    bottle_slim(p, b) {
      return `<rect x="52" y="12" width="16" height="16" rx="2" fill="${shade(b.color, -0.35)}"/>
        <path d="M54 28h12v14c0 6 12 10 12 20v64a6 6 0 0 1-6 6H48a6 6 0 0 1-6-6V62c0-10 12-14 12-20z" fill="${shade(p.color, 0.15)}"/>
        ${label(42, 70, 36, 48, b, p)}`;
    },
    bottle(p, b) {
      return `<rect x="50" y="10" width="20" height="14" rx="2" fill="${shade(b.color, -0.35)}"/>
        <path d="M52 24h16v12c0 5 16 9 16 20v70a6 6 0 0 1-6 6H42a6 6 0 0 1-6-6V56c0-11 16-15 16-20z" fill="${shade(p.color, 0.1)}"/>
        ${label(36, 66, 48, 52, b, p)}`;
    },
    bottle_pet(p, b) {
      return `<rect x="51" y="8" width="18" height="12" rx="2" fill="${b.accent === "#FFFFFF" ? b.color : shade(b.color, -0.2)}"/>
        <path d="M53 20h14v8c0 6 15 9 15 20v76a8 8 0 0 1-8 8H46a8 8 0 0 1-8-8V48c0-11 15-14 15-20z" fill="${shade(p.color, 0.45)}" opacity=".95"/>
        <path d="M38 60h44M38 112h44" stroke="#ffffff" stroke-opacity=".5" stroke-width="2"/>
        ${label(38, 66, 44, 42, b, p)}`;
    },
    glass(p, b) {
      return `<rect x="53" y="6" width="14" height="8" rx="1.5" fill="${shade(b.color, -0.2)}"/>
        <path d="M55 14h10l2 30c0 6 11 10 11 22v62a4 4 0 0 1-4 4H46a4 4 0 0 1-4-4V66c0-12 11-16 11-22z" fill="${shade(p.color, 0.25)}" opacity=".9"/>
        <path d="M47 72v52" stroke="#fff" stroke-opacity=".45" stroke-width="3" stroke-linecap="round"/>
        ${label(42, 78, 36, 38, b, p)}`;
    },
    ramune(p, b) {
      return `<rect x="52" y="6" width="16" height="10" rx="3" fill="${b.color}"/>
        <path d="M54 16h12v10c0 4-4 6-4 10 0 4 14 8 14 20v70a6 6 0 0 1-6 6H48a6 6 0 0 1-6-6V56c0-12 14-16 14-20 0-4-4-6-4-10z" fill="#d7f0f7" stroke="#9cc9d6" stroke-width="1"/>
        <circle cx="60" cy="34" r="4.5" fill="#bfe3ee" stroke="#8fbccb"/>
        ${label(42, 70, 36, 46, b, p)}`;
    },
    jug(p, b) {
      return `<rect x="44" y="10" width="20" height="12" rx="2" fill="${shade(b.color, -0.3)}"/>
        <path d="M46 22h16v8l22 10v86a6 6 0 0 1-6 6H32a6 6 0 0 1-6-6V44c0-8 20-10 20-14z" fill="${shade(p.color, 0.3)}"/>
        <path d="M84 50h6a6 6 0 0 1 6 6v20a6 6 0 0 1-6 6h-6" fill="none" stroke="${shade(p.color, 0.1)}" stroke-width="5"/>
        ${label(28, 62, 54, 56, b, p)}`;
    },
    jar(p, b) {
      return `<rect x="32" y="36" width="56" height="14" rx="3" fill="${b.color}"/>
        <path d="M36 50h48a6 6 0 0 1 6 6v70a6 6 0 0 1-6 6H36a6 6 0 0 1-6-6V56a6 6 0 0 1 6-6z" fill="${shade(p.color, 0.05)}"/>
        ${label(30, 64, 60, 54, b, p)}`;
    },
    tub(p, b) {
      return `<path d="M24 58h72l-6 72a4 4 0 0 1-4 4H34a4 4 0 0 1-4-4z" fill="${b.color}"/>
        <rect x="20" y="48" width="80" height="12" rx="3" fill="${shade(b.color, -0.25)}"/>
        ${label(32, 72, 56, 50, b, p, { rx: 3 })}`;
    },
    tin(p, b) {
      return `<rect x="30" y="52" width="60" height="80" rx="4" fill="#cfd4da"/>
        <rect x="30" y="52" width="60" height="6" rx="3" fill="#adb5bd"/><rect x="30" y="126" width="60" height="6" rx="3" fill="#adb5bd"/>
        ${label(30, 60, 60, 64, b, p, { rx: 0 })}`;
    },
    tin_big(p, b) {
      return `<rect x="22" y="30" width="76" height="102" rx="5" fill="#cfd4da"/>
        <rect x="22" y="30" width="76" height="7" rx="3" fill="#adb5bd"/><rect x="22" y="125" width="76" height="7" rx="3" fill="#adb5bd"/>
        ${label(22, 40, 76, 82, b, p, { rx: 0 })}`;
    },
    can(p, b) {
      return `<path d="M42 32h36l2 6v88l-2 6H42l-2-6V38z" fill="${b.color}"/>
        <rect x="44" y="26" width="32" height="7" rx="2" fill="#ced4da"/>
        <rect x="40" y="60" width="40" height="44" fill="${p.color}"/>
        ${txt(60, 52, p.brand, 8.5, ink(b.color), 36)}${txt(60, 85, p.variant, 7.5, ink(p.color), 36)}${txt(60, 120, p.size, 6.5, ink(b.color), 34, 600)}
        <path d="M45 40v84" stroke="#fff" stroke-opacity=".35" stroke-width="3"/>`;
    },
    can_tall(p, b) {
      return `<path d="M43 18h34l2 6v102l-2 6H43l-2-6V24z" fill="${b.color}"/>
        <rect x="45" y="12" width="30" height="7" rx="2" fill="#ced4da"/>
        <path d="M41 70 79 50v34L41 104z" fill="${p.color}"/>
        ${txt(60, 40, p.brand, 9, ink(b.color), 34)}${txt(60, 81, p.variant, 7, ink(p.color), 34)}${txt(60, 122, p.size, 6.5, ink(b.color), 32, 600)}
        <path d="M46 26v98" stroke="#fff" stroke-opacity=".3" stroke-width="3"/>`;
    },
    cup(p, b) {
      return `<rect x="24" y="40" width="72" height="10" rx="3" fill="#f1f3f5" stroke="#dee2e6"/>
        <path d="M27 50h66l-8 80a4 4 0 0 1-4 4H39a4 4 0 0 1-4-4z" fill="${b.color}"/>
        <path d="M31 92h58l-2 20H33z" fill="${p.color}"/>
        ${txt(60, 72, p.brand, 10, ink(b.color), 52)}${txt(60, 106, p.variant, 8, ink(p.color), 50)}${txt(60, 126, p.size, 6.5, ink(b.color), 40, 600)}`;
    },
    bag(p, b) {
      return `<path d="M28 22h64l-2 6 4 6-2 92 2 6H26l2-6-2-92 4-6z" fill="${b.color}"/>
        <path d="M28 22h64M26 132h68" stroke="${shade(b.color, -0.3)}" stroke-width="3" stroke-dasharray="3 2"/>
        <ellipse cx="60" cy="88" rx="26" ry="20" fill="${p.color}"/>
        ${txt(60, 52, p.brand, 11, ink(b.color), 56)}${txt(60, 92, p.variant, 8.5, ink(p.color), 48)}${txt(60, 124, p.size, 7, ink(b.color), 50, 600)}
        <path d="M34 34c4 30 4 60 0 90" stroke="#fff" stroke-opacity=".25" stroke-width="4" fill="none"/>`;
    },
    pouch(p, b) {
      return `<path d="M32 26h56l4 100a6 6 0 0 1-6 6H34a6 6 0 0 1-6-6z" fill="${b.color}"/>
        <path d="M33 38h54" stroke="${shade(b.color, -0.3)}" stroke-width="2"/>
        <rect x="34" y="74" width="52" height="26" rx="4" fill="${p.color}"/>
        ${txt(60, 60, p.brand, 10, ink(b.color), 50)}${txt(60, 91, p.variant, 8, ink(p.color), 46)}${txt(60, 122, p.size, 7, ink(b.color), 46, 600)}`;
    },
    box(p, b) {
      return `<path d="M30 34h56l8-8v98l-8 8H30z" fill="${shade(b.color, -0.25)}"/>
        <rect x="26" y="34" width="60" height="98" fill="${b.color}"/>
        <rect x="26" y="70" width="60" height="30" fill="${p.color}"/>
        ${txt(56, 56, p.brand, 10, ink(b.color), 54)}${txt(56, 89, p.variant, 8.5, ink(p.color), 54)}${txt(56, 122, p.size, 7, ink(b.color), 50, 600)}`;
    },
    cereal(p, b) {
      return `<path d="M30 16h56l8-8v118l-8 8H30z" fill="${shade(b.color, -0.25)}"/>
        <rect x="26" y="16" width="60" height="118" fill="${b.color}"/>
        <circle cx="56" cy="84" r="20" fill="#fff" opacity=".9"/><circle cx="56" cy="84" r="14" fill="${p.color}"/>
        ${txt(56, 40, p.brand, 10, ink(b.color), 54)}${txt(56, 118, p.variant, 8.5, ink(b.color), 54)}${txt(56, 129, p.size, 6.5, ink(b.color), 40, 600)}`;
    },
    flatpack(p, b) {
      return `<rect x="10" y="58" width="100" height="66" rx="10" fill="#f8f9fa" stroke="#dee2e6"/>
        <ellipse cx="60" cy="92" rx="44" ry="26" fill="${p.color}" opacity=".85"/>
        <rect x="10" y="58" width="100" height="18" rx="9" fill="${b.color}"/>
        ${txt(60, 71, p.brand, 10, ink(b.color), 86)}
        <rect x="26" y="98" width="68" height="14" rx="3" fill="#fffdf8" opacity=".95"/>
        ${txt(60, 108, p.variant + (p.size ? " · " + p.size : ""), 7.5, "#1d1d1b", 64)}`;
    },
    sack(p, b) {
      return `<path d="M30 30h60l2 8-2 6 4 82a6 6 0 0 1-6 6H32a6 6 0 0 1-6-6l4-82-2-6z" fill="#efe6d4"/>
        <path d="M30 30h60l2 8H28z" fill="${shade(b.color, -0.2)}"/>
        <rect x="34" y="50" width="52" height="20" fill="${b.color}"/>
        <rect x="38" y="78" width="44" height="22" rx="11" fill="${p.color}"/>
        ${txt(60, 64, p.brand, 10, ink(b.color), 48)}${txt(60, 93, p.variant, 8, ink(p.color), 40)}${txt(60, 120, p.size, 9, "#3b3b3b", 40, 700)}`;
    },
    bar(p, b) {
      return `<path d="M8 74l4 4-4 4 4 4-4 4 4 4-4 4 4 4-4 4h104l-4-4 4-4-4-4 4-4-4-4 4-4-4-4 4-4z" fill="${b.color}"/>
        <rect x="34" y="78" width="52" height="28" rx="4" fill="${p.color}"/>
        ${txt(60, 90, p.brand, 9, ink(p.color), 48)}${txt(60, 101, p.variant + " · " + p.size, 6.5, ink(p.color), 48, 600)}`;
    },
    tray(p, b) {
      return `<path d="M18 76h84l-6 50a4 4 0 0 1-4 4H28a4 4 0 0 1-4-4z" fill="${b.color}"/>
        <rect x="14" y="68" width="92" height="12" rx="3" fill="${p.color}"/>
        ${txt(60, 100, p.brand, 11, ink(b.color), 70)}${txt(60, 114, p.variant, 8, ink(b.color), 66)}${txt(60, 125, p.size, 6.5, ink(b.color), 40, 600)}`;
    },
    carton(p, b) {
      return `<path d="M42 40l18-22 18 22z" fill="${shade(b.color, -0.15)}"/>
        <rect x="42" y="40" width="36" height="92" fill="${b.color}"/>
        <circle cx="60" cy="82" r="13" fill="${p.color}"/>
        ${txt(60, 56, p.brand, 8, ink(b.color), 32)}${txt(60, 108, p.variant, 7, ink(b.color), 32)}${txt(60, 126, p.size, 6.5, ink(b.color), 30, 600)}`;
    },
  };

  const cache = new Map();
  function svg(p, size = 120) {
    const key = p.id + ":" + size;
    if (cache.has(key)) return cache.get(key);
    const b = (window.DEMO.brands || {})[p.brand] || { color: "#495057", accent: "#fff" };
    const draw = SHAPES[p.pack] || SHAPES.box;
    const h = Math.round((size * 140) / 120);
    const out = `<svg class="packshot" viewBox="0 0 120 140" width="${size}" height="${h}" role="img" aria-label="${esc(p.name)}">
      <ellipse cx="60" cy="134" rx="40" ry="4" fill="#000" opacity=".08"/>${draw(p, b)}</svg>`;
    cache.set(key, out);
    return out;
  }

  window.Packshot = { svg };
})();
