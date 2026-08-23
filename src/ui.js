/* Carrot Clicker — UI: hero canvas, shop, upgrades, ticker, toasts, save. */
globalThis.CC = globalThis.CC || {};

CC.audio = {
  ctx: null, muted: false,
  ensure() {
    if (this.ctx || typeof AudioContext === 'undefined') return;
    this.ctx = new AudioContext();
    this.g = this.ctx.createGain();
    this.g.gain.value = 0.4;
    this.g.connect(this.ctx.destination);
  },
  blip(f, dur = 0.12, type = 'sine', vol = 0.15, slide = null, when = 0) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(this.g);
    o.start(t0); o.stop(t0 + dur + 0.02);
  },
  pop() { this.blip(320 + Math.random() * 120, 0.09, 'triangle', 0.12, 160); },
  thunk() { this.blip(120, 0.15, 'sine', 0.18, 70); },
  upgrade() { this.blip(660, 0.15, 'triangle', 0.12); this.blip(990, 0.2, 'triangle', 0.1, null, 0.09); },
  fanfare() { [523, 659, 784, 1047].forEach((f, i) => this.blip(f, 0.35, 'triangle', 0.11, null, i * 0.11)); },
  rabbit() { this.blip(880, 0.1, 'sine', 0.14, 1320); this.blip(1320, 0.15, 'sine', 0.11, 1760, 0.1); },
  seed() { [392, 523, 659, 880, 1175].forEach((f, i) => this.blip(f, 0.4, 'triangle', 0.1, null, i * 0.14)); },
};

/* Season theme packs (R18): every season owns a day/night pair. CSS lives
   in styles.css under #cc-root[data-theme=…]; this table paints the canvas
   backdrop + carrot. Season comes from the server (the whole world re-skins
   together when the calendar turns); day/night is a per-player preference. */
CC.THEMES = {
  'homestead-day': { sky: ['#5a4a7a', '#c98a5a', '#e8b06a'], orb: [250, 60, 60, '255,240,190'],
    moon: false, stars: false, hedge: '#31502e', soil: ['#4a3421', '#2a2016'],
    body: ['#ff9232', '#d4570a'], tops: '#3f9142', rain: 'rgba(150,180,215,0.4)' },
  'homestead-night': { sky: ['#0b1526', '#13233a', '#1b3247'], orb: [240, 52, 40, '223,232,244'],
    moon: true, stars: true, hedge: '#152a22', soil: ['#1d2b26', '#0d1512'],
    body: ['#ffa04a', '#c25a14'], tops: '#3f8f6a', rain: 'rgba(185,215,245,0.36)' },
  'fair-day': { sky: ['#5f97c8', '#a8c8e0', '#e8d8a8'], orb: [245, 52, 55, '255,246,200'],
    moon: false, stars: false, hedge: '#3f7a3a', soil: ['#5a4228', '#332618'],
    body: ['#ff8832', '#d4570a'], tops: '#3f9142', rain: 'rgba(55,85,125,0.4)' },
  'fair-night': { sky: ['#2a3052', '#3d3660', '#6b4a4e'], orb: [248, 40, 26, '255,222,150'],
    moon: false, stars: true, hedge: '#26332c', soil: ['#41301e', '#241a10'],
    body: ['#ff9232', '#d4570a'], tops: '#4a9a44', rain: 'rgba(185,215,245,0.36)' },
  'market-day': { sky: ['#8ecae6', '#cfe6f0', '#f4e9c8'], orb: [242, 50, 62, '255,246,200'],
    moon: false, stars: false, hedge: '#3f8a4a', soil: ['#6a4c2e', '#4a3420'],
    body: ['#f2701d', '#c2490a'], tops: '#3f9142', rain: 'rgba(55,85,125,0.4)' },
  'market-night': { sky: ['#231d3e', '#181230', '#2c1f3a'], orb: [238, 46, 34, '240,232,216'],
    moon: true, stars: true, hedge: '#1f3326', soil: ['#302038', '#180f20'],
    body: ['#ffb054', '#c86018'], tops: '#4a8a5a', rain: 'rgba(185,215,245,0.36)' },
};

/* R21 client cues (DESIGN Tunables): the away summary needs an hour's gap;
   an order's due label turns urgent inside six hours */
CC.AWAY_AFTER = 3600;
CC.DUE_SOON = 6 * 3600;

