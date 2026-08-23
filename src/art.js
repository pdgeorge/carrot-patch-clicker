/* ==== art.js — "the Woodcut Almanac": one hand draws everything ====
   Skin, not content (DESIGN P7): nothing here reaches patch-data.json.
   CC.ART.sheet is one inline <symbol> sheet injected at boot; the DOM uses
   <svg class="ic"><use href="#i-…"/></svg> and the canvas draws the SAME
   path strings through Path2D (CSS variables do not reach canvas, so fills
   map through a JS palette). 24-unit grid, 2-unit ink stroke in
   currentColor, flat fills from tokens only. The sheet itself is authored
   in src/art-sheet.svg.txt and pasted below by build.js. */
globalThis.CC = globalThis.CC || {};
CC.ART = CC.ART || {};
CC.ART.sheet = CC.ART.sheet || '';

/* an inline icon: <svg class="ic"><use href="#i-id"/></svg> */
CC.icon = function (id, cls) {
  return `<svg class="ic${cls ? ' ' + cls : ''}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
};

/* inject the sheet once the DOM exists; idempotent */
CC.ART.inject = function () {
  if (typeof document === 'undefined' || document.getElementById('cc-art') || !CC.ART.sheet) return;
  const host = document.createElement('div');
  host.innerHTML = `<svg id="cc-art" width="0" height="0" style="position:absolute;width:0;height:0" aria-hidden="true">${CC.ART.sheet}</svg>`;
  document.body.insertBefore(host.firstChild, document.body.firstChild);
};

/* ---- the Path2D bridge ----
   artParts(id) parses a symbol's children into drawable parts:
   {path, fill, stroke, width, opacity, dash, cls}. fill/stroke are token
   names ('carrot', 'ink'…) resolved against a palette at draw time. */
CC.ART._cache = {};
CC.ART.tokenOf = function (v) {
  if (!v || v === 'none') return null;
  if (v === 'currentColor') return 'ink';
  const m = /var\(--([a-z0-9-]+)/.exec(v);
  if (m) return m[1];
  return v; /* a literal colour */
};
CC.ART.matrixOf = function (tf) {
  const M = typeof DOMMatrix !== 'undefined' ? new DOMMatrix() : null;
  if (!M || !tf) return M;
  let m = M;
  const re = /(rotate|translate|scale)\(([^)]*)\)/g;
  let x;
  while ((x = re.exec(tf))) {
    const a = x[2].trim().split(/[\s,]+/).map(Number);
    if (x[1] === 'rotate') {
      if (a.length >= 3) m = m.translate(a[1], a[2]).rotate(a[0]).translate(-a[1], -a[2]);
      else m = m.rotate(a[0]);
    } else if (x[1] === 'translate') m = m.translate(a[0] || 0, a[1] || 0);
    else if (x[1] === 'scale') m = m.scale(a[0] || 1, a.length > 1 ? a[1] : a[0] || 1);
  }
  return m;
};
CC.ART.parts = function (id, overrides) {
  const key = id + '|' + (overrides ? JSON.stringify(overrides) : '');
  if (CC.ART._cache[key]) return CC.ART._cache[key];
  const sym = typeof document !== 'undefined' ? document.getElementById('i-' + id) : null;
  const out = [];
  if (!sym || typeof Path2D === 'undefined') { CC.ART._cache[key] = out; return out; }
  const vb = (sym.getAttribute('viewBox') || '0 0 24 24').split(/\s+/).map(Number);
  out.box = { w: vb[2], h: vb[3] };
  const walk = (el, inherit) => {
    for (const ch of el.children) {
      const tag = ch.tagName.toLowerCase();
      const style = ch.getAttribute('style') || '';
      const ov = Object.assign({}, inherit || {});
      const sm = style.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+)/g);
      for (const s of sm) ov[s[1]] = s[2].trim();
      if (tag === 'use') {
        const ref = (ch.getAttribute('href') || ch.getAttribute('xlink:href') || '').replace('#i-', '');
        for (const p of CC.ART.parts(ref, ov)) out.push(p);
        continue;
      }
      if (tag === 'g') { walk(ch, ov); continue; }
      let path = null;
      if (tag === 'path') path = new Path2D(ch.getAttribute('d') || '');
      else if (tag === 'circle') { path = new Path2D(); path.arc(+ch.getAttribute('cx'), +ch.getAttribute('cy'), +ch.getAttribute('r'), 0, Math.PI * 2); }
      else if (tag === 'ellipse') { path = new Path2D(); path.ellipse(+ch.getAttribute('cx'), +ch.getAttribute('cy'), +ch.getAttribute('rx'), +ch.getAttribute('ry'), 0, 0, Math.PI * 2); }
      else if (tag === 'rect') { path = new Path2D(); path.rect(+ch.getAttribute('x') || 0, +ch.getAttribute('y') || 0, +ch.getAttribute('width'), +ch.getAttribute('height')); }
      else if (tag === 'line') { path = new Path2D(); path.moveTo(+ch.getAttribute('x1'), +ch.getAttribute('y1')); path.lineTo(+ch.getAttribute('x2'), +ch.getAttribute('y2')); }
      else if (tag === 'polygon' || tag === 'polyline') {
        const pts = (ch.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number);
        path = new Path2D();
        for (let i = 0; i + 1 < pts.length; i += 2) { if (i === 0) path.moveTo(pts[i], pts[i + 1]); else path.lineTo(pts[i], pts[i + 1]); }
        if (tag === 'polygon') path.closePath();
      }
      if (!path) continue;
      const tf = ch.getAttribute('transform');
      if (tf) { const m = CC.ART.matrixOf(tf); const p2 = new Path2D(); p2.addPath(path, m); path = p2; }
      const fillAttr = ch.getAttribute('fill');
      let fill = CC.ART.tokenOf(fillAttr === null ? (tag === 'path' || tag === 'line' || tag === 'polyline' ? 'none' : 'currentColor') : fillAttr);
      const sw = ch.getAttribute('stroke-width');
      let stroke = CC.ART.tokenOf(ch.getAttribute('stroke'));
      /* token overrides from a <use style="--fur:…"> */
      const resolve = t => (t && ov[t] !== undefined ? CC.ART.tokenOf(ov[t]) || ov[t] : t);
      fill = resolve(fill); stroke = resolve(stroke);
      out.push({
        path, fill, stroke, width: sw === null ? 2 : +sw,
        opacity: ch.getAttribute('opacity') === null ? 1 : +ch.getAttribute('opacity'),
        dash: ch.getAttribute('stroke-dasharray') ? ch.getAttribute('stroke-dasharray').split(/[\s,]+/).map(Number) : null,
        cls: ch.getAttribute('class') || '',
        cap: ch.getAttribute('stroke-linecap') || 'round', join: ch.getAttribute('stroke-linejoin') || 'round',
      });
    }
  };
  walk(sym, overrides);
  CC.ART._cache[key] = out;
  return out;
};

/* draw symbol `id` with its top-left at (x, y) scaled to `size` (the
   viewBox width). pal maps token names → CSS colours; pal.ink is the
   stroke. opts.part(part, index) may return a DOMMatrix to nudge one part
   (the hero's fronds sway this way). */
CC.ART.draw = function (ctx, id, x, y, size, pal, opts) {
  const parts = CC.ART.parts(id, opts && opts.overrides);
  if (!parts.length) return false;
  const box = parts.box || { w: 24, h: 24 };
  const s = size / box.w;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  parts.forEach((p, i) => {
    let path = p.path;
    const m = opts && opts.part ? opts.part(p, i) : null;
    if (m) { path = new Path2D(); path.addPath(p.path, m); }
    ctx.globalAlpha = (opts && opts.alpha !== undefined ? opts.alpha : 1) * p.opacity;
    if (p.fill) {
      ctx.fillStyle = pal[p.fill] || (p.fill[0] === '#' || p.fill.startsWith('rgb') ? p.fill : pal.ink);
      ctx.fill(path);
    }
    if (p.stroke) {
      ctx.strokeStyle = pal[p.stroke] || (p.stroke[0] === '#' || p.stroke.startsWith('rgb') ? p.stroke : pal.ink);
      ctx.lineWidth = p.width;
      ctx.setLineDash(p.dash || []);
      ctx.stroke(path);
      ctx.setLineDash([]);
    }
  });
  ctx.globalAlpha = 1;
  ctx.restore();
  return true;
};

/* the canvas palette for a theme pack: token → colour. Packs keep their
   own carrot/leaf/soil; the rest is the house set. */
CC.ART.palette = function (pal, night) {
  return {
    ink: night ? '#f3e9d6' : '#3b2b16',
    carrot: pal && pal.body ? pal.body[0] : '#ff9232',
    'carrot-deep': pal && pal.body ? pal.body[1] : '#d4570a',
    leaf: pal && pal.tops ? pal.tops : '#6fbf5a',
    paper: '#f6ead2', wood: '#6b4a24', rib: '#dc2626', soil: pal && pal.soil ? pal.soil[0] : '#5a3c22',
    seed: '#eab8e4', honey: '#e7b23a', stone: '#8c8c86', sky: '#8fb8de', gold: '#d9a83f',
    fur: '#e8c25a', tail: '#fff8e0', pars: '#e8ddb8',
  };
};

/* kind glyphs for upgrades and the Book's ladders */
CC.ART.kindOf = function (u) {
  if (!u) return 'seal';
  if (u.type === 'click') return 'hand';
  if (u.type === 'global') return 'sun';
  if (u.type === 'synergy') return 'link';
  if (u.type === 'building') return 'pips';
  return 'seal';
};
CC.ART.ladderGlyph = function (prefix) {
  return ({ sd: 'seed', sp: 'sprout', rb: 'rabbit', cl: 'hand', pl: 'wheat', up: 'seal', he: 'leaf', dz: 'book', vt: 'rabbit-tin',
    vp: 'stall', vw: 'sun', tr: 'trial', sb: 'pl-ready', fy: 'fallow', rn: 'windowbox', ss: 'seed', bu: 'wheat', mk: 'market',
    ln: 'lantern', pg: 'book' })[prefix] || 'book';
};
/* an icon for a plant: by what it does */
CC.ART.plantGlyph = function (p) {
  if (!p) return 'pl-seed';
  if (p.wild) return 'pl-dead';
  if (p.honey) return 'honey';
  if (p.rabbit) return 'ear';
  if (p.weather) return 'umbel';
  return 'pl-ready';
};