CC.UI = class {
  constructor(core) {
    this.core = core;
    this.$ = id => document.getElementById(id);
    this.canvas = this.$('hero');
    this.ctx = this.canvas.getContext('2d');
    this.t = 0;
    this.squash = 0;
    this.particles = [];
    this.floats = [];
    this.buyN = 1;
    this.visitor = null; /* R19: {kind, x, y, dir, born, patchTtl, leaving} */
    this.nextVisitor = CC.VISITOR_FIRST[0] +
      Math.random() * (CC.VISITOR_FIRST[1] - CC.VISITOR_FIRST[0]);
    this.tickerT = 0;
    this._upgSig = null; this._shopSig = null; this._shedSig = null;
    this._wipeArm = 0;

    this.store = (() => {
      try {
        localStorage.setItem('__cc_t', '1'); localStorage.removeItem('__cc_t');
        return localStorage;
      } catch (e) { return null; }
    })();

    /* served page = the world game, always; file:// = private dev garden (P6) */
    this.worldMode = location.protocol.startsWith('http');
    this.core.mirrorBook = this.worldMode; /* the server's almanac is the book (R16) */

    this.buildStatic();
    this.dayNight = this.pref('carrot-daynight') || 'auto'; /* ☀/🌙 is a display preference */
    this.autoClick = this.pref('carrot-autoclick') === '1'; /* RSI-friendly steady clicker */
    CC.fmtLong = this.pref('carrot-numbers') === 'long'; /* R21: readable numbers, a display preference */
    this.applyTheme();
    this.$('build-tag').textContent = `build ${CC.BUILD || 'dev'}`;
    this.load();
    this.bind();
    this.setTicker();
    this.tooltip(null);
    this.patch = new CC.Patch(this);
    if (this.worldMode) {
      this.setPatchWaiting();
      this.$('wipe-btn').classList.add('hidden'); /* nothing local to wipe */
    }

    /* community noticeboard (R11) */
    const glist = this.$('gardener-list');
    for (const n of (CC.GARDENERS || [])) {
      const d = document.createElement('div');
      d.textContent = n;
      glist.appendChild(d);
    }
    if (this.worldMode) {
      const saved = this.pref('carrot-tender-name');
      if (saved) this.$('tender-name').value = saved;
      this.$('tender-btn').addEventListener('click', () => this.signBoard());
      this.$('tender-name').addEventListener('keydown', e => { if (e.key === 'Enter') this.signBoard(); });
      this.fetchBoard();
      setInterval(() => this.fetchBoard(), 60000);
      /* the chronicle (R21) is the world's book — the dev garden keeps none */
      this.$('chronicle-btn').classList.remove('hidden');
      this._lastSeen = +this.pref('carrot-last-seen') || 0; /* read once, before the heartbeat */
      const seen = () => this.setPref('carrot-last-seen', String(Math.floor(Date.now() / 1000)));
      setInterval(seen, 60000);
      addEventListener('beforeunload', seen);
    } else {
      this.$('tender-sign').classList.add('hidden');
      this.$('tender-list').innerHTML =
        '<div class="board-empty">The world signs here — this is the dev garden.</div>';
    }

    /* the Quilt (R22): a canvas the world paints — world mode paints through
       the server, the dev garden paints its own cloth */
    const Q = CC.QUILT || { w: 48, h: 48, palette: ['#fff'], cooldown: 30, costSeconds: 1 };
    this.quilt = { w: Q.w, h: Q.h, v: -1, cells: new Uint8Array(Q.w * Q.h), lastPaint: -1e9, painted: 0 };
    this.quiltColor = 2;
    this.quiltCtx = this.$('quilt').getContext('2d');
    const pal = this.$('quilt-palette');
    Q.palette.forEach((hex, i) => {
      const b = document.createElement('button');
      b.style.background = hex; b.title = `colour ${i}`;
      b.classList.toggle('on', i === this.quiltColor);
      b.addEventListener('click', () => {
        this.quiltColor = i;
        for (const x of pal.children) x.classList.toggle('on', x === b);
      });
      pal.appendChild(b);
    });
    this.$('quilt').addEventListener('pointerdown', e => {
      const r = e.currentTarget.getBoundingClientRect();
      const x = Math.floor((e.clientX - r.left) / r.width * this.quilt.w);
      const y = Math.floor((e.clientY - r.top) / r.height * this.quilt.h);
      if (x >= 0 && y >= 0 && x < this.quilt.w && y < this.quilt.h) this.paintCell(y * this.quilt.w + x, this.quiltColor);
    });
    this.$('quilt-copy').addEventListener('click', () => this.copyQuilt());
    this.drawQuilt();

    /* the Seed Bed (R23): a shared bed under the carrot */
    this.bedCtx = this.$('bed').getContext('2d');
    this.bedMenuPlot = -1;
    this.$('bed').addEventListener('pointerdown', e => {
      const r = e.currentTarget.getBoundingClientRect();
      const W = CC.BED.w, H = CC.BED.h;
      const x = Math.floor((e.clientX - r.left) / r.width * W), y = Math.floor((e.clientY - r.top) / r.height * H);
      if (x < 0 || y < 0 || x >= W || y >= H) return;
      this.bedClick(y * W + x);
    });
    this.$('bed').addEventListener('mousemove', e => {
      const r = e.currentTarget.getBoundingClientRect();
      const W = CC.BED.w, H = CC.BED.h;
      const x = Math.floor((e.clientX - r.left) / r.width * W), y = Math.floor((e.clientY - r.top) / r.height * H);
      this.bedHover = (x >= 0 && y >= 0 && x < W && y < H) ? y * W + x : -1;
      this.bedTip();
    });
    this.$('bed').addEventListener('mouseleave', () => { this.bedHover = -1; this.tooltip(null); });
    const sb = this.$('soil-btns');
    for (const so of (CC.SOILS || [])) {
      const b = document.createElement('button');
      b.textContent = so.name; b.dataset.id = so.id; b.title = so.line;
      b.addEventListener('click', () => this.setSoil(so.id));
      sb.appendChild(b);
    }
    this.$('sacrifice-btn').addEventListener('click', () => this.askSacrifice());
    document.addEventListener('pointerdown', e => {
      const m = this.$('bed-menu');
      if (!m.classList.contains('hidden') && !m.contains(e.target) && e.target !== this.$('bed')) this.closeBedMenu();
    });

    let last = performance.now();
    const frame = now => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      this.t += dt;
      this.update(dt);
      this.render();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  /* ---------------- patch (global) mode ---------------- */
  patchOn() { return !!(this.patch && this.patch.on); }

  /* world mode before the first-ever snapshot: nothing real to act on yet */
  awaitingWorld() { return this.worldMode && !(this.patch && this.patch.everSynced); }

  setPatchMode(on) {
    document.querySelector('.wordmark span').textContent = on ? 'PATCH' : 'CLICKER';
    this.$('patch-line').classList.toggle('hidden', !on);
    this.updatePatchLine();
  }

  /* served page, no snapshot yet: branded as the world, visibly not there */
  setPatchWaiting() {
    document.querySelector('.wordmark span').textContent = 'PATCH';
    this.$('patch-line').classList.remove('hidden');
    this.$('patch-line').textContent = '🌍 Reaching the carrot patch…';
  }

  updatePatchLine() {
    if (this.patchOn()) {
      const hb = this.core.handsBonus || 1;
      this.$('patch-line').textContent =
        `🌍 ${this.patch.online} tender${this.patch.online === 1 ? '' : 's'} tending · ${CC.fmt(this.patch.clickRate)} clicks/s worldwide` +
        (hb > 1 ? ` · 🤝 ${this.fmtX(hb)} many hands` : '');
    }
  }

  /* connection lost but the patch exists: stay in world mode and say so —
     flipping back to CLICKER would lie about which garden you're in (P6) */
  setPatchResync() {
    this.$('patch-line').classList.remove('hidden');
    this.$('patch-line').textContent = '🌍 Re-syncing with the patch…';
  }

  /* ---------------- noticeboard (R11) ---------------- */
  /* localStorage preference — NOT game state, so allowed in world mode:
     it's your signature, and it must survive a page refresh */
  pref(k) { try { return this.store && this.store.getItem(k); } catch (e) { return null; } }
  setPref(k, v) { try { if (this.store) this.store.setItem(k, v); } catch (e) { /* private mode */ } }

  signBoard() {
    const name = this.$('tender-name').value.trim();
    if (!name) return;
    if (!this.patch.on) { this.toast('🪧 Still reaching the patch — try again in a moment.'); return; }
    this._signing = true;
    this.patch.send({ type: 'name', name });
  }

  nameResult(msg) {
    const loud = this._signing;
    this._signing = false;
    if (msg.ok) {
      this.setPref('carrot-tender-name', msg.name);
      this.$('tender-name').value = msg.name;
      if (loud) this.toast(`🪧 Signed the noticeboard as ${msg.name}.`);
      this.fetchBoard();
    } else if (loud) {
      this.toast('🪧 That name won’t fit on the noticeboard.');
    }
  }

  fetchBoard() {
    if (!this.worldMode) return;
    const dir = location.pathname.replace(/[^/]*$/, '');
    fetch(dir + 'api/board').then(r => r.json())
      .then(j => { this.renderTenders(j.tenders || []); this.renderPresence(j.presence); })
      .catch(() => { /* decorative; the minute poll will retry */ });
  }

  renderTenders(list) {
    const box = this.$('tender-list');
    box.innerHTML = '';
    if (!list.length) {
      const d = document.createElement('div');
      d.className = 'board-empty';
      d.textContent = 'Nobody has signed yet — be the first.';
      box.appendChild(d);
      return;
    }
    for (const t of list) {
      /* textContent, never innerHTML: names are player input */
      const row = document.createElement('div');
      row.className = 't-row';
      const who = document.createElement('span');
      who.textContent = t.name;
      const tally = document.createElement('span');
      tally.textContent = `${CC.fmt(t.clicks)} clicks · ${CC.fmt(t.buildings)} built`;
      row.append(who, tally);
      box.appendChild(row);
    }
  }

  /* the board a bot cannot own (R21): who was here today, the longest
     streaks, the founders — presence, never resources */
  renderPresence(p) {
    const box = this.$('presence');
    if (!p) { box.classList.add('hidden'); return; } /* pre-R21 server */
    box.classList.remove('hidden');
    box.innerHTML = '';
    const title = t => { const d = document.createElement('div'); d.className = 'p-title'; d.textContent = t; box.appendChild(d); };
    const row = (a, b) => {
      const r = document.createElement('div'); r.className = 'p-row';
      const x = document.createElement('span'); x.textContent = a;      /* names are player input: textContent only */
      const y = document.createElement('span'); y.textContent = b;
      r.append(x, y); box.appendChild(r);
    };
    const hands = p.hands_today || [], total = p.hands_count !== undefined ? p.hands_count : hands.length;
    title(`🤝 HERE TODAY · ${total}`);
    if (hands.length) {
      const d = document.createElement('div');
      d.textContent = hands.join(' · ') + (total > hands.length ? ` · …and ${total - hands.length} more` : '');
      box.appendChild(d);
    }
    else { const d = document.createElement('div'); d.className = 'board-empty'; d.textContent = 'Nobody yet today — sign in and tend.'; box.appendChild(d); }
    if ((p.streaks || []).some(x => x.streak > 1)) {
      title('🔥 STREAKS');
      for (const x of p.streaks) if (x.streak > 1) row(x.name, `${x.streak} day${x.streak === 1 ? '' : 's'} running · best ${x.best}`);
    }
    if ((p.founders || []).length) {
      title('🌱 FOUNDERS');
      for (const f of p.founders) row(f.name, `since ${f.since}`);
    }
  }

  /* ---------------- the chronicle (R21) ---------------- */
  /* server wall clock + our offset: deadlines and market clocks must never
     trust a tab whose clock is wrong */
  now() { return Date.now() / 1000 + (this.patch ? this.patch.skew : 0); }

  /* on every snapshot: if this tab was away an hour or more — closed, or a
     laptop lid shut with it open — the chronicle says what the world did
     meanwhile. The baseline is the previous snapshot, so a sleeping tab
     that redials gets its summary too (review R21). */
  whileAway() {
    if (!this.worldMode) return;
    const now = Date.now() / 1000;
    const last = this._lastSeen;
    this._lastSeen = now;
    const gap = now - last;
    if (!last || gap < CC.AWAY_AFTER) return;
    const dir = location.pathname.replace(/[^/]*$/, '');
    const since = Math.floor(last + (this.patch ? this.patch.skew : 0)); /* server time, not the tab's */
    fetch(dir + 'api/chronicle?since=' + since).then(r => r.json()).then(j => {
      const evs = j.events || [];
      if (!evs.length) return;
      const n = t => evs.filter(e => e.type === t).length;
      const parts = [];
      const add = (k, one, many) => { if (k) parts.push(`${k} ${k === 1 ? one : many}`); };
      add(n('prestige'), 'spring', 'springs');
      add(n('almanac'), 'page written', 'pages written');
      add(n('ribbon'), 'ribbon', 'ribbons');
      add(n('catch'), 'guest caught', 'guests caught');
      add(n('weather'), 'rain', 'rains');
      add(n('shed') + n('upgrade'), 'thing bought', 'things bought');
      for (const e of evs.filter(e => e.type === 'order_resolved'))
        parts.push(e.won ? `${e.name} met (tier ${e.tier})` : `${e.name} missed`);
      if (n('market_open')) parts.push('a Market Hour');
      if (parts.length) this.toast(`🌍 While you were away (${CC.fmtDur(gap)}): ${parts.join(', ')}.`);
    }).catch(() => { /* decorative */ });
  }

  openChronicle() {
    const box = this.$('chronicle-days');
    box.innerHTML = '<div class="board-empty">Turning the pages…</div>';
    this.$('chronicle').classList.remove('hidden');
    const dir = location.pathname.replace(/[^/]*$/, '');
    fetch(dir + 'api/chronicle').then(r => r.json())
      .then(j => this.renderChronicle(j.days || []))
      .catch(() => { box.innerHTML = '<div class="board-empty">The book is out of reach — try again in a moment.</div>'; });
  }

  noteText(e) {
    const who = e.who ? e.who : 'someone';
    if (e.type === 'prestige') {
      const tt = e.trial && (CC.TRIALS || []).find(x => x.id === e.trial);
      return `🌸 the garden went to seed (+${CC.fmt(e.gained || 0)} seeds)${tt ? ` — into ${tt.name}` : ''}`;
    }
    if (e.type === 'season') { const s = CC.SEASONS.find(x => x.id === e.id); return `🎪 ${s ? s.name : 'a new season'} began`; }
    if (e.type === 'order_posted') return `📜 the Parish posted ${e.name}`;
    if (e.type === 'order_resolved') return e.won ? `📜 ${e.name} met — tier ${e.tier}` : `📜 ${e.name} missed`;
    if (e.type === 'ribbon') { const r = CC.RIBBONS[e.i]; return `🎀 ${r ? r.name : 'a ribbon'}`; }
    if (e.type === 'almanac') { const pg = CC.ALMANAC.find(p => p.id === e.id); return `📖 ${pg ? pg.name : 'a page'} was written`; }
    if (e.type === 'quiet') return `🌙 the garden stirred after ${e.hours}h of quiet`;
    if (e.type === 'market_open') return '🏪 Market Hour';
    return null;
  }

  renderChronicle(days) {
    const box = this.$('chronicle-days');
    box.innerHTML = '';
    if (!days.length) { box.innerHTML = '<div class="board-empty">Nothing written yet — the first page is today.</div>'; return; }
    const labels = { catch: 'guests caught', weather: 'rains', shed: 'sprouts planted', upgrade: 'upgrades', bumper: 'bumper crops', ribbon: 'ribbons', almanac: 'pages', prestige: 'springs' };
    for (const d of days) {
      const el = document.createElement('div'); el.className = 'c-day';
      const h = document.createElement('div'); h.className = 'c-date'; h.textContent = d.day; el.appendChild(h);
      const counts = Object.entries(d.counts || {}).filter(([k]) => labels[k]).map(([k, v]) => `${v} ${labels[k]}`);
      const c = document.createElement('div'); c.className = 'c-counts'; c.textContent = counts.join(' · ') || 'a quiet day'; el.appendChild(c);
      for (const e of (d.notable || [])) {
        const t = this.noteText(e); if (!t) continue;
        const n = document.createElement('div'); n.className = 'c-note'; n.textContent = t; el.appendChild(n);
      }
      box.appendChild(el);
    }
    this._chronicleDays = days;
  }

  /* Today's Patch: a plain-text card for chats and feeds — no images, no
     build step, just the day in words */
  shareCard() {
    const c = this.core, p = this.patch;
    const today = (this._chronicleDays || [])[0];
    const cnt = (today && today.counts) || {};
    const o = p && p.order;
    const lines = [
      `🥕 TODAY'S PATCH — ${today ? today.day : new Date().toISOString().slice(0, 10)}`,
      `🌍 ${p ? p.online : 0} tending now · lifetime harvest ${CC.fmt(c.totalAllTime)} · ${CC.fmt(c.cps())}/s`,
      `🌸 ${cnt.prestige || 0} springs · 📖 ${cnt.almanac || 0} pages · 🐇 ${cnt.catch || 0} guests · 🍯 ${CC.fmt(c.honey)} honey`,
      o ? `📜 ${o.name} — tier ${o.tier} of 3, due in ${CC.fmtDur(o.deadline - this.now())}` : '',
      location.href.replace(/[?#].*$/, ''),
    ].filter(Boolean);
    const text = lines.join('\n');
    const done = () => this.toast('📋 Today’s Patch copied — paste it anywhere.');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => this.toast(text));
    else this.toast(text);
  }

  /* ---------------- the Quilt (R22) ---------------- */
  fetchQuilt() {
    if (!this.worldMode || this._quiltFetching) return;
    this._quiltFetching = true;
    const dir = location.pathname.replace(/[^/]*$/, '');
    fetch(dir + 'api/quilt').then(r => r.json()).then(j => {
      this._quiltFetching = false;
      if (!j || !j.cells || j.v <= this.quilt.v) return;
      const raw = j.cells;
      for (let i = 0; i < this.quilt.cells.length && 2 * i + 1 < raw.length; i++) {
        this.quilt.cells[i] = parseInt(raw.substr(2 * i, 2), 16) || 0;
      }
      this.quilt.v = j.v; this.quilt.painted = j.painted || 0;
      this.drawQuilt();
    }).catch(() => { this._quiltFetching = false; });
  }

  paintCell(i, c) {
    if (this.awaitingWorld()) return;
    const Q = CC.QUILT || { cooldown: 30, costSeconds: 1 };
    const wait = Q.cooldown - (this.t - this.quilt.lastPaint);
    if (wait > 0) { this.toast(`🧵 The needle rests — ${Math.ceil(wait)}s before your next stitch.`); return; }
    if (this.quilt.cells[i] === c) return;
    this.quilt.lastPaint = this.t;
    if (this.worldMode) { this.patch.send({ type: 'paint', i, c }); return; }
    this.quilt.cells[i] = c; this.quilt.painted++;
    this.core.bank = Math.max(0, this.core.bank - this.core.cps() * Q.costSeconds);
    this.drawQuilt();
  }

  drawQuilt() {
    const Q = CC.QUILT || { palette: ['#fff'] }, x = this.quiltCtx, q = this.quilt;
    for (let i = 0; i < q.cells.length; i++) {
      x.fillStyle = Q.palette[q.cells[i]] || Q.palette[0];
      x.fillRect(i % q.w, Math.floor(i / q.w), 1, 1);
    }
    let n = 0; for (const c of q.cells) if (c) n++;
    this.$('quilt-info').textContent =
      `${Math.round(n / q.cells.length * 100)}% stitched · ${CC.fmt(q.painted)} stitches ever · one stitch per ${(Q.cooldown || 30)}s, for a second of harvest`;
  }

  /* the quilt as a picture: ×6 upscale, pixel-crisp, to the clipboard (or a
     new tab when the clipboard is shy) */
  copyQuilt() {
    const q = this.quilt, big = document.createElement('canvas');
    big.width = q.w * 6; big.height = q.h * 6;
    const bx = big.getContext('2d');
    bx.imageSmoothingEnabled = false;
    bx.drawImage(this.$('quilt'), 0, 0, big.width, big.height);
    const open = () => { try { window.open(big.toDataURL('image/png'), '_blank'); } catch (e) { /* blocked */ } };
    if (navigator.clipboard && window.ClipboardItem && big.toBlob) {
      big.toBlob(blob => {
        navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
          .then(() => this.toast('🧵 The quilt is on your clipboard — paste it anywhere.'), open);
      });
    } else open();
  }

  /* ---------------- the Seed Bed (R23) ---------------- */
  plotName(i) { return `${'ABCDEF'[i % CC.BED.w]}${Math.floor(i / CC.BED.w) + 1}`; }
  plantEffectText(p) {
    const bits = [];
    if (p.mult) bits.push(p.mult >= 1 ? `×${p.mult} production` : `×${p.mult} (a weed)`);
    if (p.rabbit) bits.push(`guests ×${p.rabbit}`);
    if (p.weather) bits.push(`rain lasts ×${p.weather}`);
    if (p.honey) bits.push(`+${p.honey} 🍯 on harvest`);
    if (p.payout) bits.push(`${p.payout} min of harvest on picking`);
    return bits.join(' · ') || 'keeps the bed company';
  }
  bedClick(i) {
    if (this.awaitingWorld()) return;
    const c = this.core, pl = c.bed.plots[i];
    this.closeBedMenu();
    if (!pl) { this.openBedMenu(i); return; }
    if (c.plotMature(pl)) {
      if (this.worldMode) { this.patch.send({ type: 'harvest', i }); return; }
      const r = c.bedHarvest(i);
      if (r) this.bedHarvested({ ...r, i, who: '' });
      return;
    }
    const p = c.plantData(pl.sp);
    this.toast(`🌱 ${p ? p.name : 'Something'} at ${this.plotName(i)} needs ${p ? p.mature - pl.age : '?'} more bed tick${p && p.mature - pl.age === 1 ? '' : 's'} (${CC.fmtDur(CC.BED.tick - c.bedT + Math.max(0, (p ? p.mature - pl.age : 1) - 1) * CC.BED.tick)}).`);
  }
  openBedMenu(i) {
    const c = this.core, m = this.$('bed-menu');
    this.bedMenuPlot = i;
    m.innerHTML = '';
    const head = document.createElement('div'); head.className = 'bm-head'; head.textContent = `PLANT AT ${this.plotName(i)}`; m.appendChild(head);
    const wait = CC.BED.plantCooldown - (this.t - (this.lastPlant === undefined ? -1e9 : this.lastPlant));
    if (wait > 0) { const w = document.createElement('div'); w.className = 'bm-sub'; w.textContent = `your trowel rests ${Math.ceil(wait)}s`; m.appendChild(w); }
    let any = false;
    for (const p of CC.PLANTS) {
      const price = c.bedPrice(p.id);
      if (!price) continue;
      any = true;
      const row = document.createElement('div');
      const can = price.carrots !== undefined ? c.bank >= price.carrots : c.honey >= price.honey;
      row.className = 'bm-row' + (can ? '' : ' cant');
      const nm = document.createElement('b'); nm.textContent = p.name;
      const cost = document.createElement('span');
      cost.textContent = price.carrots !== undefined ? `${CC.fmt(Math.ceil(price.carrots))} 🥕` : `${price.honey} 🍯`;
      row.append(nm, cost);
      row.title = `${p.flavor} — ${this.plantEffectText(p)} · matures in ${p.mature} ticks, lives ${p.life}`;
      if (can) row.addEventListener('click', () => this.plantAt(i, p.id));
      m.appendChild(row);
    }
    if (!any) { const d = document.createElement('div'); d.className = 'bm-sub'; d.textContent = 'Nothing to plant yet.'; m.appendChild(d); }
    const sub = document.createElement('div'); sub.className = 'bm-sub';
    sub.textContent = 'Tier-1 seeds cost minutes of harvest; anything found costs honey. Two mature neighbours may cross.';
    m.appendChild(sub);
    const cl = document.createElement('div'); cl.className = 'bm-close'; cl.textContent = 'close ✕';
    cl.addEventListener('click', () => this.closeBedMenu());
    m.appendChild(cl);
    const W = CC.BED.w, x = i % W, y = Math.floor(i / W);
    m.style.left = `${Math.min(60, x * (100 / W))}%`;
    m.style.top = `${Math.min(55, (y + 1) * (100 / CC.BED.h))}%`;
    m.classList.remove('hidden');
  }
  closeBedMenu() { this.$('bed-menu').classList.add('hidden'); this.bedMenuPlot = -1; }
  plantAt(i, sp) {
    this.closeBedMenu();
    const wait = CC.BED.plantCooldown - (this.t - (this.lastPlant === undefined ? -1e9 : this.lastPlant));
    if (wait > 0) { this.toast(`🌱 Your trowel rests — ${Math.ceil(wait)}s before the next seed.`); return; }
    this.lastPlant = this.t;
    if (this.worldMode) { this.patch.send({ type: 'plant', i, sp }); return; }
    if (this.core.bedPlant(i, sp)) { CC.audio.upgrade(); this.toast(`🌱 ${this.core.plantData(sp).name} planted at ${this.plotName(i)}.`); }
  }
  bedHarvested(r) {
    const p = this.core.plantData(r.sp);
    if (!p) return;
    const who = r.who ? r.who : 'a tender';
    if (r.first) {
      CC.audio.fanfare();
      this.toast(`📗 NEW IN THE SEED LOG: ${p.name}! ${p.flavor} (${who} picked it at ${this.plotName(r.i)})`);
    } else {
      CC.audio.upgrade();
      const bits = [];
      if (r.gain > 0) bits.push(`+${CC.fmt(r.gain)} 🥕`);
      if (r.honey > 0) bits.push(`+${r.honey} 🍯`);
      this.toast(`🧺 ${who} picked the ${p.name} at ${this.plotName(r.i)}${bits.length ? ` — ${bits.join(', ')}` : ''}.`);
    }
  }
  setSoil(id) {
    if (this.awaitingWorld()) return;
    const c = this.core, now = this.now();
    if (id === c.bed.soil) return;
    const left = CC.BED.soilCooldown - (now - c.bed.soilAt);
    if (left > 0) { this.toast(`🪨 The soil was turned ${CC.fmtDur(now - c.bed.soilAt)} ago — ${CC.fmtDur(left)} before it can change again.`); return; }
    if (this.worldMode) { this.patch.send({ type: 'soil', id }); return; }
    if (c.bedSoil(id, now)) this.toast(`🪨 The bed is ${CC.SOILS.find(x => x.id === id).name} now.`);
  }
  askSacrifice() {
    const c = this.core;
    if (c.bed.sacrificeLeft > 0) {
      if (this.worldMode) this.patch.send({ type: 'cancelSacrifice' }); else { c.bedCancel(); this.toast('🍯 The sacrifice is called off.'); }
      return;
    }
    if (!c.logFull()) return;
    this.$('modal-title').textContent = '🍯 Give up the seed log?';
    this.$('modal-body').innerHTML = `Every species is written. Giving the log up pays <b>${CC.BED.sacrificeHoney} honey</b> and a permanent Almanac page — ` +
      `and clears the log, so every cross must be found again (found seeds cost honey until they are). ` +
      `A <b>${CC.fmtDur(CC.BED.sacrificeWait)}</b> countdown runs first; anyone can cancel it.`;
    this.$('trial-pick').classList.add('hidden');
    const yes = this.$('modal-yes');
    yes.textContent = 'Start the countdown';
    yes.onclick = () => {
      this.$('modal').classList.add('hidden');
      if (this.worldMode) this.patch.send({ type: 'sacrifice' }); else if (c.bedSacrifice()) this.toast('🍯 The countdown begins.');
    };
    this.$('modal').classList.remove('hidden');
  }
  bedTip() {
    const i = this.bedHover, c = this.core;
    if (i < 0) { this.tooltip(null); return; }
    const pl = c.bed.plots[i];
    if (!pl) { this.tooltip(null); return; }
    const p = c.plantData(pl.sp);
    if (!p) { this.tooltip(null); return; }
    const mature = c.plotMature(pl);
    this.tooltip({ kind: 'plant', p, pl, text: `${p.name} — ${this.plotName(i)}\n${p.flavor}\n${this.plantEffectText(p)}\n` +
      (mature ? `mature · ${p.life - pl.age} ticks of life left · click to pick` : `${p.mature - pl.age} ticks to maturity`) }, this.$('bed'));
  }
  /* a plant as five strokes: stem, leaves, a head coloured by what it does */
  drawBed() {
    const x = this.bedCtx, c = this.core, W = CC.BED.w, H = CC.BED.h, cw = 256 / W, ch = 256 / H;
    const soil = c.soilData();
    const ground = { dirt: ['#5a3c22', '#4a3019'], clay: ['#7a5540', '#5e4030'], chips: ['#8a6a3a', '#6b5028'] }[soil.id] || ['#5a3c22', '#4a3019'];
    for (let i = 0; i < W * H; i++) {
      const px = (i % W) * cw, py = Math.floor(i / W) * ch;
      x.fillStyle = ground[(i % W + Math.floor(i / W)) % 2];
      x.fillRect(px, py, cw, ch);
      x.strokeStyle = 'rgba(0,0,0,0.18)'; x.strokeRect(px + 0.5, py + 0.5, cw - 1, ch - 1);
      const pl = c.bed.plots[i];
      if (!pl) { if (i === this.bedHover) { x.fillStyle = 'rgba(255,220,120,0.12)'; x.fillRect(px, py, cw, ch); } continue; }
      const p = c.plantData(pl.sp);
      if (!p) continue;
      const mature = pl.age >= p.mature;
      const g = Math.min(1, (pl.age + 0.35) / p.mature);           /* growth 0..1 */
      const old = p.life < 900 && pl.age > p.life - 2;                /* about to die */
      const cx = px + cw / 2, base = py + ch - 8;
      const h = 10 + g * (ch - 24);
      const hue = p.mult && p.mult < 1 ? '#7d8a5a' : p.rabbit ? '#5fa65a' : p.weather ? '#6e8fd6' : p.honey ? '#e7b23a'
        : p.wild ? '#9a9a70' : p.tier >= 5 ? '#f0c060' : p.tier >= 4 ? '#c58ad0' : '#e8843a';
      x.strokeStyle = old ? '#6a5a3a' : '#3f7d33'; x.lineWidth = 2.5;
      x.beginPath(); x.moveTo(cx, base); x.quadraticCurveTo(cx + Math.sin(this.t * 1.3 + i) * 2, base - h / 2, cx, base - h); x.stroke();
      x.fillStyle = old ? '#7a6a45' : '#4c8a3a';
      for (let k = 0; k < 2 + Math.floor(g * 3); k++) {
        const ly = base - h * (0.25 + k * 0.2), dir = k % 2 ? 1 : -1;
        x.beginPath(); x.ellipse(cx + dir * 6, ly, 7, 3.2, dir * 0.5, 0, Math.PI * 2); x.fill();
      }
      if (mature) {
        const r = 6 + Math.min(3, p.tier);
        x.fillStyle = hue; x.beginPath(); x.arc(cx, base - h - 2, r, 0, Math.PI * 2); x.fill();
        x.strokeStyle = `rgba(255,230,150,${0.35 + Math.sin(this.t * 3 + i) * 0.2})`; x.lineWidth = 2;
        x.beginPath(); x.arc(cx, base - h - 2, r + 3, 0, Math.PI * 2); x.stroke();
      } else {
        x.fillStyle = hue; x.beginPath(); x.arc(cx, base - h, 2.5 + g * 3, 0, Math.PI * 2); x.fill();
      }
      if (i === this.bedHover) { x.fillStyle = 'rgba(255,220,120,0.12)'; x.fillRect(px, py, cw, ch); }
    }
    if (c.bed.sacrificeLeft > 0) {
      x.fillStyle = `rgba(240,180,60,${0.12 + Math.sin(this.t * 4) * 0.08})`; x.fillRect(0, 0, 256, 256);
    }
  }

  /* ---------------- Trials (R22) ---------------- */
  trialGoalText(id) { return CC.fog ? '???' : CC.fmt(this.core.trialGoal(id)); }

  /* the picker inside the Go to Seed modal: one rule, or a plain spring */
  buildTrialPick() {
    const c = this.core, box = this.$('trial-pick');
    box.innerHTML = '';
    this._trialChoice = null;
    if (!CC.TRIALS || !CC.TRIALS.length || c.trial) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    const head = document.createElement('div'); head.className = 'tp-head';
    head.textContent = 'WHICH SPRING? — a Trial is one rule for the whole world\'s next spring, 48 h to get back to where we were';
    box.appendChild(head);
    const mk = (id, name, line, meta, reward, maxed) => {
      const l = document.createElement('label');
      if (maxed) l.classList.add('maxed');
      const r = document.createElement('input'); r.type = 'radio'; r.name = 'trial'; r.disabled = maxed;
      r.checked = id === null;
      r.addEventListener('change', () => {
        this._trialChoice = id;
        for (const x of box.querySelectorAll('label')) x.classList.toggle('on', x === l);
      });
      const b = document.createElement('b'); b.textContent = name;
      const m = document.createElement('span'); m.className = 'tp-meta'; m.textContent = meta;
      const ln = document.createElement('span'); ln.className = 'tp-line'; ln.textContent = line;
      l.append(r, b, m, ln);
      if (reward) { const rw = document.createElement('span'); rw.className = 'tp-reward'; rw.textContent = reward; l.appendChild(rw); }
      if (id === null) l.classList.add('on');
      box.appendChild(l);
    };
    mk(null, 'A plain spring', 'No rule. The garden simply begins again.', '', '');
    for (const t of CC.TRIALS) {
      const n = c.trialDone(t.id), maxed = !c.trialAvailable(t.id);
      const best = c.trialBest[t.id];
      mk(t.id, t.name, t.line,
        maxed ? `${n}/${CC.TRIAL.maxDone} — complete` : `goal ${this.trialGoalText(t.id)} · ${n}/${CC.TRIAL.maxDone}${best ? ` · best ${CC.fmtDur(best)}` : ''}`,
        maxed ? '' : `pays: ${t.rewardText}`, maxed);
    }
  }

  /* ---------------- persistence (dev garden only) ---------------- */
  save() {
    if (this.worldMode) return; /* world state lives on the server */
    if (this.store) this.store.setItem('carrot-clicker-save', JSON.stringify(this.core.serialize()));
  }
  load() {
    if (this.worldMode || !this.store) return;
    try {
      const raw = this.store.getItem('carrot-clicker-save');
      if (!raw) return;
      const { offline } = this.core.deserialize(JSON.parse(raw));
      if (offline > 1) this.toast(`While you were away, the garden grew: +${CC.fmt(offline)} 🥕`);
    } catch (e) { /* corrupted save: start fresh */ }
  }

  /* ---------------- DOM scaffolding ---------------- */
  buildStatic() {
    /* backdrop canvas — painted per-theme by paintBackdrop() (R18) */
    this.bg = document.createElement('canvas');
    this.bg.width = this.canvas.width;
    this.bg.height = this.canvas.height;
    this.soilY = 132;

    /* shop rows */
    const shop = this.$('shop');
    this.rows = CC.BUILDINGS.map((b, i) => {
      const row = document.createElement('div');
      row.className = 'b-row';
      row.innerHTML = `<div><div class="b-name"></div><div class="b-cost"></div></div><div class="b-count"></div>`;
      /* buy exactly what the row prices (×N selector); the old hidden
         shift-click-for-10 lied once buys became all-or-nothing */
      row.addEventListener('click', () => this.buyBuilding(i, this.buyN));
      row.addEventListener('mouseenter', () => this.tooltip({ kind: 'building', i }, row));
      row.addEventListener('mouseleave', () => this.tooltip(null));
      shop.appendChild(row);
      return row;
    });

    /* Potting Shed catalog (R13/R15): one-shots are completable; the
       repeatable grounds never are. Locked keystones tease as ??? until
       the world's counters open them. Text fills in updateDOM. */
    const sitems = this.$('shed-items');
    this.shedEls = CC.SHED.map(u => {
      const el = document.createElement('div');
      el.className = 'shed-item';
      el.innerHTML = `<div class="s-head"><b><span class="s-name"></span><span class="s-lv"></span></b>` +
        `<span class="s-cost"></span></div>` +
        `<div class="s-effect"></div>` +
        `<div class="s-flavor"></div>`;
      el.addEventListener('click', () => this.buyShed(u.id));
      sitems.appendChild(el);
      return el;
    });

    /* the Almanac (R16): 72 page-slots, filled as the world's deeds latch */
    const abox = this.$('almanac-pages');
    this.almanacEls = CC.ALMANAC.map(pg => {
      const el = document.createElement('div');
      el.className = 'a-page locked';
      el.addEventListener('mouseenter', () => this.tooltip({ kind: 'almanac', pg }, el));
      el.addEventListener('mouseleave', () => this.tooltip(null));
      abox.appendChild(el);
      return el;
    });

    /* ribbon shelf */
    const shelf = this.$('ribbons');
    this.ribbonEls = CC.RIBBONS.map(r => {
      const el = document.createElement('div');
      el.className = 'ribbon locked';
      el.style.background = r.color;
      el.addEventListener('mouseenter', () => this.tooltip({ kind: 'ribbon', r }, el));
      el.addEventListener('mouseleave', () => this.tooltip(null));
      shelf.appendChild(el);
      return el;
    });
  }

  bind() {
    this.canvas.addEventListener('pointerdown', e => {
      CC.audio.ensure();
      const rect = this.canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (this.canvas.width / rect.width);
      const my = (e.clientY - rect.top) * (this.canvas.height / rect.height);
      if (this.visitor && !this.visitor.gone
        && Math.hypot(mx - this.visitor.x, my - this.visitor.y) < 34) {
        this.catchVisitor();
        return;
      }
      this.doClick(mx, my);
    });
    this.$('buy-amount').addEventListener('click', e => {
      const v = e.target.dataset.n;
      if (!v) return;
      this.buyN = v === 'max' ? 'max' : +v; /* ×1 · ×5 · ×10 · Max (R20) */
      for (const b of this.$('buy-amount').children) b.classList.toggle('on', b.dataset.n === v);
    });
    this.$('shed-btn').addEventListener('click', () => this.$('shed').classList.remove('hidden'));
    this.$('shed-close').addEventListener('click', () => this.$('shed').classList.add('hidden'));
    this.$('shed').addEventListener('click', e => {
      if (e.target === this.$('shed')) this.$('shed').classList.add('hidden');
    });
    this.$('prestige-btn').addEventListener('click', () => this.askPrestige());
    this.$('prestige-btn').addEventListener('mouseenter', () => this.tooltip({ kind: 'prestige' }, this.$('prestige-btn')));
    this.$('prestige-btn').addEventListener('mouseleave', () => this.tooltip(null));
    this.$('mute-btn').addEventListener('click', () => {
      CC.audio.ensure();
      CC.audio.muted = !CC.audio.muted;
      this.$('mute-btn').textContent = CC.audio.muted ? '🔇' : '🔊';
    });
    const dnLabel = () => (this.dayNight === 'auto' ? '🌗' : this.dayNight === 'day' ? '☀️' : '🌙');
    this.$('daynight-btn').textContent = dnLabel();
    this.$('daynight-btn').addEventListener('click', () => {
      this.dayNight = this.dayNight === 'auto' ? 'day' : this.dayNight === 'day' ? 'night' : 'auto';
      this.setPref('carrot-daynight', this.dayNight);
      this.$('daynight-btn').textContent = dnLabel();
      this.applyTheme();
    });
    const ab = this.$('auto-btn');
    ab.classList.toggle('on', this.autoClick);
    ab.addEventListener('click', () => {
      CC.audio.ensure();
      this.autoClick = !this.autoClick;
      ab.classList.toggle('on', this.autoClick);
      this.setPref('carrot-autoclick', this.autoClick ? '1' : '');
      this.toast(this.autoClick
        ? '🖱 Auto-click on — the garden pulls itself. Rest those wrists.'
        : '🖱 Auto-click off.');
    });
    const nb = this.$('num-btn');
    nb.classList.toggle('on', CC.fmtLong);
    nb.addEventListener('click', () => {
      CC.fmtLong = !CC.fmtLong;
      nb.classList.toggle('on', CC.fmtLong);
      this.setPref('carrot-numbers', CC.fmtLong ? 'long' : 'short');
      this._shopSig = this._upgSig = this._shedSig = this._statHtml = this._almanacSeen = null; /* repaint every number */
      this.toast(CC.fmtLong ? '🔢 Numbers in words — "tredecillion" it is.' : '🔢 Short numbers.');
    });
    this.$('chronicle-btn').addEventListener('click', () => this.openChronicle());
    this.$('chronicle-close').addEventListener('click', () => this.$('chronicle').classList.add('hidden'));
    this.$('chronicle-copy').addEventListener('click', () => this.shareCard());
    this.$('chronicle').addEventListener('click', e => {
      if (e.target === this.$('chronicle')) this.$('chronicle').classList.add('hidden');
    });
    this.$('wipe-btn').addEventListener('click', () => {
      if (this.t - this._wipeArm < 3) {
        if (this.store) this.store.removeItem('carrot-clicker-save');
        location.reload();
      } else {
        this._wipeArm = this.t;
        this.toast('Click 🗑 again within 3s to wipe your save.');
      }
    });
    this.$('modal-no').addEventListener('click', () => this.$('modal').classList.add('hidden'));
    setInterval(() => this.save(), 15000);
    addEventListener('beforeunload', () => this.save());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.save(); });
  }

  /* ---------------- actions ---------------- */
  doClick(mx, my) {
    if (this.awaitingWorld()) return;
    const g = this.core.click();
    if (this.patchOn()) this.patch.pending++;
    this.squash = 1;
    CC.audio.pop();
    this.floats.push({ x: mx, y: my, vy: -55, life: 1, text: `+${CC.fmt(g)}` });
    for (let i = 0; i < 6; i++) {
      this.particles.push({
        x: 160 + (Math.random() - 0.5) * 40, y: this.soilY + 6,
        vx: (Math.random() - 0.5) * 160, vy: -90 - Math.random() * 120,
        life: 0.7 + Math.random() * 0.4,
        col: Math.random() < 0.6 ? '#5a4128' : '#ff9232',
      });
    }
  }

  buyBuilding(i, n) {
    if (this.awaitingWorld()) return;
    CC.audio.ensure();
    /* 'max' resolves against the bank as it stands — locally for the dev
       garden, on the SERVER for the world (the shared bank moves) */
    const count = n === 'max' ? this.core.maxAffordable(i) : n;
    if (this.worldMode) {
      if (count >= 1) CC.audio.thunk(); /* prediction; the snapshot settles it */
      this.patch.send({ type: 'buy', b: i, n });
      return;
    }
    /* all-or-nothing, exactly like the ×N price on the row (audit f9) */
    if (count >= 1 && this.core.buy(i, count)) CC.audio.thunk();
  }

  buyUpgrade(id) {
    if (this.awaitingWorld()) return;
    CC.audio.ensure();
    if (this.worldMode) {
      this.patch.send({ type: 'upgrade', id });
      this.tooltip(null);
      return;
    }
    if (this.core.buyUpgrade(id)) {
      CC.audio.upgrade();
      this.tooltip(null);
    }
  }

  /* "Window Boxes", "Carrot Singularities" — never "Boxs"/"Singularitys" */
  plural(name) {
    if (/y$/.test(name)) return name.replace(/y$/, 'ies');
    if (/(s|x|ch|sh)$/.test(name)) return name + 'es';
    return name + 's';
  }

  /* one line per effect shape — the engine knows numbers, the skin words */
  shedEffectText(u) {
    if (u.mintMult) return `×${u.mintMult} sprouts from every Going to Seed`;
    if (u.bmult) return `${this.plural(CC.BUILDINGS[u.building].name)} +${Math.round((u.bmult - 1) * 100)}% per level · resprout each spring`;
    if (u.cpsPct) return `clicks +${(u.cpsPct * 100).toFixed(1)}% of CpS per level`;
    if (u.mult) return `+${Math.round((u.mult - 1) * 100)}% production${u.repeat ? ' per level' : ', forever'}`;
    return '';
  }

  buyShed(id) {
    if (this.awaitingWorld()) return;
    CC.audio.ensure();
    if (this.worldMode) {
      /* intent only — and only what the row itself would sell: clicks on
         locked, maxed or unaffordable items are no-ops, not blind sends */
      const u = CC.SHED.find(u => u.id === id);
      if (!u || !this.core.shedVisible(u) || this.core.shedMaxed(u)
        || this.core.sprouts < this.core.shedCost(id)) return;
      this.patch.send({ type: 'shed', id });
      return;
    }
    if (this.core.buyShed(id)) {
      const u = CC.SHED.find(u => u.id === id);
      CC.audio.seed();
      const lv = this.core.shedLevel(id);
      this.toast(`🌱 ${u.name}${u.repeat ? ` → Lv ${lv}` : ''}! ${this.shedEffectText(u)}.`);
    }
  }

  /* every visitor arrives the same way; the tin rabbit is DELIBERATELY
     announced with the golden line — the joke is the clank (R19) */
  spawnVisitor(kind, ttl, quiet) {
    this.visitor = { kind, x: -30, y: this.soilY - 14, dir: 1, born: this.t, patchTtl: ttl };
    if (quiet) return;
    this.toast(kind === 'parsnip'
      ? '🥕⁉ The Parsnip Man has set up a stall in the patch — first click decides for everyone…'
      : '🐇 A golden rabbit is loose in the patch — first click catches it!');
  }

  /* one renderer for visitor outcomes, local or world (F1 discipline) */
  visitorResult(r) {
    if (r.kind === 'tin') {
      CC.audio.thunk();
      this.toast('🥫 Clank. The tin rabbit. Somewhere, the parsnip man giggles.');
    } else if (r.kind === 'coup') {
      CC.audio.fanfare();
      this.toast(`🥕📈 Market coup! The stall folds — +${CC.fmt(r.gain || 0)} carrots for everyone!`);
    } else if (r.kind === 'embargo') {
      CC.audio.thunk();
      this.toast('🥀 Parsnip embargo! Production ×0.5 for 45 seconds. He got us this time.');
    } else { /* frenzy / lucky — the golden classic */
      CC.audio.rabbit();
      this.toast(`🐇 ${r.text}`);
    }
  }

  catchVisitor() {
    if (this.worldMode) {
      /* worldMode, not patchOn: during a re-sync gap the solo reward path
         must never run against predicted world state */
      this.patch.send({ type: 'catch' });
      /* tombstone, not null: an in-flight snapshot still carries the
         visitor and would ghost-respawn it (review F2) */
      this.visitor.gone = true;
      return;
    }
    const kind = this.visitor.kind;
    const r = this.core.visitorReward(kind);
    this.visitor = null;
    this.nextVisitor = this.t + CC.VISITOR_GAP[0] +
      Math.random() * (CC.VISITOR_GAP[1] - CC.VISITOR_GAP[0]);
    this.visitorResult(r);
    if (kind === 'rabbit') {
      this.$('ticker-text').textContent = CC.RABBIT_NEWS[Math.floor(Math.random() * CC.RABBIT_NEWS.length)];
      this.tickerT = -6;
    }
  }

  askPrestige() {
    if (this.awaitingWorld()) return;
    const c = this.core;
    const n = c.pendingSeeds();
    if (n < 1) return;
    const patch = this.worldMode;
    this.$('modal-title').textContent = patch ? '🌸 Send the WORLD to Seed?' : '🌸 Go to Seed?';
    this.$('modal-body').innerHTML = (patch
      ? `This is the <b>shared garden</b>. Going to seed resets it for <b>every gardener on Earth</b> —`
      : `Let go of every plot, stall, and contract. The garden resets to bare soil —`) +
      ` but ribbons are kept, and everyone gains <b>${CC.fmt(n)} seed${n > 1 ? 's' : ''}</b>.` +
      `<br><br>Each seed boosts all production by <b>+8%, forever</b>:` +
      ` seed bonus ${(() => {
        const a = this.fmtX(c.seedMult()), b = this.fmtX(1 + 0.08 * (c.seeds + n));
        return a === b ? `${a}, stacking +8% deeper` : `${a} → <b>${b}</b>`;
      })()}.` +
      (patch ? `<br><br><i>Your name will not be recorded. Your deed will be felt.</i>` : '');
    this.buildTrialPick();
    const yes = this.$('modal-yes');
    yes.textContent = `Go to seed (+${CC.fmt(n)})`;
    yes.onclick = () => {
      this.$('modal').classList.add('hidden');
      const trial = this._trialChoice || null;
      if (patch) {
        this.patch.send(trial ? { type: 'prestige', trial } : { type: 'prestige' });
        return; /* the server announces it to the world */
      }
      const before = this.core.seedMult();
      const gained = this.core.prestige(trial);
      if (this.core.trial) this.toast(`🧪 ${CC.TRIALS.find(t => t.id === trial).name} begins. Goal: ${this.trialGoalText(trial)}.`);
      CC.audio.seed();
      const b = this.core.seedMult() / before;
      this.toast(`🌸 Second spring. +${CC.fmt(gained)} seeds — ` + (b >= 1.0005
        ? `seed bonus ${this.fmtX(b)}, forever.`
        : `seed bonus now ${this.fmtX(this.core.seedMult())}.`));
      this.save();
    };
    this.$('modal').classList.remove('hidden');
  }

  /* ---------------- theme (R18) ---------------- */
  themeId() {
    const s = CC.THEMES[this.core.season + '-day'] ? this.core.season : 'homestead';
    let dn = this.dayNight;
    if (dn === 'auto') {
      const h = new Date().getHours();
      dn = h >= 7 && h < 19 ? 'day' : 'night';
    }
    return `${s}-${dn}`;
  }

  applyTheme() {
    const t = this.themeId();
    if (t === this._themeId) return;
    this._themeId = t;
    this.$('cc-root').dataset.theme = t;
    this._pal = CC.THEMES[t] || CC.THEMES['homestead-day'];
    this.paintBackdrop(this._pal);
  }

  paintBackdrop(pal) {
    const c = this.bg, x = c.getContext('2d'), soilY = this.soilY;
    const sky = x.createLinearGradient(0, 0, 0, soilY);
    sky.addColorStop(0, pal.sky[0]);
    sky.addColorStop(0.7, pal.sky[1]);
    sky.addColorStop(1, pal.sky[2]);
    x.fillStyle = sky;
    x.fillRect(0, 0, c.width, soilY);
    if (pal.stars) {
      for (let i = 0; i < 46; i++) { /* deterministic scatter: repaints identically */
        x.fillStyle = `rgba(255,255,255,${0.2 + ((i * 37) % 60) / 100})`;
        x.fillRect((i * 97 + 13) % c.width, (i * 53 + 7) % (soilY - 30), 1.4, 1.4);
      }
    }
    const [ox, oy, or, oc] = pal.orb;
    const orb = x.createRadialGradient(ox, oy, 0, ox, oy, or);
    orb.addColorStop(0, `rgba(${oc},0.95)`);
    orb.addColorStop(1, `rgba(${oc},0)`);
    x.fillStyle = orb;
    x.fillRect(ox - or, 0, or * 2, soilY);
    if (pal.moon) {
      x.fillStyle = `rgb(${oc})`;
      x.beginPath(); x.arc(ox, oy, 15, 0, Math.PI * 2); x.fill();
      x.fillStyle = 'rgba(120,140,170,0.4)';
      x.beginPath(); x.arc(ox - 5, oy - 4, 3.5, 0, Math.PI * 2);
      x.arc(ox + 6, oy + 5, 2.4, 0, Math.PI * 2); x.fill();
    }
    x.fillStyle = pal.hedge;
    x.fillRect(0, soilY - 16, c.width, 16);
    const soil = x.createLinearGradient(0, soilY, 0, c.height);
    soil.addColorStop(0, pal.soil[0]);
    soil.addColorStop(1, pal.soil[1]);
    x.fillStyle = soil;
    x.fillRect(0, soilY, c.width, c.height - soilY);
    for (let i = 0; i < 900; i++) { /* deterministic speckle, same reason */
      const px = (i * 61 + 17) % c.width, py = soilY + ((i * 41 + 5) % (c.height - soilY));
      x.fillStyle = i % 2 ? 'rgba(0,0,0,0.15)' : 'rgba(190,150,100,0.08)';
      x.fillRect(px, py, 1.5 + (i % 3), 1.5 + ((i + 1) % 3));
    }
  }

  /* Multiplier formatting: near-1 ratios keep 3 decimals (×1.008 must not
     collapse to ×1.01 or, worse, a 10-digit raw percent — audit f6/f7),
     mid-range gets 2, big ones go through CC.fmt (×22.68M). */
  fmtX(v) {
    if (v < 2) return '×' + v.toFixed(3);
    /* 999.995..1000 would toFixed-round to the nonsense "×1000.00" */
    if (v < 999.995) return '×' + (Number.isInteger(v) ? v : v.toFixed(2));
    return '×' + CC.fmt(v);
  }

  /* ---------------- feedback ---------------- */
  /* F1: the single place structured game events (from the local engine in
     the dev garden, from the server in world mode) become words + sound.
     Unknown event types are ignored — a newer server won't break us. */
  patchEvent(ev) {
    if (ev.type === 'ribbon') {
      const r = CC.RIBBONS[ev.i];
      if (!r) return;
      CC.audio.fanfare();
      this.toast(`🎀 ${r.name}! ${r.flavor} (+${Math.round((r.mult - 1) * 100)}% production)`);
    } else if (ev.type === 'bumper') {
      const b = CC.BUILDINGS[ev.b];
      if (!b) return;
      CC.audio.upgrade();
      this.toast(`🌾 Bumper crop! ${ev.at}× ${b.name} — +1% to everything.`);
    } else if (ev.type === 'upgrade') {
      const u = this.core.allUpgrades().find(u => u.id === ev.id);
      CC.audio.upgrade();
      this.toast(`🛠 Someone bought ${u ? u.name : 'an upgrade'}!`);
    } else if (ev.type === 'rabbitCaught') {
      CC.audio.rabbit();
      const what = ev.kind === 'frenzy'
        ? 'RABBIT FRENZY! Production ×7 for 30 seconds!'
        : `Lucky bundle! +${CC.fmt(ev.gain || 0)} carrots!`;
      this.toast(`🐇 Caught by a tender somewhere on Earth — ${what}`);
    } else if (ev.type === 'visitorCaught') {
      this.visitorResult({ kind: ev.out, gain: ev.gain });
    } else if (ev.type === 'weather') {
      const w = CC.WEATHER.find(x => x.id === ev.id);
      if (!w) return;
      CC.audio.upgrade();
      this.toast(`🌦 ${w.name} drifts across the whole garden — ×${w.mult} production for ${w.dur}s. ${w.line}`);
    } else if (ev.type === 'prestige') {
      if (!(ev.gained > 0)) return; /* malformed event must not toast "+∞ seeds" */
      CC.audio.seed();
      /* boost comes from the server (exact); older events fall back to
         deriving it from the post-snapshot seed count */
      const boost = ev.boost ||
        (this.core.seedMult() / (1 + 0.08 * Math.max(0, this.core.seeds - ev.gained)));
      /* at 100M+ seeds one prestige's ratio rounds to ×1.000 — announcing a
         no-op is worse than saying the part that still means something */
      const what = boost >= 1.0005
        ? `seed bonus ${this.fmtX(boost)}, now ${this.fmtX(this.core.seedMult())}`
        : `seed bonus now ${this.fmtX(this.core.seedMult())}`;
      const tt = ev.trial && (CC.TRIALS || []).find(x => x.id === ev.trial);
      this.toast(`🌸 SOMEONE SENT THE WHOLE GARDEN TO SEED. +${CC.fmt(ev.gained)} seeds ` +
        `— ${what}. ${tt ? `A TRIAL SPRING begins: ${tt.name} — ${tt.line}` : 'A new spring begins.'}`);
    } else if (ev.type === 'shed') {
      const u = CC.SHED.find(u => u.id === ev.id);
      if (!u) return;
      CC.audio.seed();
      this.toast(`🌱 A sprout was planted: ${u.name}${u.repeat && ev.lv ? ` → Lv ${ev.lv}` : ''}! ` +
        `${this.shedEffectText(u)}.`);
    } else if (ev.type === 'almanac') {
      const pg = CC.ALMANAC.find(p => p.id === ev.id);
      if (!pg) return;
      CC.audio.upgrade();
      this.toast(`📖 A page is written: ${pg.name} — ${pg.flavor}`);
    } else if (ev.type === 'season') {
      const s = CC.SEASONS.find(x => x.id === ev.id);
      if (!s) return;
      CC.audio.fanfare();
      this.toast(`🎪 A new season begins: ${s.name}! ${s.bonus}.`);
      this.$('ticker-text').textContent = s.line;
      this.tickerT = -6;
    } else if (ev.type === 'market') {
      /* the Market Hour (R21): the whole world's weekly appointment */
      const m = CC.MARKET_HOUR || {};
      if (ev.open) {
        CC.audio.fanfare();
        this.toast(`🏪 MARKET HOUR! The stalls are open for ${m.hours || 3} hours — prices −${Math.round((m.priceOff || 0.2) * 100)}%, guests ×${m.visitorRate || 4}, weather thick.`);
        this.$('ticker-text').textContent = 'The stalls are open. Bring your coin and your elbows.';
        this.tickerT = -6;
      } else {
        this.toast('🏪 The stalls close. Same time next week.');
      }
    } else if (ev.type === 'order') {
      if (ev.phase === 'posted') {
        CC.audio.upgrade();
        this.toast(`📜 The Parish posts an Order: ${ev.name}. Due in ${CC.fmtDur((ev.deadline || 0) - this.now())}.`);
      } else if (ev.phase === 'resolved') {
        const got = (ev.applied || []).join(', ');
        if (ev.tier > 0) { CC.audio.fanfare(); this.toast(`📜 ${ev.name} — tier ${ev.tier} met! The Parish pays: ${got}.`); }
        else { CC.audio.rabbit(); this.toast(`📜 ${ev.name} — missed. The Parish is not pleased: ${got}.`); }
      }
    } else if (ev.type === 'trial') {
      const t = (CC.TRIALS || []).find(x => x.id === ev.id);
      if (!t) return;
      if (ev.won) {
        CC.audio.fanfare();
        this.toast(`🧪 ${t.name} — WON in ${CC.fmtDur(ev.t || 0)}! The world is back where it was. ${t.rewardText} (${ev.n}/${CC.TRIAL.maxDone}).`);
      } else {
        CC.audio.rabbit();
        this.toast(`🧪 ${t.name} — the clock ran out. The spring carries on, rule lifted.`);
      }
    } else if (ev.type === 'bedPlant') {
      const p = this.core.plantData(ev.sp);
      if (p && ev.who) this.toast(`🌱 ${ev.who} planted ${p.name} at ${this.plotName(ev.i)}.`);
    } else if (ev.type === 'bedHarvest') {
      this.bedHarvested(ev);
    } else if (ev.type === 'bedSprout') {
      const p = this.core.plantData(ev.sp);
      if (!p) return;
      if (p.wild) { this.toast(`🌿 ${p.name} blew into the bed at ${this.plotName(ev.i)}.`); return; }
      CC.audio.upgrade();
      this.toast(`✨ Something crossed in the bed at ${this.plotName(ev.i)}: ${this.core.bed.log[ev.sp] ? p.name : 'a plant nobody has picked before'}. Let it grow.`);
    } else if (ev.type === 'bedDied') {
      /* quiet: the bed shows it */
    } else if (ev.type === 'soil') {
      const so = (CC.SOILS || []).find(x => x.id === ev.id);
      if (so) this.toast(`🪨 ${ev.who || 'A tender'} turned the bed to ${so.name}. ${so.line}`);
    } else if (ev.type === 'sacrificeStart') {
      CC.audio.seed();
      this.toast(`🍯 ${ev.who || 'Someone'} is giving up the seed log — ${CC.fmtDur(ev.left || 120)} to change our minds.`);
    } else if (ev.type === 'sacrificeCancel') {
      this.toast(`🍯 ${ev.who || 'Someone'} called off the sacrifice. The log stays.`);
    } else if (ev.type === 'sacrifice') {
      CC.audio.fanfare();
      this.toast(`🍯 The seed log is given up for ${ev.honey} honey. Seedless to Nay — the bed begins again.`);
    } else if (ev.type === 'paint') {
      if (ev.i >= 0 && ev.i < this.quilt.cells.length) {
        this.quilt.cells[ev.i] = ev.c; this.quilt.painted++;
        if (ev.v !== undefined) this.quilt.v = ev.v;
        this.drawQuilt();
      }
    } else if (ev.type === 'quiet') {
      const q = CC.QUIET || { boost: 2, boostHours: 1 };
      CC.audio.upgrade();
      this.toast(`🌙 The garden lay quiet for ${ev.hours}h. ${ev.who || 'A tender'} came back — Welcome Back ×${q.boost} for ${q.boostHours}h, everyone.`);
    }
  }

  toast(text) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    this.$('toasts').appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 0.6s'; }, 4200);
    setTimeout(() => el.remove(), 5000);
  }

  /* a floating note pinned beside the hovered element (never in the
     document flow): prefer the left side, fall back right, clamp to the
     viewport; hidden entirely when nothing is hovered */
  tooltip(what, el) {
    const tip = this.$('tooltip');
    this._tipKind = what && what.kind;
    tip.style.whiteSpace = what && what.kind === 'plant' ? 'pre-line' : '';
    if (!what) {
      tip.classList.add('hidden');
      return;
    }
    if (what.kind === 'building') {
      const b = CC.BUILDINGS[what.i], core = this.core;
      const each = b.cps * core.buildingMult(what.i) * core.globalMult();
      const owned = core.owned[what.i];
      const next = core.nextBumperAt(what.i);
      const tn = this.buyN === 'max' ? Math.max(1, core.maxAffordable(what.i)) : this.buyN;
      tip.innerHTML = `<b>${b.name}</b> — ${CC.fmt(Math.ceil(core.costOf(what.i, tn)))} 🥕${tn > 1 ? ` ×${tn}` : ''}` +
        `<br>Each produces <b>${CC.fmt(each)}</b>/s` +
        (owned ? ` · ${owned} owned making ${CC.fmt(each * owned)}/s` : '') +
        (next ? `<br>🌾 Bumper crop at <b>${next}</b> owned: +1% to ALL production` : '<br>🌾 Every bumper crop harvested!') +
        `<br><span class="flavor">${b.flavor}</span>`;
    } else if (what.kind === 'upgrade') {
      const u = what.u;
      tip.innerHTML = `<b>${u.name}</b> — ${CC.fmt(u.cost)} 🥕<br><span class="flavor">${u.flavor}</span>`;
    } else if (what.kind === 'ribbon') {
      const r = what.r, won = this.core.totalAllTime >= r.at;
      tip.innerHTML = `<b>${r.name}</b> — ${won ? `+${Math.round((r.mult - 1) * 100)}% production` : `awarded at ${CC.fmt(r.at)} lifetime carrots`}` +
        `<br><span class="flavor">${won ? r.flavor : '???'}</span>`;
    } else if (what.kind === 'almanac') {
      const pg = what.pg, got = !!this.core.almanac[pg.id];
      tip.innerHTML = got
        ? `<b>${pg.name}</b> — +${Math.round((CC.ALMANAC_MULT - 1) * 100)}% production, forever` +
          `<br><span class="flavor">${pg.flavor}</span>`
        : `<b>???</b> — an unwritten page<br><span class="flavor">The deed will name itself when it is done.</span>`;
    } else if (what.kind === 'plant') {
      tip.textContent = what.text; /* plain text, pre-wrapped: species names are data, but keep it simple */
    } else if (what.kind === 'prestige') {
      tip.innerHTML = `<b>Go to Seed</b> — prestige reset<br>` +
        `Seeds so far: earned at √(lifetime ÷ 1M). Each seed = +8% production, permanently.` +
        `<br><span class="flavor">Every carrot next year is a little bit you.</span>`;
    }
    /* measure invisibly, then pin beside the anchor */
    tip.style.visibility = 'hidden';
    tip.classList.remove('hidden');
    if (el) {
      const r = el.getBoundingClientRect();
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      let x = r.left - tw - 12;
      if (x < 8) x = r.right + 12;
      if (x + tw > innerWidth - 8) x = Math.max(8, innerWidth - tw - 8);
      const y = Math.max(8, Math.min(r.top + r.height / 2 - th / 2, innerHeight - th - 8));
      tip.style.left = `${x}px`;
      tip.style.top = `${y}px`;
    }
    tip.style.visibility = '';
  }

  setTicker() {
    const c = this.core;
    const pool = CC.NEWS.filter(n => c.totalAllTime >= n.min && c.seeds >= (n.minSeeds || 0));
    const pick = pool[Math.floor(Math.random() * pool.length)];
    const el = this.$('ticker-text');
    el.style.opacity = '0';
    setTimeout(() => { el.textContent = pick ? pick.text : ''; el.style.opacity = '1'; }, 400);
  }

  /* ---------------- per-frame ---------------- */
  update(dt) {
    const events = this.core.tick(dt);
    /* in world mode the server announces events to everyone; local engine
       events render only in the dev garden (never off predicted state) —
       and through the same renderer the server path uses (F1) */
    if (!this.worldMode) {
      for (const e of events) this.patchEvent(e);
    }

    /* auto-click (accessibility): a steady 8/s with gentler feedback —
       no per-click pop, one cumulative float per second */
    if (this.autoClick && !this.awaitingWorld()) {
      this._acT = (this._acT || 0) + dt;
      while (this._acT >= 0.125) {
        this._acT -= 0.125;
        const g = this.core.click();
        if (this.patchOn()) this.patch.pending++;
        this._acN = (this._acN || 0) + 1;
        if (this._acN % 8 === 0) {
          /* one visible pull per second — a distinct squash synced with the
             +N float — instead of an 8 Hz vibration (the clicks themselves
             still land every 125 ms; only the animation breathes slower) */
          this.squash = Math.max(this.squash, 0.8);
          this.floats.push({ x: 160 + (Math.random() - 0.5) * 60, y: this.soilY - 46,
            vy: -55, life: 1, text: `+${CC.fmt(g * 8)}` });
          for (let i = 0; i < 3; i++) {
            this.particles.push({
              x: 160 + (Math.random() - 0.5) * 30, y: this.soilY + 6,
              vx: (Math.random() - 0.5) * 110, vy: -70 - Math.random() * 80,
              life: 0.6 + Math.random() * 0.3,
              col: Math.random() < 0.6 ? '#5a4128' : '#ff9232',
            });
          }
        }
      }
    }

    /* visitor lifecycle (locally scheduled only in the dev garden, from
       the same data table the server reads — one brain, two clocks) */
    if (!this.worldMode && !this.visitor && this.t >= this.nextVisitor) {
      if (this.core.rule('noVisitors')) { /* Quiet Hedge (R22): nobody comes */
        this.nextVisitor = this.t + CC.VISITOR_GAP[0] + Math.random() * (CC.VISITOR_GAP[1] - CC.VISITOR_GAP[0]);
      } else {
        let w = CC.VISITORS.reduce((s, v) => s + v.weight, 0) * Math.random();
        const pick = CC.VISITORS.find(v => (w -= v.weight) < 0) || CC.VISITORS[0];
        this.spawnVisitor(pick.id, pick.ttl + (this.core.perks.longEars || 0) * CC.TRIAL.longEarsSec);
      }
    }
    if (this.visitor && !this.visitor.gone) {
      const r = this.visitor;
      const ttl = r.patchTtl || 12;
      /* a visitor doesn't blink out of existence — with 2.5s left it warns
         and makes for the nearest hedge gap */
      if (!r.leaving && this.t - r.born > ttl - 2.5) {
        r.leaving = true;
        r.dir = r.x < this.canvas.width / 2 ? -1 : 1;
        this.toast(r.kind === 'parsnip'
          ? '🥕 The Parsnip Man is folding up his stall…'
          : '🐇 The golden rabbit is hopping away…');
      }
      const pace = r.kind === 'parsnip' ? 25 : 55;
      r.x += r.dir * (r.leaving ? 170 : pace) * dt;
      if (!r.leaving) {
        if (r.x > this.canvas.width - 20) r.dir = -1;
        if (r.x < 20 && r.dir === -1) r.dir = 1;
      } else if (r.x < -40 || r.x > this.canvas.width + 40) {
        if (this.worldMode) {
          /* tombstone until the server agrees, or a snapshot would
             resurrect it at the hedge and re-warn (review F2) */
          r.gone = true;
        } else {
          this.visitor = null;
          this.nextVisitor = this.t + CC.VISITOR_GAP[0] +
            Math.random() * (CC.VISITOR_GAP[1] - CC.VISITOR_GAP[0]);
        }
      }
    }

    /* weather rolls locally in the dev garden (the world's rolls arrive
       as buffs in snapshots + a weather event) */
    if (!this.worldMode) {
      if (this.nextWeather === undefined) {
        this.nextWeather = this.t + CC.WEATHER_GAP[0] +
          Math.random() * (CC.WEATHER_GAP[1] - CC.WEATHER_GAP[0]);
      }
      if (this.t >= this.nextWeather) {
        this.nextWeather = this.t + CC.WEATHER_GAP[0] +
          Math.random() * (CC.WEATHER_GAP[1] - CC.WEATHER_GAP[0]);
        let w = CC.WEATHER.reduce((s, x) => s + x.weight, 0) * Math.random();
        const pick = CC.WEATHER.find(x => (w -= x.weight) < 0) || CC.WEATHER[0];
        this.core.buffs.push({ name: pick.name, mult: pick.mult, left: pick.dur });
        this.core.weathers++;
        this.core.mintHoney('rain'); /* R21: weather is a deed of the sky, in both gardens */
        this.patchEvent({ type: 'weather', id: pick.id });
      }
    }

    /* particles & floats */
    for (const p of this.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 420 * dt; p.life -= dt; }
    this.particles = this.particles.filter(p => p.life > 0);
    for (const f of this.floats) { f.y += f.vy * dt; f.life -= dt * 0.9; }
    this.floats = this.floats.filter(f => f.life > 0);
    if (this.squash > 0) this.squash = Math.max(0, this.squash - dt * 6);

    this.tickerT += dt;
    if (this.tickerT > 9) { this.tickerT = 0; this.setTicker(); }

    this.updateDOM();
  }

  updateDOM() {
    const c = this.core;
    this.applyTheme(); /* season turns and auto-day/night flips re-skin live */
    /* the Fog Trial (R22): every number on the page goes dark together */
    const fog = !!c.rule('hidden');
    if (fog !== !!CC.fog) {
      CC.fog = fog;
      this._shopSig = this._upgSig = this._shedSig = this._statHtml = this._almanacSeen = null;
    }
    /* the Trial banner (R22) */
    {
      const tl = this.$('trial-line'), tr = c.trial, td = tr && c.trialData();
      tl.classList.toggle('hidden', !td);
      if (td) {
        const left = Math.max(0, CC.TRIAL.hours * 3600 - tr.t);
        const halt = c.rule('haltOnBuy') && c.haltT > 0;
        tl.classList.toggle('halt', !!halt);
        tl.textContent = halt
          ? `🧪 ${td.name} · ❄ stilled — thaws in ${CC.fmtDur(c.haltT)} · ${CC.fmtDur(left)} left`
          : `🧪 ${td.name} · ${CC.fmt(c.totalRun)} / ${CC.fmt(tr.goal)} · ${CC.fmtDur(left)} left`;
        tl.title = td.line;
      }
    }
    this.$('bank').textContent = CC.fmt(Math.floor(c.bank));
    this.$('cps').textContent = `${CC.fmt(c.cps())} per second · click for ${CC.fmt(c.clickPower())}`;

    /* every buff, not just the first: a Bumper Week and a passing rain
       stack, and both deserve a clock (R21) */
    this.$('buff-line').textContent = c.buffs.map(b =>
      `⚡ ${b.name} ×${b.mult} — ${b.left >= 60 ? CC.fmtDur(b.left) : Math.ceil(b.left) + 's'}`).join(' · ');

    /* the Gate (R21): the honey jar and the Market Hour clock */
    {
      const gl = this.$('gate-line');
      const m = this.worldMode && this.patch && this.patch.everSynced ? this.patch.market : null;
      const mh = CC.MARKET_HOUR || {};
      const parts = [];
      if (c.honey > 0 || m) parts.push(`🍯 ${CC.fmt(c.honey)} honey`);
      if (m && m.active) parts.push(`🏪 MARKET HOUR — ${CC.fmtDur(m.end - this.now())} left · prices −${Math.round((mh.priceOff || 0.2) * 100)}%`);
      else if (m && m.next) parts.push(`🏪 Market Hour opens in ${CC.fmtDur(m.next - this.now())}`);
      gl.classList.toggle('hidden', !parts.length);
      gl.classList.toggle('market', !!(m && m.active));
      gl.textContent = parts.join(' · ');
    }

    /* the Seed Bed (R23): soil bar, clock, the seed log, the sacrifice */
    {
      const soil = c.soilData();
      for (const b of this.$('soil-btns').children) b.classList.toggle('on', b.dataset.id === c.bed.soil);
      const left = CC.BED.soilCooldown - (this.now() - c.bed.soilAt);
      const alive = c.bed.plots.filter(Boolean).length;
      this.$('bed-clock').textContent =
        `${soil.name} · tick in ${CC.fmtDur(CC.BED.tick - c.bedT)}${soil.every > 1 ? ` (grows every ${soil.every})` : ''}` +
        (left > 0 ? ` · soil in ${CC.fmtDur(left)}` : '') + ` · ${alive}/${c.bed.plots.length} plots` +
        (c.bedMult() !== 1 ? ` · ${this.fmtX(c.bedMult())}` : '');
      const logSig = CC.PLANTS.map(p => (c.bed.log[p.id] || 0)).join(',') + '|' + Math.round(c.bed.sacrificeLeft) + '|' + c.sacrifices;
      if (logSig !== this._logSig) {
        this._logSig = logSig;
        const known = CC.PLANTS.filter(p => c.bed.log[p.id]).length;
        this.$('seedlog-line').textContent = `${known}/${CC.PLANTS.length} species found` +
          (c.sacrifices ? ` · given up ${c.sacrifices}×` : '') + ' — two mature neighbours may cross; the recipes are not written down.';
        const box = this.$('seedlog');
        box.innerHTML = '';
        for (const p of CC.PLANTS) {
          const d = document.createElement('span');
          const n = c.bed.log[p.id] || 0;
          d.className = `sl t${p.tier}` + (n ? '' : ' unknown');
          d.textContent = n ? `${p.name} ×${n}` : `??? (tier ${p.tier})`;
          d.title = n ? `${p.flavor} — ${this.plantEffectText(p)}` : (p.wild ? 'Blows in on its own, now and then.' : 'A cross nobody has picked yet.');
          box.appendChild(d);
        }
        const row = this.$('sacrifice-row');
        const full = c.logFull(), pending = c.bed.sacrificeLeft > 0;
        row.classList.toggle('hidden', !(full || pending));
        this.$('sacrifice-btn').textContent = pending ? 'Cancel the sacrifice' : `Give up the log for ${CC.BED.sacrificeHoney} 🍯`;
        this.$('sacrifice-text').textContent = pending ? '' : 'Every species is written. The bed could begin again.';
      }
      if (c.bed.sacrificeLeft > 0) this.$('sacrifice-text').textContent = `the log is given up in ${CC.fmtDur(c.bed.sacrificeLeft)} — anyone may cancel`;
    }

    /* Parish Orders (R21): the board the world can miss */
    {
      const o = this.worldMode && this.patch ? this.patch.order : null;
      const panel = this.$('order');
      panel.classList.toggle('hidden', !o);
      if (o) {
        const unit = { harvest: '🥕', sprouts: '🌱 planted', visitors: 'guests caught', stalls: 'stall gambles',
          pages: 'pages written', springs: 'springs' }[o.kind] || '';
        const t = o.targets || [], v = o.value || 0, tier = o.tier || 0;
        const left = o.deadline - this.now();
        this.$('order-name').textContent = o.name;
        this.$('order-card').classList.toggle('authored', !!o.authored);
        const due = this.$('order-due');
        due.textContent = left > 0 ? `due in ${CC.fmtDur(left)}` : 'the bell is ringing…';
        due.classList.toggle('soon', left < CC.DUE_SOON);
        this.$('order-line').textContent = o.line || '';
        const next = tier < t.length ? t[tier] : null;
        this.$('order-progress').textContent = next
          ? `${CC.fmt(v)} / ${CC.fmt(next)} ${unit}` : `${CC.fmt(v)} ${unit} — every tier met`;
        this.$('order-tier').textContent = tier ? `tier ${tier} of ${t.length} ${'✓'.repeat(tier)}` : 'no tier yet';
        /* piecewise fill: the track's marks sit at 25 / 50 / 100 % for three
           tiers; any other count spreads its marks evenly */
        const stops = t.length === 3 ? [0, 0.25, 0.5, 1] : t.map((_, i) => i / t.length).concat([1]);
        let pct = 1;
        if (tier < t.length) {
          const lo = tier ? t[tier - 1] : 0, hi = t[tier];
          pct = stops[tier] + (stops[tier + 1] - stops[tier]) * Math.max(0, Math.min(1, (v - lo) / Math.max(1e-9, hi - lo)));
        }
        this.$('order-fill').style.width = `${(pct * 100).toFixed(1)}%`;
        const rw = CC.ORDER_REWARDS || {}, fail = CC.ORDER_FAIL || [];
        const say = list => (list || []).map(e => e.honey ? `🍯${e.honey}` : e.buff ? `${e.buff.name} ×${e.buff.mult}` :
          e.visitorRate ? `guests ×${e.visitorRate}` : e.weatherGapMult ? `weather ÷${e.weatherGapMult}` : '').filter(Boolean).join(' + ');
        this.$('order-stakes').textContent =
          `stakes — ${t.map((_, i) => `${i + 1}: ${say(rw[i + 1])}`).join(' · ')} · missed: ${say(fail)}`;
        const last = o.last, ol = this.$('order-last');
        ol.classList.toggle('won', !!(last && last.tier > 0));
        ol.classList.toggle('lost', !!(last && !last.tier));
        ol.textContent = last ? (last.tier > 0 ? `last week: ${last.name} — tier ${last.tier} met` : `last week: ${last.name} — missed`) : '';
      }
    }

    /* season (R17): the world's shared festival, clock always visible —
       but only when the server actually runs a calendar (seasonEnds > 0;
       a pre-R17 server must not produce a "0 days left" standing lie) */
    if (this.worldMode && this.patch && this.patch.everSynced && this.patch.seasonEnds > 0) {
      const sd = c.seasonData();
      const sl = this.$('season-line');
      sl.classList.remove('hidden');
      if (sd) {
        /* clamp: client clocks skew — never show more than a full season
           or negative time */
        const days = Math.max(0, Math.min(CC.SEASON_DAYS,
          Math.ceil((this.patch.seasonEnds - Date.now() / 1000) / 86400)));
        sl.textContent = `🎪 ${sd.name} — ${days} day${days === 1 ? '' : 's'} left · ${sd.bonus}`;
      } else {
        /* the server rotated into a season this build doesn't know */
        sl.textContent = '🎪 A new season is on — refresh the page to join it!';
      }
    }

    this.$('seed-line').textContent = c.seeds > 0
      ? `🌸 ${CC.fmt(c.seeds)} seeds — ${this.fmtX(c.seedMult())} production, forever` : '';

    /* the Potting Shed (R13): balance always on the main screen, catalog
       behind its own screen; the button glows when the world can afford
       something new */
    const shedBought = Object.keys(c.shed).length;
    this.$('sprout-line').textContent = (c.sprouts > 0 || shedBought > 0)
      ? `🌱 ${CC.fmt(c.sprouts)} sprout${c.sprouts === 1 ? '' : 's'} to spend` : '';
    const sb = this.$('shed-btn');
    sb.classList.toggle('hidden', !(c.seeds > 0 || c.sprouts > 0 || shedBought > 0));
    sb.classList.toggle('affordable', CC.SHED.some(u =>
      !c.shedMaxed(u) && c.shedVisible(u) && c.sprouts >= c.shedCost(u.id)));
    const shedSig = CC.SHED.map(u => {
      if (!c.shedVisible(u)) return '?';
      if (c.shedMaxed(u)) return 'x' + c.shedLevel(u.id);
      return (c.sprouts >= c.shedCost(u.id) ? '+' : '-') + c.shedLevel(u.id);
    }).join(',') + '|' + c.sprouts;
    if (shedSig !== this._shedSig) {
      this._shedSig = shedSig;
      this.$('shed-balance').innerHTML = `<b>${CC.fmt(c.sprouts)}</b> 🌱 sprouts ready for planting` +
        ` · <span style="opacity:0.75">${CC.fmt(c.sproutsSpent)} planted since records began</span>`;
      CC.SHED.forEach((u, i) => {
        const el = this.shedEls[i];
        const vis = c.shedVisible(u), maxed = c.shedMaxed(u), lv = c.shedLevel(u.id);
        el.querySelector('.s-name').textContent = vis ? u.name : '???';
        el.querySelector('.s-lv').textContent = u.repeat && lv > 0 ? ` · Lv ${lv}` : '';
        el.querySelector('.s-effect').textContent = vis ? this.shedEffectText(u) : '';
        el.querySelector('.s-flavor').textContent = vis ? u.flavor
          : 'The grounds keep their secrets — for now.';
        el.classList.toggle('bought', maxed);
        el.classList.toggle('cant', !maxed && (!vis || c.sprouts < c.shedCost(u.id)));
        el.querySelector('.s-cost').textContent = !vis ? '🔒'
          : maxed ? (u.repeat ? '🌱 fully grown' : '🌱 planted')
            : `${CC.fmt(c.shedCost(u.id))} 🌱`;
      });
    }

    const pending = c.pendingSeeds();
    const pb = this.$('prestige-btn');
    pb.classList.toggle('hidden', pending < 1);
    if (pending >= 1) pb.textContent = `🌸 Go to Seed (+${CC.fmt(pending)})`;

    /* shop rows */
    const shopSig = c.owned.join(',') + '|' + Math.floor(this.t * 4);
    if (shopSig !== this._shopSig) {
      this._shopSig = shopSig;
      let revealed = 0;
      CC.BUILDINGS.forEach((b, i) => {
        const row = this.rows[i];
        const known = i === 0 || c.owned[i] > 0 || c.totalAllTime >= b.cost / 5;
        const isNextMystery = !known && revealed === i;
        if (known) revealed++;
        /* Short Rows (R22): plots past the rule do not exist this spring */
        row.classList.toggle('hidden', (!known && !isNextMystery) || !c.rowExists(i));
        row.classList.toggle('mystery', isNextMystery);
        /* Max shows what it would actually buy right now (≥1 so an
           unaffordable row still shows the single price, greyed) */
        const bn = this.buyN === 'max' ? Math.max(1, c.maxAffordable(i)) : this.buyN;
        const cost = c.costOf(i, bn);
        /* Crop Rotation (R22): a row with no room in the chain is greyed */
        row.classList.toggle('cant', isNextMystery || c.bank < cost || c.rowRoom(i) < bn);
        const next = c.nextBumperAt(i);
        row.querySelector('.b-name').textContent = isNextMystery ? '???' : b.name;
        /* ceil the label: fractional prices (1.15^n, Market discounts) must
           never display cheaper than they charge */
        row.querySelector('.b-cost').textContent = isNextMystery ? ''
          : `${CC.fmt(Math.ceil(cost))} 🥕${bn > 1 ? ` ×${bn}` : ''}` +
            (c.owned[i] > 0 && next ? `  ·  🌾${c.owned[i]}/${next}` : '');
        row.querySelector('.b-count').textContent = c.owned[i] || '';
      });
    }

    /* upgrades */
    const ups = c.visibleUpgrades().slice(0, 12);
    const sig = ups.map(u => u.id + (c.bank >= u.cost ? '+' : '-')).join(',');
    if (sig !== this._upgSig) {
      this._upgSig = sig;
      if (this._tipKind === 'upgrade') this.tooltip(null); /* anchor is being rebuilt */
      const box = this.$('upgrades');
      box.innerHTML = '';
      for (const u of ups) {
        const el = document.createElement('div');
        el.className = 'upgrade' + (c.bank < u.cost ? ' cant' : '');
        el.innerHTML = `<b>${u.name}</b><span class="cost">${CC.fmt(u.cost)} 🥕</span>`;
        el.addEventListener('click', () => this.buyUpgrade(u.id));
        el.addEventListener('mouseenter', () => this.tooltip({ kind: 'upgrade', u }, el));
        el.addEventListener('mouseleave', () => this.tooltip(null));
        box.appendChild(el);
      }
      if (!ups.length) box.innerHTML = '<span style="color:#b8a98c;font-size:12px">Nothing on the shelf right now — keep growing.</span>';
    }

    /* ribbons */
    CC.RIBBONS.forEach((r, i) => this.ribbonEls[i].classList.toggle('locked', c.totalAllTime < r.at));

    /* almanac — signature is the page SET, not the count: a snapshot can
       swap which pages are latched at equal count (review P3) */
    const aSig = Object.keys(c.almanac).join();
    if (aSig !== this._almanacSeen) {
      this._almanacSeen = aSig;
      this.$('almanac-line').textContent =
        `${c.almanacCount()}/${CC.ALMANAC.length} pages written — ${this.fmtX(c.almanacMult())} production`;
      CC.ALMANAC.forEach((pg, i) => this.almanacEls[i].classList.toggle('locked', !c.almanac[pg.id]));
    }

    /* stats (re-rendered only when the text actually changes) */
    {
      const totalBuildings = c.owned.reduce((a, b) => a + b, 0);
      const bumpers = c.bumperTotal();
      const html =
        `<div>Lifetime harvest <b>${CC.fmt(c.totalAllTime)}</b></div>` +
        `<div>This spring <b>${CC.fmt(c.totalRun)}</b></div>` +
        `<div>Hand-pulled (clicks) <b>${CC.fmt(c.clicks)}</b></div>` +
        `<div>Springs on record 🌸 <b>${CC.fmt(c.prestiges)}</b></div>` +
        `<div>Rabbits caught 🐇 <b>${CC.fmt(c.rabbits)}</b></div>` +
        `<div>Plots &amp; contraptions <b>${CC.fmt(totalBuildings)}</b></div>` +
        `<div>Bumper crops 🌾 <b>${bumpers} (+${Math.round((Math.pow(CC.MILESTONE_MULT, bumpers) - 1) * 100)}%)</b></div>` +
        `<div>Production bonus <b>${this.fmtX(c.globalMult())}${c.buffMult() > 1 ? ` · ⚡${this.fmtX(c.buffMult())}` : ''}${c.seasonMult() > 1 ? ` · 🎪${this.fmtX(c.seasonMult())}` : ''}${c.handsBonus > 1 ? ` · 🤝${this.fmtX(c.handsBonus)}` : ''}</b></div>` +
        `<div class="stat-sub">seeds ${this.fmtX(c.seedMult())} · ribbons ${this.fmtX(c.ribbonMult())} · rest ${this.fmtX(c.globalMult() / (c.seedMult() * c.ribbonMult()))}</div>` +
        (c.honey > 0 ? `<div>Honey in the jar 🍯 <b>${CC.fmt(c.honey)}</b></div>` : '') +
        (c.bedMult() !== 1 ? `<div>The bed 🌱 <b>${this.fmtX(c.bedMult())}</b></div>` : '') +
        (() => { /* Trials (R22): the ledger and what it paid */
          const done = (CC.TRIALS || []).reduce((a, t) => a + c.trialDone(t.id), 0);
          if (!done) return '';
          const p = c.perks, bits = [];
          if (p.scarecrow) bits.push(`Scarecrow ${p.scarecrow}`);
          if (p.startTier) bits.push(`tier-${p.startTier} start`);
          if (p.resproutCap) bits.push(`resprout +${p.resproutCap}`);
          for (const k in p.cap) bits.push(`${k} cap +${p.cap[k]}`);
          if (p.longEars) bits.push(`Long Ears ${p.longEars}`);
          if (p.clickFrenzy) bits.push(`Click Frenzy ${p.clickFrenzy}`);
          return `<div>Trials won 🧪 <b>${done}</b></div>` +
            (bits.length ? `<div class="stat-sub">${bits.join(' · ')}</div>` : '');
        })() +
        `<div>Next seed in <b>${CC.fmt(Math.max(0, c.nextSeedAt() - c.totalAllTime))} 🥕</b></div>` +
        (() => { /* the tail must never fade into fog: name the next rung */
          const r = CC.RIBBONS.find(r => r.at > c.totalAllTime);
          return r ? `<div>Next ribbon in <b>${CC.fmt(r.at - c.totalAllTime)} 🥕</b></div>`
            : `<div>Trophy shelf <b>complete 🎀</b></div>`;
        })();
      if (html !== this._statHtml) {
        this._statHtml = html;
        this.$('stats').innerHTML = html;
      }
    }
  }

  /* ---------------- canvas ---------------- */
  render() {
    this.drawBed();
    const x = this.ctx, W = this.canvas.width, H = this.canvas.height;
    x.drawImage(this.bg, 0, 0);
    const c = this.core;
    const pal = this._pal || CC.THEMES['homestead-day'];

    /* buff glow: frenzy pulses orange; mere weather washes cool blue */
    if (c.buffMult() > 1) {
      const frenzy = c.buffs.some(b => b.mult >= 7);
      x.fillStyle = frenzy
        ? `rgba(255,150,40,${0.08 + Math.sin(this.t * 6) * 0.05})`
        : `rgba(110,150,200,${0.05 + Math.sin(this.t * 3) * 0.03})`;
      x.fillRect(0, 0, W, H);
    }

    /* the carrot: in the world it grows over the SEASON — a sprout at the
       season's dawn, a prize giant by its end (bounds 0.7–1.9), resetting
       when the calendar turns; the dev garden keeps lifetime growth */
    let size;
    if (this.worldMode && this.patch && this.patch.seasonEnds > 0) {
      const period = CC.SEASON_DAYS * 86400;
      const prog = Math.min(1, Math.max(0, 1 - (this.patch.seasonEnds - Date.now() / 1000) / period));
      size = 0.7 + 1.1 * prog; /* cap 1.8: the tip must not clip the frame */
    } else {
      size = 0.55 + Math.min(1.25, Math.log10(1 + c.totalAllTime) * 0.11);
    }
    const cx = W / 2, crownY = this.soilY + 4;
    const bodyLen = 120 * size, girth = 26 * size;
    const sq = 1 - this.squash * 0.12;
    x.save();
    x.translate(cx, crownY);
    x.scale(2 - sq, sq);

    /* tops */
    const nStems = 7;
    for (let i = 0; i < nStems; i++) {
      const f = i / (nStems - 1) - 0.5;
      const sway = Math.sin(this.t * 1.7 + i * 1.3) * 6;
      const h = (46 + Math.abs(f) * -14) * size;
      x.strokeStyle = pal.tops;
      x.lineWidth = 3 * size;
      x.beginPath();
      x.moveTo(f * 10 * size, -2);
      x.quadraticCurveTo(f * 26 * size + sway * 0.5, -h * 0.6, f * 44 * size + sway, -h);
      x.stroke();
      x.lineWidth = 1.6 * size;
      for (let k = 2; k <= 4; k++) {
        const q = k / 5;
        const lx = f * 44 * size * q + sway * q, ly = -h * (0.35 + q * 0.6);
        const ll = 9 * size * (1 - q * 0.3);
        x.beginPath();
        x.moveTo(lx - ll, ly + ll * 0.6); x.lineTo(lx, ly); x.lineTo(lx + ll, ly + ll * 0.6);
        x.stroke();
      }
    }
    x.restore();

    x.save();
    x.translate(cx, crownY);
    x.scale(sq, 2 - sq);
    /* body */
    const grad = x.createLinearGradient(0, 0, 0, bodyLen);
    grad.addColorStop(0, pal.body[0]);
    grad.addColorStop(1, pal.body[1]);
    x.fillStyle = grad;
    x.beginPath();
    x.moveTo(-girth, 2);
    x.quadraticCurveTo(-girth * 0.85, bodyLen * 0.55, -girth * 0.12, bodyLen);
    x.lineTo(girth * 0.12, bodyLen);
    x.quadraticCurveTo(girth * 0.85, bodyLen * 0.55, girth, 2);
    x.closePath();
    x.fill();
    /* ridges */
    x.strokeStyle = 'rgba(140,50,0,0.3)';
    x.lineWidth = 2;
    for (let k = 1; k <= 5; k++) {
      const q = k / 6, hw = girth * (1 - q) * 0.85;
      x.beginPath();
      x.moveTo(-hw, bodyLen * q); x.lineTo(hw, bodyLen * q);
      x.stroke();
    }
    /* shoulders above soil */
    x.fillStyle = '#e8760f';
    x.beginPath();
    x.ellipse(0, 1, girth, 6 * size, 0, Math.PI, 0);
    x.fill();
    x.restore();

    /* the visitor (R19): golden rabbit, its tin impostor, or the stall */
    if (this.visitor && !this.visitor.gone) {
      const r = this.visitor;
      x.save();
      if (r.kind === 'parsnip') {
        /* the Parsnip Man: a pale root in a small hat, lugging his stall */
        x.translate(r.x, r.y + 2);
        if (r.dir === -1) x.scale(-1, 1);
        x.fillStyle = '#e8ddb8';
        x.beginPath();
        x.moveTo(-7, -22);
        x.quadraticCurveTo(-9, 0, -1, 16);
        x.lineTo(1, 16);
        x.quadraticCurveTo(9, 0, 7, -22);
        x.closePath(); x.fill();
        x.strokeStyle = 'rgba(120,105,60,0.4)';
        x.lineWidth = 1.4;
        for (let k = 1; k <= 3; k++) {
          x.beginPath(); x.moveTo(-6 + k, -20 + k * 9); x.lineTo(6 - k, -20 + k * 9); x.stroke();
        }
        x.fillStyle = '#3f7d33';
        x.beginPath(); x.ellipse(0, -24, 6, 3.4, 0, 0, Math.PI * 2); x.fill();
        x.fillStyle = '#4a3018'; /* the hat above the greens — quite formal */
        x.beginPath(); x.ellipse(0, -29, 8, 2.4, 0, 0, Math.PI * 2); x.fill();
        x.fillRect(-4, -36, 8, 7);
        x.fillStyle = '#2a221a';
        x.beginPath(); x.arc(-3, -16, 1.1, 0, Math.PI * 2); x.arc(3, -16, 1.1, 0, Math.PI * 2); x.fill();
        /* the stall: a plank on legs with a striped awning */
        x.fillStyle = '#6b4a26';
        x.fillRect(10, -6, 26, 3);
        x.fillRect(12, -3, 3, 18);
        x.fillRect(31, -3, 3, 18);
        for (let k = 0; k < 4; k++) {
          x.fillStyle = k % 2 ? '#c8452c' : '#f6ead2';
          x.fillRect(9 + k * 7, -14, 7, 5);
        }
      } else {
        /* rabbit — golden, or tin if you squint (that is the con) */
        const tin = r.kind === 'tin';
        const hop = -Math.abs(Math.sin(this.t * (tin ? 6.2 : 8))) * (tin ? 7 : 9);
        x.translate(r.x, r.y + hop);
        if (r.dir === -1) x.scale(-1, 1);
        const glow = x.createRadialGradient(0, 0, 0, 0, 0, 30);
        glow.addColorStop(0, tin ? 'rgba(215,215,190,0.38)' : 'rgba(255,215,90,0.55)');
        glow.addColorStop(1, 'rgba(255,215,90,0)');
        x.fillStyle = glow;
        x.beginPath(); x.arc(0, 0, 30, 0, Math.PI * 2); x.fill();
        x.fillStyle = tin ? '#cfc9a8' : '#e8c25a';
        x.beginPath(); x.ellipse(0, 0, 14, 9, 0, 0, Math.PI * 2); x.fill();
        x.beginPath(); x.ellipse(12, -5, 7, 6, 0, 0, Math.PI * 2); x.fill();
        x.fillStyle = tin ? '#a8a488' : '#d4a83a';
        x.beginPath(); x.ellipse(10, -14, 2.2, 7, -0.15, 0, Math.PI * 2); x.fill();
        x.beginPath(); x.ellipse(14, -13.5, 2.2, 6.5, 0.2, 0, Math.PI * 2); x.fill();
        x.fillStyle = tin ? '#f2f2ea' : '#fff8e0';
        x.beginPath(); x.arc(-13, -1, 3.5, 0, Math.PI * 2); x.fill();
        x.fillStyle = '#2a221a';
        x.beginPath(); x.arc(13.5, -6, 1.1, 0, Math.PI * 2); x.fill();
      }
      x.restore();
    }

    /* gentle rain (R19): drawn only while the weather buff runs; streaks
       slant the way they drift, in a per-theme ink so light skies show it */
    if (c.buffs.some(b => CC.WEATHER.some(w => w.name === b.name))) {
      x.strokeStyle = pal.rain || 'rgba(180,210,240,0.34)';
      x.lineWidth = 1.2;
      for (let i = 0; i < 42; i++) {
        const rx = ((i * 89 + this.t * 130 * (1 + (i % 3) * 0.15)) % (W + 30)) - 15;
        const ry = (i * 53 + this.t * 340) % H;
        x.beginPath();
        x.moveTo(rx, ry);
        x.lineTo(rx + 2.5, ry + 9);
        x.stroke();
      }
    }

    /* particles */
    for (const p of this.particles) {
      x.globalAlpha = Math.min(1, p.life * 2);
      x.fillStyle = p.col;
      x.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    x.globalAlpha = 1;

    /* floating +N */
    x.font = 'bold 15px system-ui, sans-serif';
    x.textAlign = 'center';
    for (const f of this.floats) {
      x.globalAlpha = Math.min(1, f.life * 1.6);
      x.fillStyle = '#ffd98a';
      x.fillText(f.text, f.x, f.y);
    }
    x.globalAlpha = 1;
  }
};

/* ---------------- bootstrap ---------------- */
if (typeof document !== 'undefined') {
  addEventListener('DOMContentLoaded', () => {
    globalThis.game = new CC.UI(new CC.Core());
    const params = new URLSearchParams(location.search);
    const grant = params.get('grant');
    if (grant) game.core.earn(+grant); /* debug/testing */
    const sprouts = params.get('sprouts');
    if (sprouts) game.core.sprouts += +sprouts; /* debug/testing (dev garden; the server ignores predictions) */
    const season = params.get('season');
    if (season) game.core.season = season; /* dev garden theme/bonus testing (R17) */
    const dn = params.get('daynight');
    if (dn === 'day' || dn === 'night') { game.dayNight = dn; } /* theme dev (R18) */
    if (season || dn) game.applyTheme();
    const vis = params.get('visitor'); /* dev garden: summon a visitor now (R19) */
    if (vis && !game.worldMode && CC.VISITORS.some(v => v.id === vis)) {
      game.spawnVisitor(vis, CC.VISITORS.find(v => v.id === vis).ttl);
      game.visitor.x = 120; /* mid-patch, ready for sprite work */
    }
  });
}
