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
  chime() { [1568, 1976, 2637].forEach((f, i) => this.blip(f, 0.9, 'sine', 0.05, null, i * 0.18)); },
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

/* ---- readable numbers (brief P2): mantissa + unit as markup ---- */
CC.LONG_NAMES = CC.LONG_UNITS;
CC.fmtHtml = function (n) {
  const s = CC.fmt(n);
  if (CC.fog || !isFinite(n)) return `<span class="num">${s}</span>`;
  const m = /^(-?[\d.]+)\s?([A-Za-z ]+)?$/.exec(s);
  if (!m || !m[2]) return `<span class="num">${s}</span>`;
  const idx = CC.fmtLong ? CC.LONG_UNITS.indexOf(m[2].trim()) : ['k', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc', 'Ud', 'Dd', 'Td', 'Qad', 'Qid', 'Sxd', 'Spd', 'Ocd', 'Nod', 'Vg'].indexOf(m[2].trim());
  const note = idx >= 0 ? `${CC.LONG_UNITS[idx]} · 1e${3 * (idx + 1)}` : '';
  return `<span class="num"><b class="mant">${m[1]}</b><span class="suf" title="${note}">${m[2].trim()}</span></span>`;
};
/* "≈ 2 min of harvest": a price in the world's own time (brief principle 3) */
CC.fmtTime = function (seconds) {
  if (!isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 1) return 'now';
  if (seconds < 60) return `≈ ${Math.ceil(seconds)} s`;
  if (seconds < 3600) return `≈ ${Math.ceil(seconds / 60)} min`;
  if (seconds < 86400) return `≈ ${(seconds / 3600).toFixed(seconds < 36000 ? 1 : 0)} h`;
  if (seconds < 86400 * 365) return `≈ ${Math.ceil(seconds / 86400)} d`;
  return '≈ years';
};
/* the three rungs of celebration (brief, motion contract) */
CC.CELEBRATE = { whisper: { particles: 0, glow: 0 }, cheer: { particles: 40, glow: 1 }, fanfare: { particles: 90, glow: 2.5 } };

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
    this.core.mirror = this.worldMode;     /* no local automation or transitions: the snapshot is the truth (R22) */

    /* the symbol sheet first: every icon below is a <use> of it */
    CC.ART.inject();
    /* the motion contract: one flag, from the OS or the calm control */
    this.calm = this.pref('carrot-calm') === '1';
    this.applyMotion();
    this.buildStatic();
    this.dayNight = this.pref('carrot-daynight') || 'auto'; /* ☀/🌙 is a display preference */
    this.autoClick = this.pref('carrot-autoclick') === '1'; /* RSI-friendly steady clicker */
    CC.fmtLong = this.pref('carrot-numbers') === 'long'; /* R21: readable numbers, a display preference */
    CC.fmtSci = this.pref('carrot-numbers') === 'sci';
    this.applyTheme();
    this.$('build-tag').textContent = `build ${CC.BUILD || 'dev'}`;
    this.tenure = this.pref('carrot-tenure') || 'new';
    this.$('cc-root').dataset.tenure = this.tenure;
    this.deeds = { clicks: 0, box: 0, rabbit: 0 }; /* what this browser has done, for the Gate */
    try { Object.assign(this.deeds, JSON.parse(this.pref('carrot-deeds') || '{}')); } catch (e) { /* fresh */ }
    this.queue = []; /* the Clothesline */
    this.bedHover = -1;
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
      this.$('book').querySelector('input[value="chronicle"]').closest('label').classList.remove('hidden');
      this._lastSeen = +this.pref('carrot-last-seen') || 0; /* read once, before the heartbeat */
      const seen = () => this.setPref('carrot-last-seen', String(Math.floor(Date.now() / 1000)));
      setInterval(seen, 60000);
      addEventListener('beforeunload', seen);
    } else {
      this.$('tender-sign').classList.add('hidden');
      this.$('tender-list').innerHTML =
        '<div class="board-empty">The world signs here — this is the dev garden.</div>';
      this.$('book').querySelector('input[value="chronicle"]').closest('label').classList.add('hidden');
    }
    /* the Book's tabs, the mobile tab bar, the Gate */
    const book = this.$('book');
    book.dataset.tab = this.pref('carrot-book-tab') || 'ledger';
    if (!book.querySelector(`input[value="${book.dataset.tab}"]`)) book.dataset.tab = 'ledger';
    book.querySelector(`input[value="${book.dataset.tab}"]`).checked = true;
    if (book.dataset.tab === 'chronicle') { if (this.worldMode) setTimeout(() => this.loadChronicle(), 0); else book.dataset.tab = 'ledger'; }
    book.addEventListener('change', e => {
      if (e.target.name === 'book-tab') { book.dataset.tab = e.target.value; this.setPref('carrot-book-tab', e.target.value); if (e.target.value === 'chronicle') this.loadChronicle(); }
    });
    if (this.pref('carrot-book-open') === '0') book.open = false;
    book.addEventListener('toggle', () => this.setPref('carrot-book-open', book.open ? '1' : '0'));
    this.$('tabbar').addEventListener('click', e => { const b = e.target.closest('button'); if (b) this.setTab(b.dataset.tab); });
    this.$('gate-close').addEventListener('click', () => this.setTenure('settled'));

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
      /* offsetX/Y are in the canvas's own (un-rotated) space — the binding is tilted 1.5° */
      const el = e.currentTarget;
      const x = Math.floor(e.offsetX / el.clientWidth * this.quilt.w);
      const y = Math.floor(e.offsetY / el.clientHeight * this.quilt.h);
      if (x >= 0 && y >= 0 && x < this.quilt.w && y < this.quilt.h) this.paintCell(y * this.quilt.w + x, this.quiltColor);
    });
    this.$('quilt-copy').addEventListener('click', () => this.copyQuilt());
    this.drawQuilt();

    /* the Seed Bed (R23): a shared bed under the carrot */
    this.bedCtx = this.$('bed').getContext('2d');
    this.$('bed').width = 320 * this.dpr; this.$('bed').height = 320 * this.dpr;
    this.bedCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.bedMenuPlot = -1;
    this.$('bed').addEventListener('pointerdown', e => {
      const el = e.currentTarget, r = el.getBoundingClientRect();
      const W = this.core.bedW(), H = this.core.bedH();
      const x = Math.floor((e.clientX - r.left - el.clientLeft) / el.clientWidth * W), y = Math.floor((e.clientY - r.top - el.clientTop) / el.clientHeight * H);
      if (x < 0 || y < 0 || x >= W || y >= H) return;
      this.bedClick(y * W + x);
    });
    this.$('bed').addEventListener('mousemove', e => {
      const el = e.currentTarget, r = el.getBoundingClientRect();
      const W = this.core.bedW(), H = this.core.bedH();
      const x = Math.floor((e.clientX - r.left - el.clientLeft) / el.clientWidth * W), y = Math.floor((e.clientY - r.top - el.clientTop) / el.clientHeight * H);
      this.bedHover = (x >= 0 && y >= 0 && x < W && y < H) ? y * W + x : -1;
      this.bedTip();
    });
    this.$('bed').addEventListener('mouseleave', () => { this.bedHover = -1; this.tooltip(null); });
    const sb = this.$('soil-btns');
    for (const so of (CC.SOILS || [])) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip fill';
      b.innerHTML = `${CC.icon(so.id)} ${so.name}`; b.dataset.id = so.id; b.title = so.line;
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
      /* one bad draw must never stop the world: the loop re-arms regardless */
      try { this.update(dt); this.render(); }
      catch (e) { if (!this._loopErr) { this._loopErr = true; console.error('frame failed', e); } }
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
      const line = `${this.patch.online} tender${this.patch.online === 1 ? '' : 's'} tending · ${CC.fmt(this.patch.clickRate)} clicks/s worldwide` +
        (hb > 1 ? ` · many hands ${this.fmtX(hb)}` : '');
      this.$('patch-line').textContent = line;
      this.$('hands-sentence').textContent = line + '.';
    }
  }
  /* write textContent only when it changed: updateDOM runs every frame */
  setText(el, str) { if (el._txt !== str) { el._txt = str; el.textContent = str; } }
  /* the mobile shell (brief P17): one attribute, four tabs */
  setTab(tab) {
    this.$('cc-root').dataset.tab = tab;
    for (const b of this.$('tabbar').children) b.classList.toggle('on', b.dataset.tab === tab);
    if (tab === 'book') { this.$('book').open = true; this.$('book').scrollIntoView({ block: 'start' }); }
    if (tab === 'parish') this.$('noticeboard').scrollIntoView({ block: 'start' });
    for (const b of this.$('tabbar').children) if (b.dataset.tab === tab) b.classList.remove('badge');
  }
  badge(tab) { for (const b of this.$('tabbar').children) if (b.dataset.tab === tab && !b.classList.contains('on')) b.classList.add('badge'); }
  /* tenure (brief P20): new → settled → veteran, from what the browser has seen */
  setTenure(t) {
    this.tenure = t;
    this.setPref('carrot-tenure', t);
    this.$('cc-root').dataset.tenure = t;
    this.$('gate-card').classList.toggle('hidden', t !== 'new');
  }
  applyMotion() {
    const os = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    CC.motion = this.calm || os ? 'reduced' : 'full';
    this.$('cc-root').dataset.motion = CC.motion;
    this.$('cc-root').classList.toggle('calm', this.calm);
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
      for (const e of evs.filter(e => e.type === 'trial')) {
        const t = (CC.TRIALS || []).find(x => x.id === e.id);
        parts.push(`${t ? t.name : 'a Trial'} ${e.won ? 'won' : e.abandoned ? 'abandoned' : 'lost'}`);
      }
      add(n('bedFound'), 'new plant found', 'new plants found');
      if (n('fallow')) parts.push('THE WORLD LAY FALLOW');
      if (n('market_open')) parts.push('a Market Hour');
      if (parts.length) this.toast(`🌍 While you were away (${CC.fmtDur(gap)}): ${parts.join(', ')}.`);
    }).catch(() => { /* decorative */ });
  }

  openChronicle() {
    /* the 📜 control opens the Book at its Chronicle tab */
    const book = this.$('book');
    book.open = true; book.dataset.tab = 'chronicle';
    book.querySelector('input[value="chronicle"]').checked = true;
    this.setPref('carrot-book-tab', 'chronicle');
    if (innerWidth <= 900) this.setTab('book'); else book.scrollIntoView({ block: 'start', behavior: CC.motion === 'full' ? 'smooth' : 'auto' });
    this.loadChronicle();
  }
  loadChronicle() {
    if (!this.worldMode) return;
    const box = this.$('chronicle-days');
    if (!box.children.length) box.innerHTML = '<div class="board-empty">Turning the pages…</div>';
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
    if (e.type === 'quiet') return `🌙 the garden stirred after ${e.hours}h of quiet${e.candle ? ' — the candle was lit' : ''}`;
    if (e.type === 'charm') { const cd = this.core.charmData && this.core.charmData(e.id); return `🍯 ${e.who || 'a tender'} bought ${cd ? cd.name : 'a keepsake'} at the stall`; }
    if (e.type === 'market_open') return '🏪 Market Hour';
    if (e.type === 'trial') {
      const t = (CC.TRIALS || []).find(x => x.id === e.id), nm = t ? t.name : 'a Trial';
      return e.won ? `🧪 ${nm} — won in ${CC.fmtDur(e.dur || 0)} (${e.n}/${CC.TRIAL.maxDone})` : e.abandoned ? `🧪 ${nm} — abandoned at a spring` : `🧪 ${nm} — the clock ran out`;
    }
    if (e.type === 'bedFound') { const p = this.core.plantData(e.sp); return `📗 ${p ? p.name : 'a plant'} entered the seed log`; }
    if (e.type === 'sacrifice') return `🍯 the seed log was given up for ${e.honey} honey`;
    if (e.type === 'bell') return `🔔 the bell rang (${e.ring})${e.rehearsal ? ', rehearsing' : ''}`;
    if (e.type === 'silence') return `🔕 ${e.who || 'someone'} silenced the bell`;
    if (e.type === 'rehearsed') return '🔔 the rehearsal rang out';
    if (e.type === 'fallow') return `🔔 THE WORLD LAY FALLOW — +${e.loam} loam (Fallow Year ${e.fallows})`;
    if (e.type === 'cellar') { const cd = this.core.cellarData(e.id); return `🪨 ${cd ? cd.name : 'a Cellar perk'} → level ${e.lv}`; }
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

  /* ---------------- the Honey Stall (R25) ---------------- */
  charmIcon(id) { return ({ clover4: 'clover4', sugar: 'sugar', rainjar: 'rainjar', picnic: 'picnic', candle: 'candle',
    gnome: 'gnome', bunting: 'bunting', tophat: 'tophat', chimes: 'chimes', cat: 'cat' })[id] || 'honey'; }
  buyCharmUI(id) {
    if (this.awaitingWorld()) return;
    if (this.worldMode) { this.patch.send({ type: 'charm', id }); return; }
    const c = this.core;
    if (c.buyCharm(id)) {
      const cd = c.charmData(id);
      CC.audio.upgrade();
      this.toast(`${cd.name} — ${cd.effect}.`, { icon: this.charmIcon(id) });
      if (id === 'rainjar') { c.buffs.push({ name: 'Gentle Rain', mult: 2, left: 90 }); c.weathers++; c.mintHoney('rain'); }
      if (id === 'sugar') this.nextVisitor = Math.min(this.nextVisitor, this.t + 5 + Math.random() * 55);
    }
  }

  /* ---------------- the Quilt (R22) ---------------- */
  fetchQuilt() {
    if (!this.worldMode || this._quiltFetching) return;
    this._quiltFetching = true;
    const dir = location.pathname.replace(/[^/]*$/, '');
    fetch(dir + 'api/quilt').then(r => r.json()).then(j => {
      this._quiltFetching = false;
      if (!j || !j.cells) return;
      if (j.v < this.quilt.v) { this.fetchQuilt(); return; } /* a stitch landed mid-flight: ask again */
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
  plotName(i) { const W = this.core.bedW(); return `${'ABCDEF'[i % W]}${Math.floor(i / W) + 1}`; }
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
    const p = c.plantData(pl.sp), soil = c.soilData();
    const rem = p ? p.mature - pl.age : 1;
    const first = soil.every - (c.bed.n % soil.every);          /* bed ticks until the next growth tick */
    const ticks = first + Math.max(0, rem - 1) * soil.every;
    const secs = CC.BED.tick - c.bedT + (ticks - 1) * CC.BED.tick;
    this.toast(`🌱 ${p ? p.name : 'Something'} at ${this.plotName(i)} needs ${rem} more growth tick${rem === 1 ? '' : 's'}` +
      `${soil.every > 1 ? ` (${soil.name} grows every ${soil.every}th bed tick)` : ''} — about ${CC.fmtDur(secs)}.`);
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
      const row = document.createElement('button');
      row.type = 'button';
      const can = price.carrots !== undefined ? c.bank >= price.carrots : c.honey >= price.honey;
      row.className = 'bm-row' + (can ? '' : ' cant');
      row.disabled = !can;
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
    const cl = document.createElement('button'); cl.type = 'button'; cl.className = 'bm-close'; cl.textContent = 'close ✕';
    cl.addEventListener('click', () => this.closeBedMenu());
    m.appendChild(cl);
    const W = this.core.bedW(), H = this.core.bedH(), x = i % W, y = Math.floor(i / W);
    const rightHalf = x >= W / 2;               /* anchor right-half plots to the right edge: never off-screen */
    m.style.left = rightHalf ? 'auto' : `${x * (100 / W)}%`;
    m.style.right = rightHalf ? '0' : 'auto';
    m.style.top = `${Math.min(55, (y + 1) * (100 / H))}%`;
    m.classList.remove('hidden');
    const firstRow = m.querySelector('.bm-row:not([disabled])') || m.querySelector('.bm-close');
    if (firstRow) firstRow.focus();
  }
  closeBedMenu() { this.$('bed-menu').classList.add('hidden'); this.bedMenuPlot = -1; }
  plantAt(i, sp) {
    this.closeBedMenu();
    const wait = CC.BED.plantCooldown - (this.t - (this.lastPlant === undefined ? -1e9 : this.lastPlant));
    if (wait > 0) { this.toast(`🌱 Your trowel rests — ${Math.ceil(wait)}s before the next seed.`); return; }
    if (this.core.bed.plots[i]) { this.toast(`🌱 Someone got to ${this.plotName(i)} first.`); return; }
    if (this.worldMode) { this.patch.send({ type: 'plant', i, sp }); return; }
    this.lastPlant = this.t;
    if (this.core.bedPlant(i, sp)) { CC.audio.upgrade(); this.toast(`🌱 ${this.core.plantData(sp).name} planted at ${this.plotName(i)}.`); }
  }
  plantResult(msg) {
    if (msg.ok) { this.lastPlant = this.t; return; }
    const why = { trowel: 'your trowel is still resting', share: `one gardener may hold at most ${msg.cap || 'a quarter of the'} plots immature — pick something first`,
      garbage: 'that seed made no sense', refused: 'the plot was taken or the price was not there' }[msg.why] || 'the seed did not land';
    this.toast(`🌱 Not planted — ${why}.`);
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
    if (c.bed.sacrificeRest > 0) { this.toast(`🍯 A cancelled sacrifice rests — ${CC.fmtDur(c.bed.sacrificeRest)} more.`); return; }
    this.$('modal-title').textContent = '🍯 Give up the seed log?';
    this.$('modal-body').innerHTML = `Every species is written. Giving the log up pays <b>${CC.BED.sacrificeHoney} honey</b> and a permanent Almanac page — ` +
      `and clears the log, so every cross must be found again (found seeds cost honey until they are). ` +
      `A <b>${CC.fmtDur(CC.BED.sacrificeWait)}</b> countdown runs first — long enough for every tender to see it — and anyone can cancel it (after which it rests ${CC.fmtDur(CC.BED.sacrificeRest || 600)}).`;
    this.$('trial-pick').classList.add('hidden');
    const yes = this.$('modal-yes');
    yes.textContent = 'Start the countdown';
    yes.onclick = () => {
      this.$('modal').classList.add('hidden');
      if (this.worldMode) this.patch.send({ type: 'sacrifice' }); else if (c.bedSacrifice()) this.toast('🍯 The countdown begins.');
    };
    this.openModal();
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
    const x = this.bedCtx, c = this.core, W = c.bedW(), H = c.bedH(), cw = 320 / W, ch = 320 / H;
    const soil = c.soilData();
    const pal = this._pal || CC.THEMES['homestead-day'];
    const art = CC.ART.palette(pal, !!pal.stars);
    const still = CC.motion !== 'full';
    if (still) { /* nothing moves: repaint only when the bed changed */
      const key = [this._themeId, soil.id, W, H, this.bedHover, c.bed.sacrificeLeft > 0, c.bed.plots.map(pl => pl ? pl.sp + ':' + pl.age : '-').join(',')].join('|');
      if (key === this._bedKey) return;
      this._bedKey = key;
    } else this._bedKey = null;
    /* the bed shares the hero's soil: same palette, a tile pattern per soil */
    const ground = { dirt: [pal.soil[0], pal.soil[1]], clay: ['#7a5540', '#5e4030'], chips: ['#8a6a3a', '#6b5028'] }[soil.id] || [pal.soil[0], pal.soil[1]];
    const tileId = 'soil-' + (soil.id === 'chips' ? 'chips' : soil.id);
    const hasTile = CC.ART.parts(tileId).length > 0;
    const hover = this.bedHover;
    for (let i = 0; i < W * H; i++) {
      const px = (i % W) * cw, py = Math.floor(i / W) * ch;
      x.fillStyle = ground[(i % W + Math.floor(i / W)) % 2];
      x.fillRect(px, py, cw, ch);
      if (hasTile) CC.ART.draw(x, tileId, px, py, cw, Object.assign({}, art, { ink: 'rgba(0,0,0,0.28)' }), { alpha: 0.8 });
      /* the raised ridge */
      x.strokeStyle = 'rgba(0,0,0,0.22)'; x.lineWidth = 1; x.strokeRect(px + 0.5, py + 0.5, cw - 1, ch - 1);
      x.strokeStyle = 'rgba(255,230,190,0.10)'; x.beginPath(); x.moveTo(px + 1, py + ch - 1); x.lineTo(px + 1, py + 1); x.lineTo(px + cw - 1, py + 1); x.stroke();
      const pl = c.bed.plots[i];
      if (!pl) {
        /* empty = a dotted outline; the hovered plot glows */
        x.setLineDash([3, 4]); x.strokeStyle = 'rgba(255,230,190,0.28)'; x.strokeRect(px + 6.5, py + 6.5, cw - 13, ch - 13); x.setLineDash([]);
        if (i === hover) { x.fillStyle = 'rgba(255,220,120,0.14)'; x.fillRect(px, py, cw, ch); }
        continue;
      }
      const p = c.plantData(pl.sp);
      if (!p) continue;
      const mature = pl.age >= p.mature;
      const g = Math.min(1, (pl.age + 0.35) / p.mature);           /* growth 0..1 */
      const old = p.life < 900 && pl.age > p.life - 2;                /* about to die */
      const hue = p.mult && p.mult < 1 ? '#7d8a5a' : p.rabbit ? '#5fa65a' : p.weather ? '#6e8fd6' : p.honey ? '#e7b23a'
        : p.wild ? '#9a9a70' : p.tier >= 5 ? '#f0c060' : p.tier >= 4 ? '#c58ad0' : pal.body[0];
      const stage = old ? 'pl-dead' : pl.age === 0 ? 'pl-seed' : mature ? (p.weather ? 'pl-umbel' : 'pl-ready') : g < 0.5 ? 'pl-sprout' : 'pl-grow';
      const size = Math.min(cw, ch) * (stage === 'pl-seed' ? 0.55 : 0.8);
      const sway = still ? 0 : Math.sin(this.t * 1.3 + i) * 1.5;
      const plantPal = Object.assign({}, art, { carrot: hue, honey: hue, leaf: old ? '#8a7a4a' : art.leaf });
      const drawn = CC.ART.draw(x, stage, px + (cw - size) / 2 + sway, py + ch - size - 6, size, plantPal, { alpha: 1 });
      if (!drawn) { /* the old five strokes, until the sheet is in */
        const cx = px + cw / 2, base = py + ch - 8, h = 10 + g * (ch - 24);
        x.strokeStyle = old ? '#6a5a3a' : art.leaf; x.lineWidth = 2.5;
        x.beginPath(); x.moveTo(cx, base); x.quadraticCurveTo(cx + sway, base - h / 2, cx, base - h); x.stroke();
        x.fillStyle = hue; x.beginPath(); x.arc(cx, base - h, mature ? 8 : 3 + g * 3, 0, Math.PI * 2); x.fill();
      }
      if (mature) { /* the same dashed gold halo every "click me" wears */
        x.setLineDash([4, 4]); x.lineDashOffset = still ? 0 : -this.t * 12;
        x.strokeStyle = `rgba(255,210,120,${0.7 + (still ? 0 : Math.sin(this.t * 3 + i) * 0.2)})`; x.lineWidth = 2;
        x.strokeRect(px + 4.5, py + 4.5, cw - 9, ch - 9); x.setLineDash([]); x.lineDashOffset = 0;
      }
      if (i === hover) { x.fillStyle = 'rgba(255,220,120,0.12)'; x.fillRect(px, py, cw, ch); }
    }
    if (c.bed.sacrificeLeft > 0) {
      x.fillStyle = `rgba(240,180,60,${0.12 + (still ? 0 : Math.sin(this.t * 4) * 0.08)})`; x.fillRect(0, 0, 320, 320);
    }
  }

  renderOrder(card, o, first) {
    const q = sel => card.querySelector(sel);
    const leftS = CC.fmtDur(o.deadline - this.now());
    const sig = [o.id, o.name, o.value, o.tier, (o.targets || []).join(','), !!o.authored, first ? JSON.stringify(o.last || null) : '', leftS].join('|');
    if (card.dataset.sig === sig) return;
    card.dataset.sig = sig;
    const unit = { harvest: 'carrots', sprouts: 'sprouts planted', visitors: 'guests caught', stalls: 'stall gambles',
      pages: 'pages written', springs: 'springs', quilt: 'of the quilt', trials: 'trials won' }[o.kind] || '';
    const t = o.targets || [], v = o.value || 0, tier = o.tier || 0;
    const left = o.deadline - this.now();
    q('.order-name').textContent = o.name;
    card.classList.toggle('authored', !!o.authored);
    const last0 = first ? o.last : null;
    card.classList.toggle('won', !!(last0 && last0.tier > 0 && tier === 0));
    card.classList.toggle('lost', !!(last0 && !last0.tier && tier === 0));
    const due = q('.order-due');
    due.querySelector('b').textContent = left > 0 ? CC.fmtDur(left) : 'ringing…';
    due.classList.toggle('soon', left < CC.DUE_SOON);
    q('.order-line').textContent = o.line || '';
    const next = tier < t.length ? t[tier] : null;
    const show = x => o.kind === 'quilt' ? `${Math.round(x * 100)}%` : CC.fmt(x);
    q('.order-progress').textContent = next ? `${show(v)} / ${show(next)} ${unit}` : `${show(v)} ${unit} — every tier met`;
    q('.order-tier').innerHTML = t.map((_, i) => `<span class="${i < tier ? 'met' : ''}">${['I', 'II', 'III', 'IV'][i] || i + 1}${i < tier ? '✓' : ''}</span>`).join(' ');
    const stops = t.length === 3 ? [0, 0.25, 0.5, 1] : t.map((_, i) => i / t.length).concat([1]);
    let pct = 1;
    if (tier < t.length) {
      const lo = tier ? t[tier - 1] : 0, hi = t[tier];
      pct = stops[tier] + (stops[tier + 1] - stops[tier]) * Math.max(0, Math.min(1, (v - lo) / Math.max(1e-9, hi - lo)));
    }
    q('.order-fill').style.width = `${(pct * 100).toFixed(1)}%`;
    const rw = CC.ORDER_REWARDS || {}, fail = CC.ORDER_FAIL || [];
    const say = list => (list || []).map(e => e.honey ? `${e.honey} honey` : e.buff ? `${e.buff.name} ×${e.buff.mult}` :
      e.visitorRate ? `guests ×${e.visitorRate}` : e.weatherGapMult ? `weather ÷${e.weatherGapMult}` : '').filter(Boolean).join(' + ');
    q('.order-stakes').textContent = `stakes — ${t.map((_, i) => `${i + 1}: ${say(rw[i + 1])}`).join(' · ')} · missed: ${say(fail)}`;
    const last = first ? o.last : null, ol = q('.order-last');
    ol.classList.toggle('won', !!(last && last.tier > 0));
    ol.classList.toggle('lost', !!(last && !last.tier));
    ol.textContent = last ? (last.tier > 0 ? `last week: ${last.name} — tier ${last.tier} met` : `last week: ${last.name} — missed`) : '';
  }

  /* ---------------- Lie Fallow (R24) ---------------- */
  askBell() {
    if (this.awaitingWorld()) return;
    const c = this.core, bell = this.worldMode ? this.patch.bell : null;
    if (bell) { /* a voice for quiet — confirmed, never a misclick (R24 review) */
      const votes = bell.votes || 0;
      this.$('modal-title').textContent = '🔕 Ask for quiet?';
      this.$('modal-body').innerHTML = `The bell is ringing (${bell.rung} of ${CC.FALLOW.rings}${bell.rehearsal ? ', a rehearsal' : ''}). ` +
        `Silencing it takes <b>half the tenders online</b> agreeing — ${votes} voice${votes === 1 ? '' : 's'} so far. ` +
        `Once silenced, the bell rests ${CC.fmtDur(CC.FALLOW.ringRest || 600)} before it can ring again.`;
      this.$('trial-pick').classList.add('hidden');
      const yes = this.$('modal-yes');
      yes.textContent = 'Add my voice for quiet';
      yes.onclick = () => { this.$('modal').classList.add('hidden'); this.patch.send({ type: 'silence' }); };
      this.openModal();
      return;
    }
    if (!c.fallowAvailable()) return;
    if (this.worldMode && this.patch && (this.patch.bellRest || 0) + (CC.FALLOW.ringRest || 600) > this.now()) return; /* resting */
    const loam = c.loamPending(), F = CC.FALLOW, rehearsal = !c.rehearsed && this.worldMode;
    this.$('modal-title').textContent = rehearsal ? '🔔 Ring the bell — a rehearsal' : '🔔 Ring the bell — Lie Fallow';
    this.$('modal-body').innerHTML =
      `<b>Lie Fallow</b> is the second prestige. When the bell rings out, <b>every seed is retired into loam</b>: ` +
      `<b>${CC.fmt(c.seeds)} seeds → ${loam} loam</b>. Bank, plots, upgrades, lifetime (so ribbons), seeds, sprouts and the shed's ` +
      `ladders return to the ground. The Almanac, counters, the shed's one-shots, honey, the seed log, the Trials' ledger ` +
      `and the Root Cellar stay. The quilt is framed into the chronicle.` +
      (this.worldMode ? `<br><br>The bell rings <b>${F.rings} times, ${CC.fmtDur(F.ringGap)} apart</b>; the world lies fallow at the last. ` +
        `<b>Anyone can silence it</b> until then.` : '') +
      (rehearsal ? `<br><br><i>This is the world's first bell: a <b>rehearsal</b>. It will ring out and nothing will reset — the next bell is real.</i>` : '');
    this.$('trial-pick').classList.add('hidden');
    const yes = this.$('modal-yes');
    yes.textContent = rehearsal ? 'Ring the rehearsal' : 'Ring the bell';
    yes.onclick = () => {
      this.$('modal').classList.add('hidden');
      if (this.worldMode) { this.patch.send({ type: 'ring' }); return; }
      const got = c.fallow();
      if (got) this.ceremony({ type: 'fallow', loam: got, fallows: c.fallows, quilt: '' });
    };
    this.openModal();
  }
  /* one ceremony runner, two scripts (brief P25): steps are data — the
     canvas is drawn by time, the card follows, anything skips it. Reduced
     motion shows the card only. Toasts are held while it plays. */
  runCeremony(name, seconds, draw, done) {
    if (CC.motion !== 'full') { done(); return; }
    const box = this.$('ceremony'), cv = this.$('ceremony-canvas');
    const card = this.$('ceremony-box');
    card.classList.add('hidden');
    cv.width = innerWidth * this.dpr; cv.height = innerHeight * this.dpr;
    const x = cv.getContext('2d'); x.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    box.classList.remove('hidden');
    this.holdToasts = true;
    const t0 = performance.now();
    let over = false;
    const finish = () => { if (over) return; over = true; cv.width = 0; cv.height = 0; box.removeEventListener('click', finish); this.skipCeremony = null; card.classList.remove('hidden'); this.holdToasts = false; this.drainToasts(); done(); };
    box.addEventListener('click', finish);
    this.skipCeremony = finish;
    box.tabIndex = -1; box.focus();
    const frame = () => {
      if (over) return;
      const t = (performance.now() - t0) / 1000;
      x.clearRect(0, 0, innerWidth, innerHeight);
      draw(x, Math.min(t, seconds), innerWidth, innerHeight);
      if (t >= seconds) finish(); else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
  /* GO TO SEED (3 s): sky to dawn · the stalk rises · the umbel opens · seeds drift · the body sinks · a seedling */
  seedScript(x, t, W, H) {
    const cx = W / 2, base = H * 0.62, pal = CC.ART.palette(this._pal, !!(this._pal && this._pal.stars));
    const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, `rgba(90,70,130,${0.6 + 0.3 * Math.min(1, t / 1.5)})`); g.addColorStop(1, 'rgba(230,170,110,0.7)');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.fillStyle = pal.soil; x.fillRect(0, base, W, H - base);
    const stalk = Math.min(1, Math.max(0, (t - 0.5) / 0.6)) * 140;
    x.strokeStyle = pal.leaf; x.lineWidth = 5; x.lineCap = 'round';
    x.beginPath(); x.moveTo(cx, base); x.quadraticCurveTo(cx + 6, base - stalk / 2, cx, base - stalk); x.stroke();
    const body = Math.max(0, 1 - Math.max(0, (t - 2.4) / 0.6));
    x.fillStyle = pal.carrot;
    x.beginPath(); x.moveTo(cx - 22 * body, base); x.quadraticCurveTo(cx - 18 * body, base + 60 * body, cx, base + 90 * body); x.quadraticCurveTo(cx + 18 * body, base + 60 * body, cx + 22 * body, base); x.closePath(); x.fill();
    if (t > 1) {
      const open = Math.min(1, (t - 1) / 0.6);
      const top = base - stalk;
      x.strokeStyle = pal.leaf; x.lineWidth = 2;
      for (let k = 0; k < 9; k++) {
        const a = -Math.PI / 2 + (k - 4) * 0.28 * open, len = 34 * open;
        x.beginPath(); x.moveTo(cx, top); x.lineTo(cx + Math.cos(a) * len, top + Math.sin(a) * len); x.stroke();
        x.fillStyle = '#fff3d6'; x.beginPath(); x.arc(cx + Math.cos(a) * len, top + Math.sin(a) * len, 5 * open, 0, Math.PI * 2); x.fill();
      }
    }
    if (t > 1.6) {
      for (let k = 0; k < 20; k++) {
        const dt = t - 1.6 - k * 0.03; if (dt < 0) continue;
        const sx = cx + Math.sin(k * 1.7) * 30 + dt * (20 + k * 4) * (k % 2 ? 1 : -1) * 0.6, sy = base - stalk - 20 + dt * 40 + Math.sin(dt * 3 + k) * 8;
        x.fillStyle = pal.seed; x.globalAlpha = Math.max(0, 1 - dt / 1.8);
        x.beginPath(); x.ellipse(sx, sy, 3, 5, k, 0, Math.PI * 2); x.fill();
      }
      x.globalAlpha = 1;
    }
    if (t > 2.9) { x.strokeStyle = pal.leaf; x.lineWidth = 3; x.beginPath(); x.moveTo(cx, base); x.lineTo(cx, base - 14); x.moveTo(cx, base - 10); x.lineTo(cx - 8, base - 16); x.moveTo(cx, base - 10); x.lineTo(cx + 8, base - 16); x.stroke(); }
  }
  /* LIE FALLOW (8 s): the veil · tops turn amber and settle · soil darkens, frost from the corners · winter sky · clover ticks rise · the cellar door */
  fallowScript(x, t, W, H) {
    const base = H * 0.62, pal = CC.ART.palette(this._pal, true);
    const winter = Math.min(1, Math.max(0, (t - 4) / 1.5));
    const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, `rgba(${40 + 60 * winter},${36 + 70 * winter},${60 + 90 * winter},0.85)`); g.addColorStop(1, 'rgba(30,24,16,0.9)');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.fillStyle = `rgb(${74 - 20 * Math.min(1, t / 3)},${52 - 14 * Math.min(1, t / 3)},${33 - 9 * Math.min(1, t / 3)})`; x.fillRect(0, base, W, H - base);
    if (t > 0.8) for (let k = 0; k < 40; k++) {
      const dt = t - 0.8 - k * 0.04; if (dt < 0) continue;
      const lx = (k * 97) % W, ly = Math.min(base - 4, 40 + dt * 70 + k % 5 * 10), sway = Math.sin(dt * 2 + k) * 14;
      x.fillStyle = k % 3 ? '#d9a83f' : '#b8742a';
      x.beginPath(); x.ellipse(lx + sway, ly, 7, 3, dt + k, 0, Math.PI * 2); x.fill();
    }
    if (t > 2.5) {
      x.strokeStyle = 'rgba(200,230,255,0.8)'; x.lineWidth = 2; x.setLineDash([6, 6]);
      const reach = Math.min(1, (t - 2.5) / 2) * Math.hypot(W, H) / 2;
      for (const [sx, sy, dx, dy] of [[0, 0, 1, 1], [W, 0, -1, 1], [0, H, 1, -1], [W, H, -1, -1]]) { x.beginPath(); x.moveTo(sx, sy); x.lineTo(sx + dx * reach * 0.7, sy + dy * reach * 0.7); x.stroke(); }
      x.setLineDash([]);
    }
    if (t > 5.5) for (let k = 0; k < 24; k++) {
      const dt = t - 5.5 - k * 0.05; if (dt < 0) continue;
      const sx = 20 + k * (W - 40) / 23, h = Math.min(18, dt * 30);
      x.strokeStyle = pal.leaf; x.lineWidth = 2.5; x.beginPath(); x.moveTo(sx, base); x.lineTo(sx, base - h); x.moveTo(sx, base - h * 0.7); x.lineTo(sx - 6, base - h); x.moveTo(sx, base - h * 0.7); x.lineTo(sx + 6, base - h); x.stroke();
    }
    if (t > 7) {
      const up = Math.min(1, (t - 7) / 0.8) * 90;
      x.fillStyle = '#5a5550'; x.fillRect(W / 2 - 40, base - up, 80, up);
      x.fillStyle = '#2a2420'; x.fillRect(W / 2 - 28, base - up + 12, 56, up - 12);
      x.fillStyle = '#f0c060'; x.beginPath(); x.arc(W / 2, base - up / 2, 5, 0, Math.PI * 2); x.fill();
    }
    x.fillStyle = `rgba(10,6,2,${0.5 * Math.min(1, t / 0.5)})`; x.fillRect(0, 0, W, 0);
  }

  goToSeedCeremony() {
    if (this._seedAt && performance.now() - this._seedAt < 20000) return; /* five springs a day: never twice in a breath */
    this._seedAt = performance.now();
    this.runCeremony('seed', 3, (x, t, W, H) => this.seedScript(x, t, W, H), () => this.$('ceremony').classList.add('hidden'));
  }
  ceremony(ev) {
    const show = () => this.ceremonyCard(ev);
    if (ev.type === 'fallow') this.runCeremony('fallow', 8, (x, t, W, H) => this.fallowScript(x, t, W, H), show);
    else show();
  }
  ceremonyCard(ev) {
    const box = this.$('ceremony');
    const qc = this.$('ceremony-quilt');
    this.$('ceremony-box').classList.remove('hidden');
    if (ev.type === 'fallow') {
      CC.audio.fanfare();
      this.$('ceremony-eyebrow').innerHTML = `${CC.icon('fallow')} THE FALLOW YEAR · ${ev.fallows}`;
      this.$('ceremony-title').textContent = 'The world lies fallow';
      this.$('ceremony-body').innerHTML = `The bell rang out. <b>+${ev.loam} loam</b> — every seed went into the ground.<br>` +
        `Bank, plots, ribbons and ladders return to bare soil. The Almanac remembers. The Cellar is open.` +
        (ev.quilt ? `<br><br>The quilt is framed into the chronicle:` : '');
      if (ev.quilt && ev.quilt.length >= 2) {
        const Q = CC.QUILT, x = qc.getContext('2d');
        for (let i = 0; i < Q.w * Q.h && 2 * i + 1 < ev.quilt.length; i++) {
          x.fillStyle = Q.palette[parseInt(ev.quilt.substr(2 * i, 2), 16) || 0] || Q.palette[0];
          x.fillRect(i % Q.w, Math.floor(i / Q.w), 1, 1);
        }
        qc.classList.remove('hidden');
      } else qc.classList.add('hidden');
      this.$('ticker-text').textContent = 'The fields rest. The rabbits do not.';
      this.tickerT = -8;
    } else {
      CC.audio.seed();
      this.$('ceremony-eyebrow').textContent = 'A REHEARSAL';
      this.$('ceremony-title').textContent = 'The bell rang out — and nothing happened';
      this.$('ceremony-body').innerHTML = `That was the rehearsal. Had it been real, <b>${ev.loam} loam</b> would be in the Cellar now and the garden bare.` +
        `<br><br>The bell is armed. The next ringing is the real one.`;
      qc.classList.add('hidden');
    }
    box.classList.remove('hidden');
  }
  buyCellar(id) {
    if (this.awaitingWorld()) return;
    if (this.worldMode) { this.patch.send({ type: 'cellar', id }); return; }
    const c = this.core;
    if (c.buyCellar(id)) { CC.audio.seed(); this.toast(`🪨 ${c.cellarData(id).name} → level ${c.cellarLevel(id)}.`); }
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
    /* DPR-aware backing stores (brief P6): CSS size stays 320×300 */
    this.dpr = Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
    this.canvas.width = 320 * this.dpr; this.canvas.height = 300 * this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.W = 320; this.H = 300;
    this.bg = document.createElement('canvas');
    this.bg.width = this.canvas.width;
    this.bg.height = this.canvas.height;
    this.soilY = 150;

    /* shop rows */
    const shop = this.$('shop');
    this.rows = CC.BUILDINGS.map((b, i) => {
      const row = document.createElement('button');
      row.className = 'b-row';
      row.type = 'button';
      row.innerHTML = `<div class="b-icon">${CC.icon('b' + i)}</div><div class="b-name"></div><div class="b-time"></div>` +
        `<div class="b-cost"></div><div class="b-count"></div><div class="b-fill"></div><span class="b-info" aria-hidden="true">i</span>`;
      row.querySelector('.b-info').addEventListener('click', e => { e.stopPropagation(); this.tooltip({ kind: 'building', i }, row, true); });
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
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'shed-item';
      el.innerHTML = `<div class="s-head"><b><span class="s-name"></span><span class="s-lv"></span></b>` +
        `<span class="s-cost"></span></div>` +
        `<div class="s-effect"></div>` +
        `<div class="s-flavor"></div>`;
      el.addEventListener('click', () => this.buyShed(u.id));
      sitems.appendChild(el);
      return el;
    });

    /* the Root Cellar (R24/R25): a tree, three shelves down */
    const citems = this.$('cellar-items');
    const shelves = {};
    this.cellarEls = (CC.CELLAR || []).map(cd => {
      const tier = cd.tier || 1;
      if (!shelves[tier]) {
        const h = document.createElement('div');
        h.className = 'cellar-shelf';
        h.textContent = ['', 'THE DOOR', 'THE SECOND SHELF', 'THE THIRD SHELF'][tier] || `SHELF ${tier}`;
        citems.appendChild(h);
        shelves[tier] = true;
      }
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'shed-item';
      el.innerHTML = `<div class="s-head"><b><span class="s-name"></span><span class="s-lv"></span></b>` +
        `<span class="s-cost"></span></div><div class="s-effect"></div><div class="s-flavor"></div><span class="s-cap"><i></i></span>`;
      el.querySelector('.s-name').textContent = cd.name;
      el.querySelector('.s-effect').textContent = cd.effect;
      el.querySelector('.s-flavor').textContent = cd.flavor;
      el.addEventListener('click', () => this.buyCellar(cd.id));
      citems.appendChild(el);
      return el;
    });

    /* the Honey Stall (R25): charms and keepsakes */
    const stitems = this.$('stall-items');
    this.stallEls = (CC.CHARMS || []).map(cd => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'shed-item';
      el.innerHTML = `<div class="s-head"><b>${CC.icon(this.charmIcon(cd.id))} <span class="s-name"></span><span class="s-lv"></span></b>` +
        `<span class="s-cost"></span></div><div class="s-effect"></div><div class="s-flavor"></div>`;
      el.querySelector('.s-name').textContent = cd.name;
      el.querySelector('.s-effect').textContent = cd.effect;
      el.querySelector('.s-flavor').textContent = cd.flavor;
      el.addEventListener('click', () => this.buyCharmUI(cd.id));
      stitems.appendChild(el);
      return el;
    });
    this.$('shed-tabs').addEventListener('click', e => {
      const tab = e.target.dataset.tab;
      if (!tab) return;
      for (const b of this.$('shed-tabs').children) b.classList.toggle('on', b.dataset.tab === tab);
      this.$('shed-pane').classList.toggle('hidden', tab !== 'shed');
      this.$('cellar-pane').classList.toggle('hidden', tab !== 'cellar');
      this.$('stall-pane').classList.toggle('hidden', tab !== 'stall');
    });
    this.$('bell-btn').addEventListener('click', () => this.askBell());
    this.$('ceremony-close').addEventListener('click', () => this.$('ceremony').classList.add('hidden'));

    /* the Almanac (R16): 72 page-slots, filled as the world's deeds latch */
    /* the Almanac as a book (brief P18): ladder rows by id prefix, each with its glyph */
    const abox = this.$('almanac-pages');
    const rowsByPrefix = {};
    this.almanacEls = CC.ALMANAC.map(pg => {
      const prefix = pg.id.replace(/\d+$/, '');
      let row = rowsByPrefix[prefix];
      if (!row) {
        row = document.createElement('div'); row.className = 'a-row';
        row.innerHTML = `<span class="a-h" title="${prefix}">${CC.icon(CC.ART.ladderGlyph(prefix))}</span>`;
        rowsByPrefix[prefix] = row; abox.appendChild(row);
      }
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'a-page locked';
      el.setAttribute('aria-label', 'an unwritten page');
      el.addEventListener('mouseenter', () => this.tooltip({ kind: 'almanac', pg }, el));
      el.addEventListener('mouseleave', () => this.tooltip(null));
      el.addEventListener('click', () => this.tooltip({ kind: 'almanac', pg }, el, true));
      row.appendChild(el);
      return el;
    });

    /* roving tabindex (brief, a11y): one tab stop per grid, arrows move inside */
    const roving = (container, items) => {
      items.forEach((el, i) => { el.tabIndex = i === 0 ? 0 : -1; el.setAttribute('role', 'gridcell'); });
      container.addEventListener('keydown', e => {
        const i = items.indexOf(document.activeElement);
        if (i < 0) return;
        const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 6, ArrowUp: -6, Home: -i, End: items.length - 1 - i }[e.key];
        if (step === undefined) return;
        e.preventDefault();
        const j = Math.max(0, Math.min(items.length - 1, i + step));
        items[i].tabIndex = -1; items[j].tabIndex = 0; items[j].focus();
      });
    };
    roving(abox, this.almanacEls);
    abox.setAttribute('role', 'grid'); abox.setAttribute('aria-label', 'Almanac pages');
    for (const r of abox.children) r.setAttribute('role', 'row');
    /* the trophy shelf (brief P13): four silhouettes for four tiers */
    const shelf = this.$('ribbons');
    this.ribbonEls = CC.RIBBONS.map((r, i) => {
      const el = document.createElement('button');
      el.type = 'button';
      const shape = i < 6 ? 'rosette' : i < 15 ? 'medal' : i < 30 ? 'cordon' : 'star';
      el.className = 'ribbon locked';
      el.style.setProperty('--rib-own', r.color); /* the locked rule can still blank --rib */
      el.innerHTML = CC.icon(shape);
      el.setAttribute('aria-label', r.name);
      el.addEventListener('mouseenter', () => this.tooltip({ kind: 'ribbon', r }, el));
      el.addEventListener('mouseleave', () => this.tooltip(null));
      el.addEventListener('click', () => this.tooltip({ kind: 'ribbon', r }, el, true));
      shelf.appendChild(el);
      return el;
    });
    roving(shelf, this.ribbonEls);
  }

  bind() {
    this.canvas.addEventListener('pointerdown', e => {
      CC.audio.ensure();
      const rect = this.canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left - this.canvas.clientLeft) * (this.W / this.canvas.clientWidth);
      const my = (e.clientY - rect.top - this.canvas.clientTop) * (this.H / this.canvas.clientHeight);
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
    this.$('shed-btn').addEventListener('click', () => { this.$('shed').classList.remove('hidden'); this.$('shed-close').focus(); });
    this.$('shed-close').addEventListener('click', () => this.$('shed').classList.add('hidden'));
    this.$('shed').addEventListener('click', e => {
      if (e.target === this.$('shed')) this.$('shed').classList.add('hidden');
    });
    this.$('prestige-btn').addEventListener('click', () => this.askPrestige());
    this.$('prestige-btn').addEventListener('mouseenter', () => this.tooltip({ kind: 'prestige' }, this.$('prestige-btn')));
    this.$('prestige-btn').addEventListener('mouseleave', () => this.tooltip(null));
    const setIcon = (id, icon) => { this.$(id).innerHTML = CC.icon(icon); };
    setIcon('mute-btn', 'sound');
    this.$('mute-btn').addEventListener('click', () => {
      CC.audio.ensure();
      CC.audio.muted = !CC.audio.muted;
      setIcon('mute-btn', CC.audio.muted ? 'mute' : 'sound');
    });
    const dnLabel = () => setIcon('daynight-btn', this.dayNight === 'auto' ? 'moon' : this.dayNight === 'day' ? 'day' : 'night');
    dnLabel();
    this.$('daynight-btn').addEventListener('click', () => {
      this.dayNight = this.dayNight === 'auto' ? 'day' : this.dayNight === 'day' ? 'night' : 'auto';
      this.setPref('carrot-daynight', this.dayNight);
      dnLabel();
      this.applyTheme();
    });
    setIcon('auto-btn', 'auto'); setIcon('num-btn', 'numbers'); setIcon('chronicle-btn', 'book'); setIcon('wipe-btn', 'wipe'); setIcon('calm-btn', 'leaf');
    const cb = this.$('calm-btn');
    cb.classList.toggle('on', this.calm);
    cb.addEventListener('click', () => {
      this.calm = !this.calm;
      this.setPref('carrot-calm', this.calm ? '1' : '');
      cb.classList.toggle('on', this.calm);
      this.applyMotion();
      this.toast(this.calm ? 'Calm: the garden holds still.' : 'Motion back on.', { icon: 'leaf' });
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
    nb.classList.toggle('on', CC.fmtLong || CC.fmtSci);
    nb.addEventListener('click', () => {
      /* three notations: short (1.23Td) → words (tredecillion) → sci (1.23e42) */
      const mode = CC.fmtSci ? 'short' : CC.fmtLong ? 'sci' : 'long';
      CC.fmtLong = mode === 'long'; CC.fmtSci = mode === 'sci';
      nb.classList.toggle('on', mode !== 'short');
      this.setPref('carrot-numbers', mode);
      this._shopSig = this._upgSig = this._shedSig = this._statHtml = this._almanacSeen = this._bankHtml = this._cpsHtml = null; /* repaint every number */
      this.toast(mode === 'long' ? 'Numbers in words — "tredecillion" it is.' : mode === 'sci' ? 'Numbers in powers of ten.' : 'Short numbers.', { icon: 'numbers' });
    });
    this.$('chronicle-btn').addEventListener('click', () => this.openChronicle());
    this.$('chronicle-copy').addEventListener('click', () => this.shareCard());
    /* modals (brief P7): Escape closes, the backdrop closes, focus stays inside */
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if (this.skipCeremony) this.skipCeremony();
        this.closeBedMenu();
        for (const id of ['modal', 'shed', 'ceremony']) this.$(id).classList.add('hidden');
        if (this._dlgReturn && this._dlgReturn.focus) { this._dlgReturn.focus(); this._dlgReturn = null; }
      }
      if (e.key === 'Tab') {
        const open = ['modal', 'shed', 'ceremony'].map(id => this.$(id)).find(el => !el.classList.contains('hidden'));
        if (!open) return;
        const f = [...open.querySelectorAll('button, input, [tabindex="0"], details summary')].filter(el => el.offsetParent !== null);
        if (!f.length) { e.preventDefault(); return; }
        if (e.shiftKey && document.activeElement === f[0]) { f[f.length - 1].focus(); e.preventDefault(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { f[0].focus(); e.preventDefault(); }
        else if (!open.contains(document.activeElement)) { f[0].focus(); e.preventDefault(); }
      }
    });
    this.$('modal').addEventListener('click', e => { if (e.target === this.$('modal')) this.$('modal').classList.add('hidden'); });
    /* keyboard play: Space pulls, V greets the visitor */
    this.canvas.addEventListener('keydown', e => {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); CC.audio.ensure(); this.doClick(this.W / 2, this.soilY); }
      if ((e.key === 'v' || e.key === 'V') && this.visitor && !this.visitor.gone) this.catchVisitor();
    });
    this.$('bed').addEventListener('keydown', e => {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); const i = this.bedHover >= 0 ? this.bedHover : this.core.bed.plots.findIndex(pl => !pl); if (i >= 0) this.bedClick(i); }
      if (e.key === 'Escape') this.closeBedMenu();
      const W = this.core.bedW(), n = this.core.bed.plots.length;
      const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: W, ArrowUp: -W }[e.key];
      if (step) { e.preventDefault(); this.bedHover = Math.max(0, Math.min(n - 1, (this.bedHover < 0 ? 0 : this.bedHover) + step)); this.bedTip(); }
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
    this.$('modal-no').addEventListener('click', () => { this.$('modal').classList.add('hidden'); if (this._dlgReturn && this._dlgReturn.focus) this._dlgReturn.focus(); });
    setInterval(() => this.save(), 15000);
    addEventListener('beforeunload', () => this.save());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.save(); });
  }

  /* ---------------- actions ---------------- */
  doClick(mx, my) {
    if (this.awaitingWorld()) return;
    const g = this.core.click();
    if (this.patchOn()) this.patch.pending++;
    this.deeds.clicks++;
    this.squash = 1;
    CC.audio.pop();
    /* streak: clicks per second over the last second, for sway and the lean */
    this.clickTimes = (this.clickTimes || []).filter(t => this.t - t < 1);
    this.clickTimes.push(this.t);
    this.leanX = Math.max(-1, Math.min(1, (mx - this.W / 2) / 80));
    this.floats.push({ x: mx, y: Math.min(my, this.soilY - 10), vy: -55, life: 1, text: `+${CC.fmt(g)}` });
    if (CC.motion === 'full') {
      this.ripples = this.ripples || [];
      this.ripples.push({ x: mx, y: my, t: 0 });
      const n = this.clickTimes.length > 6 ? 2 : 6;
      for (let i = 0; i < n; i++) this.spawnParticle(160 + (Math.random() - 0.5) * 40, this.soilY + 6, (Math.random() - 0.5) * 160, -90 - Math.random() * 120, 0.7 + Math.random() * 0.4, Math.random() < 0.6 ? '#5a4128' : (this._pal ? this._pal.body[0] : '#ff9232'));
    }
  }
  /* one particle pool, capped at 120 (brief, motion contract) */
  spawnParticle(x, y, vx, vy, life, col) {
    if (this.particles.length >= 120) this.particles.shift();
    this.particles.push({ x, y, vx, vy, life, col });
  }
  /* the celebration ladder: whisper · cheer · fanfare */
  celebrate(rung) {
    const r = CC.CELEBRATE[rung] || CC.CELEBRATE.whisper;
    this.glow = Math.max(this.glow || 0, r.glow);
    if (CC.motion !== 'full') return;
    for (let i = 0; i < r.particles; i++) {
      this.spawnParticle(this.W / 2 + (Math.random() - 0.5) * 120, this.soilY - 30 - Math.random() * 60,
        (Math.random() - 0.5) * 220, -60 - Math.random() * 160, 0.8 + Math.random() * 0.8,
        ['#ffd98a', '#ff9232', '#6fbf5a', '#eab8e4'][i % 4]);
    }
  }

  buyBuilding(i, n) {
    if (this.awaitingWorld()) return;
    CC.audio.ensure();
    /* 'max' resolves against the bank as it stands — locally for the dev
       garden, on the SERVER for the world (the shared bank moves) */
    const count = n === 'max' ? this.core.maxAffordable(i) : n;
    const row = this.rows[i];
    const pulse = cls => { row.classList.remove(cls); void row.offsetWidth; row.classList.add(cls); setTimeout(() => row.classList.remove(cls), 400); };
    if (i === 0 && count >= 1) this.deeds.box++;
    if (this.worldMode) {
      if (count >= 1) { CC.audio.thunk(); pulse('bought'); row.classList.add('pending'); setTimeout(() => row.classList.remove('pending'), 1500); } /* prediction; the snapshot settles it */
      else pulse('shake');
      this.patch.send({ type: 'buy', b: i, n });
      return;
    }
    /* all-or-nothing, exactly like the ×N price on the row (audit f9) */
    if (count >= 1 && this.core.buy(i, count)) { CC.audio.thunk(); pulse('bought'); }
    else pulse('shake');
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
    this.badge('patch');
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
    if (this.visitor && this.visitor.kind !== 'parsnip') this.deeds.rabbit++;
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
      (patch ? `<br><br><i>Your name will not be recorded. Your deed will be felt.</i>` : '') +
      (c.trial ? (() => { /* a Trial is running: going to seed abandons it for everyone */
        const t = c.trialData();
        return `<br><br><b style="color:var(--ink-carrot)">⚠ A Trial is running: ${t ? t.name : c.trial.id}</b> — ` +
          `${CC.fmt(c.totalRun)} / ${CC.fmt(c.trial.goal)}, ${CC.fmtDur(Math.max(0, CC.TRIAL.hours * 3600 - c.trial.t))} left. ` +
          `Going to seed now <b>abandons it for everyone</b>: no completion, no perk.`;
      })() : '');
    this.buildTrialPick();
    const yes = this.$('modal-yes');
    yes.textContent = c.trial ? `Abandon the Trial and go to seed (+${CC.fmt(n)})` : `Go to seed (+${CC.fmt(n)})`;
    yes.onclick = () => {
      this.$('modal').classList.add('hidden');
      const trial = this._trialChoice || null;
      if (patch) {
        this.patch.send(trial ? { type: 'prestige', trial } : { type: 'prestige' });
        return; /* the server announces it to the world */
      }
      const before = this.core.seedMult();
      const gained = this.core.prestige(trial);
      this.goToSeedCeremony();
      if (this.core.trial) this.toast(`${CC.TRIALS.find(t => t.id === trial).name} begins. Goal: ${this.trialGoalText(trial)}.`, { icon: 'trial' });
      CC.audio.seed();
      const b = this.core.seedMult() / before;
      this.toast(`🌸 Second spring. +${CC.fmt(gained)} seeds — ` + (b >= 1.0005
        ? `seed bonus ${this.fmtX(b)}, forever.`
        : `seed bonus now ${this.fmtX(this.core.seedMult())}.`));
      this.save();
    };
    this.openModal();
  }
  /* open the paper modal with focus inside; closing restores it (brief P7) */
  openModal() {
    this._dlgReturn = document.activeElement;
    this.$('modal').classList.remove('hidden');
    this.$('modal-yes').focus();
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
    const first = !this._themeId;
    this._themeId = t;
    this.$('cc-root').dataset.theme = t;
    this._pal = CC.THEMES[t] || CC.THEMES['homestead-day'];
    /* season crossfade (brief P26): keep the old backdrop and fade 1.2 s */
    if (!first && CC.motion === 'full') {
      this.bgOld = this.bgOld || document.createElement('canvas');
      this.bgOld.width = this.bg.width; this.bgOld.height = this.bg.height;
      this.bgOld.getContext('2d').drawImage(this.bg, 0, 0);
      this.crossT = 1.2;
    }
    this.paintBackdrop(this._pal);
  }

  paintBackdrop(pal) {
    const c = { width: this.W, height: this.H }, x = this.bg.getContext('2d'), soilY = this.soilY;
    x.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    x.clearRect(0, 0, c.width, c.height);
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
    orb.addColorStop(0, `rgba(${oc},0.55)`);
    orb.addColorStop(1, `rgba(${oc},0)`);
    x.fillStyle = orb;
    x.fillRect(ox - or, 0, or * 2, soilY);
    if (pal.moon) {
      x.fillStyle = `rgb(${oc})`;
      x.beginPath(); x.arc(ox, oy, 15, 0, Math.PI * 2); x.fill();
      x.fillStyle = 'rgba(120,140,170,0.4)';
      x.beginPath(); x.arc(ox - 5, oy - 4, 3.5, 0, Math.PI * 2);
      x.arc(ox + 6, oy + 5, 2.4, 0, Math.PI * 2); x.fill();
    } else {
      /* a sun DISC with eight short rays (brief P12), not a blur */
      x.strokeStyle = `rgba(${oc},0.85)`; x.lineWidth = 2.5; x.lineCap = 'round';
      for (let k = 0; k < 8; k++) {
        const a = k * Math.PI / 4 + 0.2;
        x.beginPath(); x.moveTo(ox + Math.cos(a) * 22, oy + Math.sin(a) * 22); x.lineTo(ox + Math.cos(a) * 30, oy + Math.sin(a) * 30); x.stroke();
      }
      x.fillStyle = `rgb(${oc})`;
      x.beginPath(); x.arc(ox, oy, 16, 0, Math.PI * 2); x.fill();
      x.strokeStyle = 'rgba(90,60,20,0.35)'; x.lineWidth = 1.5;
      x.beginPath(); x.arc(ox, oy, 16, 0, Math.PI * 2); x.stroke();
    }
    /* clouds: 0–3 soft blobs per pack */
    const nClouds = pal.stars ? 0 : 2;
    for (let k = 0; k < nClouds; k++) {
      const cx = 60 + k * 150, cy = 34 + k * 18;
      x.fillStyle = 'rgba(255,255,255,0.55)';
      x.beginPath(); x.ellipse(cx, cy, 26, 9, 0, 0, Math.PI * 2); x.ellipse(cx + 18, cy - 6, 18, 10, 0, 0, Math.PI * 2); x.ellipse(cx - 16, cy - 3, 14, 8, 0, 0, Math.PI * 2); x.fill();
    }
    /* the hedge: a noisy silhouette with a gap at each side (visitors come through them) */
    x.fillStyle = pal.hedge;
    x.beginPath(); x.moveTo(0, soilY);
    for (let px = 0; px <= c.width; px += 6) {
      const gap = px < 34 || px > c.width - 34;
      const h = gap ? 6 : 16 + Math.sin(px * 0.21) * 3 + Math.sin(px * 0.07 + 1) * 4;
      x.lineTo(px, soilY - h);
    }
    x.lineTo(c.width, soilY); x.closePath(); x.fill();
    /* season props as ink lines (brief P12) */
    const ink = 'rgba(40,26,12,0.75)', paper = '#f6ead2';
    x.lineWidth = 1.5; x.strokeStyle = ink; x.lineCap = 'round';
    /* stall keepsakes (R25): the world's, forever */
    if (this.core.charmCount && this.core.charmCount('bunting') && this.core.season !== 'fair') {
      x.beginPath(); x.moveTo(4, 12); x.quadraticCurveTo(160, 26, 316, 12); x.stroke();
      for (let k = 0; k < 9; k++) {
        const bx = 20 + k * 33, by = 15 + Math.sin(k * 1.1) * 2.5;
        x.fillStyle = k % 3 === 0 ? '#c8452c' : k % 3 === 1 ? paper : '#e7b23a';
        x.beginPath(); x.moveTo(bx, by); x.lineTo(bx + 9, by); x.lineTo(bx + 4.5, by + 9); x.closePath(); x.fill(); x.stroke();
      }
    }
    if (this.core.charmCount && this.core.charmCount('gnome')) {
      const gp = CC.ART.palette(pal, !!pal.stars);
      if (!CC.ART.draw(x, 'gnome', c.width - 56, soilY - 32, 28, gp)) {
        /* no symbol yet: a small ink gnome — cone hat, round body */
        x.fillStyle = '#c8452c'; x.beginPath(); x.moveTo(c.width - 42, soilY - 30); x.lineTo(c.width - 36, soilY - 30); x.lineTo(c.width - 39, soilY - 40); x.closePath(); x.fill(); x.stroke();
        x.fillStyle = '#4a6fa5'; x.beginPath(); x.arc(c.width - 39, soilY - 22, 7, 0, Math.PI * 2); x.fill(); x.stroke();
        x.fillStyle = paper; x.beginPath(); x.arc(c.width - 39, soilY - 28, 3.4, 0, Math.PI * 2); x.fill();
      }
    }
    if (this.core.season === 'fair') {
      /* bunting and a striped tent */
      for (let k = 0; k < 10; k++) {
        const bx = 18 + k * 31, by = 22 + Math.sin(k * 0.9) * 3;
        x.fillStyle = k % 2 ? '#c8452c' : paper;
        x.beginPath(); x.moveTo(bx, by); x.lineTo(bx + 10, by); x.lineTo(bx + 5, by + 10); x.closePath(); x.fill(); x.stroke();
      }
      x.beginPath(); x.moveTo(10, 20); x.quadraticCurveTo(160, 34, 310, 20); x.stroke();
      for (let k = 0; k < 5; k++) { x.fillStyle = k % 2 ? '#c8452c' : paper; x.beginPath(); x.moveTo(246 + k * 11, soilY - 14); x.lineTo(257 + k * 11, soilY - 14); x.lineTo(272, soilY - 48); x.closePath(); x.fill(); }
      x.beginPath(); x.moveTo(246, soilY - 14); x.lineTo(272, soilY - 48); x.lineTo(301, soilY - 14); x.stroke();
    } else if (this.core.season === 'market') {
      /* a stall with a chalkboard */
      x.fillStyle = '#6b4a26'; x.fillRect(236, soilY - 30, 60, 4); x.fillRect(240, soilY - 26, 4, 14); x.fillRect(288, soilY - 26, 4, 14);
      for (let k = 0; k < 6; k++) { x.fillStyle = k % 2 ? '#2e7d43' : paper; x.fillRect(234 + k * 11, soilY - 40, 11, 8); }
      x.strokeRect(236.5, soilY - 40.5, 60, 8);
      x.fillStyle = '#2a2218'; x.fillRect(252, soilY - 22, 24, 14); x.strokeStyle = paper; x.lineWidth = 1; x.beginPath(); x.moveTo(256, soilY - 16); x.lineTo(270, soilY - 16); x.moveTo(256, soilY - 12); x.lineTo(266, soilY - 12); x.stroke();
      x.strokeStyle = ink; x.lineWidth = 1.5;
    } else {
      /* Homestead: a picket fence with a can and a spade leaning on it */
      for (let k = 0; k < 9; k++) { const fx = 40 + k * 11; x.fillStyle = paper; x.fillRect(fx, soilY - 26, 5, 22); x.strokeRect(fx + 0.5, soilY - 26.5, 5, 22); }
      x.beginPath(); x.moveTo(38, soilY - 18); x.lineTo(140, soilY - 18); x.moveTo(38, soilY - 9); x.lineTo(140, soilY - 9); x.stroke();
      x.beginPath(); x.moveTo(150, soilY - 4); x.lineTo(158, soilY - 36); x.stroke(); x.fillStyle = '#8c8c86'; x.beginPath(); x.moveTo(146, soilY - 2); x.lineTo(154, soilY - 2); x.lineTo(152, soilY - 10); x.lineTo(148, soilY - 10); x.closePath(); x.fill();
      x.fillStyle = '#8fb8de'; x.fillRect(168, soilY - 12, 10, 10); x.strokeRect(168.5, soilY - 12.5, 10, 10); x.beginPath(); x.moveTo(178, soilY - 10); x.lineTo(186, soilY - 14); x.stroke();
    }
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
      this.celebrate('fanfare');
      this.toast(`🎀 ${r.name}! ${r.flavor} (+${Math.round((r.mult - 1) * 100)}% production)`);
    } else if (ev.type === 'bumper') {
      const b = CC.BUILDINGS[ev.b];
      if (!b) return;
      if (this.core.charmCount && this.core.charmCount('chimes')) CC.audio.chime();
      CC.audio.upgrade();
      this.celebrate('cheer');
      this.toast(`🌾 Bumper crop! ${ev.at}× ${b.name} — +1% to everything.`);
    } else if (ev.type === 'charm') {
      const cd = this.core.charmData && this.core.charmData(ev.id);
      if (!cd) return;
      if (ev.cosmetic) { CC.audio.fanfare(); this.celebrate('cheer'); } else CC.audio.upgrade();
      this.toast(`${ev.who ? ev.who : 'Someone'} bought ${cd.name} at the stall${ev.cosmetic ? ' — for everyone, forever.' : '.'}`,
        { icon: this.charmIcon(ev.id) });
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
      this.toast(`SOMEONE SENT THE WHOLE GARDEN TO SEED. +${CC.fmt(ev.gained)} seeds ` +
        `— ${what}. ${tt ? `A TRIAL SPRING begins: ${tt.name} — ${tt.line}` : 'A new spring begins.'}`, { icon: 'spring', pri: 'world', key: 'spring' });
      this.celebrate('cheer');
      this.goToSeedCeremony();
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
      this.badge('parish');
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
      } else if (ev.abandoned) {
        CC.audio.rabbit();
        this.toast(`🧪 ${t.name} — abandoned${ev.who ? ` by ${ev.who}` : ''} at a spring. No completion, no perk.`);
      } else {
        CC.audio.rabbit();
        this.toast(`🧪 ${t.name} — the clock ran out. The spring carries on, rule lifted.`);
      }
    } else if (ev.type === 'bell') {
      CC.audio.fanfare();
      const F = CC.FALLOW || { rings: 4 };
      this.toast(`🔔 The bell rings — ${ev.ring} of ${ev.of || F.rings}${ev.rehearsal ? ' (a rehearsal)' : ''}` +
        `${ev.who ? `, rung by ${ev.who}` : ''}. ${ev.ring < (ev.of || F.rings) ? `Next ring in ${CC.fmtDur((ev.next || 0) - this.now())}. Anyone may silence it.` : ''}`);
      this.$('ticker-text').textContent = ev.rehearsal ? 'A bell, rehearsing. The carrots are unconvinced.' : 'The bell. Everyone heard it. Nobody says so.';
      this.tickerT = -6;
    } else if (ev.type === 'silence') {
      this.toast(`🔕 ${ev.who || 'Someone'} silenced the bell${ev.reason ? ` — ${ev.reason}` : ''}.`);
    } else if (ev.type === 'silenceVote') {
      this.toast(`🔕 ${ev.who || 'Someone'} asks for quiet — ${ev.votes} of ${ev.needed} voices needed to silence the bell.`);
    } else if (ev.type === 'rehearsed') {
      this.ceremony(ev);
    } else if (ev.type === 'fallow') {
      this.ceremony(ev);
    } else if (ev.type === 'cellar') {
      const cd = this.core.cellarData(ev.id);
      if (cd) { CC.audio.seed(); this.toast(`🪨 Loam spent: ${cd.name} → level ${ev.lv}. ${cd.effect}.`); }
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
      const boost = ev.boost || q.boost, bh = ev.bh || q.boostHours;
      this.toast(`🌙 The garden lay quiet for ${ev.hours}h. ${ev.who || 'A tender'} came back — Welcome Back ×${boost} for ${bh}h, everyone.${ev.candle ? ' The candle was lit.' : ''}`);
    }
  }

  /* the Clothesline (brief P4): notify({key, pri, text, icon, ttl}). Three
     live tags at most; the same key inside 10 s merges with a count;
     ambient tags are dropped when the queue is deep; world tags pin for
     at least six seconds with a gilt edge. toast(text) is the old verb. */
  toast(text, opts) { this.notify(Object.assign({ text }, opts || {})); }
  notify(n) {
    const pri = n.pri || 'you';
    const icon = n.icon || (/^(\p{Emoji_Presentation}|\p{Extended_Pictographic})/u.test(n.text) ? null : null);
    const text = n.text;
    const key = n.key || text.slice(0, 24);
    const now = performance.now();
    const live = [...this.$('toasts').children];
    const same = live.find(el => el.dataset.key === key && now - (+el.dataset.at) < 10000);
    if (same) {
      const c = same.querySelector('.t-count');
      const k = (+c.dataset.n || 1) + 1;
      c.dataset.n = k; c.textContent = `×${k}`;
      same.dataset.at = now;
      return;
    }
    const queued = this.queue.find(e => e.key === key && now - e.at < 10000);
    if (queued) { queued.count = (queued.count || 1) + 1; return; }
    if (pri === 'ambient' && (live.length + this.queue.length) > 5) return;
    this.queue.push({ key, pri, text, icon: n.icon, ttl: n.ttl || (pri === 'world' ? 6000 : 4200), at: now, count: 1 });
    if (this.queue.length > 8) { const i = this.queue.findIndex(e => e.pri !== 'world'); if (i >= 0) this.queue.splice(i, 1); else this.queue.shift(); }
    this.queue.sort((a, b) => ({ world: 0, you: 1, ambient: 2 })[a.pri] - ({ world: 0, you: 1, ambient: 2 })[b.pri]);
    this.drainToasts();
    /* the screen reader hears it once */
    const sr = this.$('sr-log');
    if (sr) { sr.textContent = text.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '').trim(); }
  }
  drainToasts() {
    const lane = this.$('toasts');
    if (this.holdToasts) return; /* a ceremony is playing: tags wait on the line */
    while (lane.children.length < 3 && this.queue.length) {
      const n = this.queue.shift();
      if (n.pri !== 'world' && performance.now() - n.at > 10000) continue; /* stale news is not news */
      const el = document.createElement('div');
      el.className = 'toast ' + n.pri;
      el.dataset.key = n.key; el.dataset.at = performance.now();
      const body = document.createElement('span');
      body.textContent = n.text;
      if (n.icon) el.insertAdjacentHTML('afterbegin', CC.icon(n.icon));
      el.appendChild(body);
      const cnt = document.createElement('span'); cnt.className = 't-count'; cnt.dataset.n = String(n.count || 1); if (n.count > 1) cnt.textContent = `×${n.count}`;
      el.appendChild(cnt);
      lane.appendChild(el);
      const ttl = CC.motion === 'reduced' ? n.ttl + 1500 : n.ttl;
      setTimeout(() => el.classList.add('out'), ttl);
      setTimeout(() => { el.remove(); this.drainToasts(); }, ttl + 600);
    }
  }

  /* a floating note pinned beside the hovered element (never in the
     document flow): prefer the left side, fall back right, clamp to the
     viewport; hidden entirely when nothing is hovered */
  /* hover and tap share one note: a tap PINS it (brief, touch-honest
     tooltips) until the next tap anywhere; hover never unpins a pinned note */
  tooltip(what, el, pin) {
    const tip = this.$('tooltip');
    if (!pin && this._tipPinned && what !== null) return;
    if (!pin && this._tipPinned && what === null) return;
    this._tipPinned = !!pin;
    tip.classList.toggle('pinned', !!pin);
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
    if (pin) {
      const close = e => { if (!tip.contains(e.target)) { this._tipPinned = false; tip.classList.remove('pinned'); tip.classList.add('hidden'); document.removeEventListener('pointerdown', close, true); } };
      setTimeout(() => document.addEventListener('pointerdown', close, true), 0);
    }
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
        this.deeds.clicks++;
        this._acN = (this._acN || 0) + 1;
        if (this._acN % 8 === 0) {
          /* one visible pull per second — a distinct squash synced with the
             +N float — instead of an 8 Hz vibration (the clicks themselves
             still land every 125 ms; only the animation breathes slower) */
          this.squash = Math.max(this.squash, 0.8);
          /* auto floats rise from the soil line, never over the readouts (brief P6) */
          this.floats.push({ x: 160 + (Math.random() - 0.5) * 60, y: this.soilY - 6,
            vy: -45, life: 1, text: `+${CC.fmt(g * 8)}` });
          if (CC.motion === 'full') for (let i = 0; i < 3; i++) {
            this.spawnParticle(160 + (Math.random() - 0.5) * 30, this.soilY + 6, (Math.random() - 0.5) * 110, -70 - Math.random() * 80, 0.6 + Math.random() * 0.3, Math.random() < 0.6 ? '#5a4128' : '#ff9232');
          }
        }
      }
    }

    /* visitor lifecycle (locally scheduled only in the dev garden, from
       the same data table the server reads — one brain, two clocks) */
    if (!this.worldMode && !this.visitor && this.t >= this.nextVisitor) {
      if (this.core.rule('noVisitors')) { /* Quiet Hedge (R22): nobody comes */
        this.nextVisitor = this.t + (CC.VISITOR_GAP[0] + Math.random() * (CC.VISITOR_GAP[1] - CC.VISITOR_GAP[0])) / this.core.gateRate();
      } else {
        /* A Four-Leaf Clover / A Picnic Blanket (R25) shape the dev table too */
        const vs = this.core.charmBusy && this.core.charmBusy('clover4') ? CC.VISITORS.filter(v => v.id !== 'tin') : CC.VISITORS;
        let w = vs.reduce((s, v) => s + v.weight, 0) * Math.random();
        const pick = vs.find(v => (w -= v.weight) < 0) || vs[0];
        this.spawnVisitor(pick.id, pick.ttl + (this.core.perks.longEars || 0) * CC.TRIAL.longEarsSec
          + (this.core.charmBusy && this.core.charmBusy('picnic') ? 6 : 0));
      }
    }
    if (this.visitor && !this.visitor.gone) {
      const r = this.visitor;
      const ttl = r.patchTtl || 12;
      /* a visitor doesn't blink out of existence — with 2.5s left it warns
         and makes for the nearest hedge gap */
      if (!r.leaving && this.t - r.born > ttl - 2.5) {
        r.leaving = true;
        r.dir = r.x < this.W / 2 ? -1 : 1;
        this.toast(r.kind === 'parsnip'
          ? '🥕 The Parsnip Man is folding up his stall…'
          : '🐇 The golden rabbit is hopping away…');
      }
      const pace = r.kind === 'parsnip' ? 25 : 55;
      r.x += r.dir * (r.leaving ? 170 : pace) * dt;
      if (!r.leaving) {
        if (r.x > this.W - 20) r.dir = -1;
        if (r.x < 20 && r.dir === -1) r.dir = 1;
      } else if (r.x < -40 || r.x > this.W + 40) {
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
    if (document.hidden) { this.particles = []; this.ripples = []; } /* nothing animates unseen */
    for (const p of this.particles) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 420 * dt; p.life -= dt;
      if (p.y > this.soilY + 8 && p.vy > 0) { p.y = this.soilY + 8; p.vy = -p.vy * 0.25; p.vx *= 0.6; p.life = Math.min(p.life, 0.25); } /* they land on the soil */
    }
    this.particles = this.particles.filter(p => p.life > 0);
    for (const f of this.floats) { f.y += f.vy * dt; f.life -= dt * 0.9; }
    this.floats = this.floats.filter(f => f.life > 0);
    for (const r of (this.ripples || [])) r.t += dt;
    this.ripples = (this.ripples || []).filter(r => r.t < 0.45);
    if (this.squash > 0) this.squash = Math.max(0, this.squash - dt * 6);
    if (this.glow > 0) this.glow = Math.max(0, this.glow - dt);
    if (this.crossT > 0) this.crossT -= dt;
    /* the wet band fades six seconds after the rain (brief P12) */
    if (this.core.buffs.some(b => CC.WEATHER.some(w => w.name === b.name))) this.wetUntil = this.t + 6;
    if (this.leanX) this.leanX *= Math.max(0, 1 - dt * 3);

    this.tickerT += dt;
    /* the screen reader's status line, every ten seconds (brief, a11y) */
    this._srT = (this._srT || 0) + dt;
    if (this._srT > 10) {
      this._srT = 0;
      const c = this.core, words = CC.fmtLong; CC.fmtLong = true;
      const line = `${CC.fmt(Math.floor(c.bank))} carrots, ${CC.fmt(c.cps())} per second${this.visitor && !this.visitor.gone ? `, a ${this.visitor.kind === 'parsnip' ? 'parsnip man' : 'rabbit'} is in the patch` : ''}.`;
      CC.fmtLong = words;
      this.$('sr-state').textContent = line;
      this.canvas.setAttribute('aria-label', `The carrot. ${line} Press Space to pull, V to greet a visitor.`);
    }
    /* ambient life (brief P27): a capped sprite layer per pack, none when calm or unseen */
    if (CC.motion === 'full' && !document.hidden) {
      this.ambient = this.ambient || [];
      const pal = this._pal || {}, night = !!pal.stars, season = this.core.season;
      const want = night ? 'firefly' : season === 'fair' ? 'butterfly' : this.core.honey > 0 ? 'bee' : null;
      if (want && this.ambient.length < (want === 'firefly' ? 12 : 5) && Math.random() < dt * 0.4) {
        this.ambient.push({ kind: want, x: Math.random() * this.W, y: 30 + Math.random() * (this.soilY - 70), vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 14, life: 8 + Math.random() * 10, ph: Math.random() * 6 });
      }
      for (const a of this.ambient) { a.x += a.vx * dt; a.y += a.vy * dt + Math.sin(this.t * 3 + a.ph) * 10 * dt; a.life -= dt; if (a.x < 0 || a.x > this.W) a.vx *= -1; if (a.y < 20 || a.y > this.soilY - 20) a.vy *= -1; }
      this.ambient = this.ambient.filter(a => a.life > 0);
      if (!this._birdT || this.t - this._birdT > 90) { this._birdT = this.t; if (!night && Math.random() < 0.7) this.ambient.push({ kind: 'bird', x: -10, y: 30 + Math.random() * 40, vx: 60, vy: 0, life: 6, ph: 0 }); }
      /* The Allotment Cat (R25): a patrol along the hedge, now and then */
      if (this.core.charmCount && this.core.charmCount('cat') && (!this._catT || this.t - this._catT > 240) && !this.ambient.some(a => a.kind === 'cat')) {
        this._catT = this.t;
        const ltr = Math.random() < 0.5;
        this.ambient.push({ kind: 'cat', x: ltr ? -16 : this.W + 16, y: this.soilY - 6, vx: ltr ? 22 : -22, vy: 0, life: (this.W + 40) / 22, ph: Math.random() * 6 });
      }
    } else this.ambient = [];
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
    /* the Trial sash (R22): a bunting ribbon on the hero's frame */
    const chips = []; /* every clock on the page, rendered once below */
    {
      const tl = this.$('trial-line'), tr = c.trial, td = tr && c.trialData(), sash = this.$('sash');
      tl.classList.toggle('hidden', !td);
      sash.classList.toggle('hidden', !td);
      if (td) {
        const left = Math.max(0, CC.TRIAL.hours * 3600 - tr.t);
        const halt = c.rule('haltOnBuy') && c.haltT > 0;
        tl.classList.toggle('halt', !!halt);
        sash.classList.toggle('halt', !!halt);
        this.setText(sash, `${td.name.toUpperCase()} · ${CC.fmtDur(left)}`);
        this.setText(tl, halt
          ? `${td.name}: stilled — thaws in ${CC.fmtDur(c.haltT)} · ${CC.fmtDur(left)} left`
          : `${td.name}: ${CC.fmt(c.totalRun)} / ${CC.fmt(tr.goal)} · ${CC.fmtDur(left)} left`);
        sash.title = td.line;
        chips.push({ icon: halt ? 'frost' : 'trial', cls: halt ? 'frost' : 'hot', name: halt ? 'thaw' : td.name, time: halt ? CC.fmtDur(c.haltT) : `${CC.fmt(c.totalRun)}/${CC.fmt(tr.goal)}`, p: halt ? 1 - c.haltT / c.rule('haltOnBuy') : Math.min(1, c.totalRun / tr.goal) });
      }
    }
    const bankHtml = CC.fmtHtml(Math.floor(c.bank));
    if (bankHtml !== this._bankHtml) { this._bankHtml = bankHtml; this.$('bank').innerHTML = bankHtml; this.$('strip-bank').innerHTML = bankHtml; }
    const cpsHtml = `${CC.fmtHtml(c.cps())} <span class="sub">per second · pull for</span> ${CC.fmtHtml(c.clickPower())}`;
    if (cpsHtml !== this._cpsHtml) { this._cpsHtml = cpsHtml; this.$('cps').innerHTML = cpsHtml; this.$('strip-cps').innerHTML = CC.fmtHtml(c.cps()) + '/s'; }

    /* every buff, not just the first: a Bumper Week and a passing rain
       stack, and both deserve a clock (R21) */
    this.setText(this.$('buff-line'), c.buffs.map(b =>
      `${b.name}${b.mult === 1 ? '' : ' ×' + b.mult} — ${b.left >= 60 ? CC.fmtDur(b.left) : Math.ceil(b.left) + 's'}`).join(' · '));
    for (const b of c.buffs) {
      const w = CC.WEATHER.find(x => x.name === b.name);
      const frenzy = b.mult >= 7, bad = b.mult < 1;
      const cd = b.charm && c.charmData ? c.charmData(b.charm) : null;
      const dur = cd ? (cd.dur || cd.cd || 30) : w ? w.dur : b.keep ? 86400 : 30;
      chips.push({ icon: cd ? this.charmIcon(b.charm) : w ? 'sun' : bad ? 'moon' : frenzy ? 'bolt' : 'wheat',
        cls: cd ? 'honey' : bad ? 'quiet' : frenzy ? 'hot' : w ? 'cool' : 'hot',
        name: `${b.name}${b.mult === 1 ? '' : ' ×' + b.mult}`, time: b.left >= 60 ? CC.fmtDur(b.left) : Math.ceil(b.left) + 's', p: Math.min(1, b.left / dur) });
    }

    /* the Gate (R21): the honey jar and the Market Hour clock */
    {
      const gl = this.$('gate-line');
      const m = this.worldMode && this.patch && this.patch.everSynced ? this.patch.market : null;
      const mh = CC.MARKET_HOUR || {};
      const parts = [];
      if (c.honey > 0 || m) { parts.push(`${CC.fmt(c.honey)} honey`); chips.push({ icon: 'honey', name: '', time: CC.fmt(c.honey), cls: '' }); }
      if (m && m.active) { parts.push(`MARKET HOUR — ${CC.fmtDur(m.end - this.now())} left · prices −${Math.round((mh.priceOff || 0.2) * 100)}%`);
        chips.push({ icon: 'market', cls: 'market', name: 'Market Hour', time: CC.fmtDur(m.end - this.now()), p: 1 - (m.end - this.now()) / ((mh.hours || 3) * 3600) }); }
      else if (m && m.next) { parts.push(`Market Hour opens in ${CC.fmtDur(m.next - this.now())}`); chips.push({ icon: 'market', cls: 'quiet', name: 'market', time: CC.fmtDur(m.next - this.now()) }); }
      gl.classList.toggle('hidden', !parts.length);
      this.setText(gl, parts.join(' · '));
      /* the season clock joins the chips */
      if (this.worldMode && this.patch && this.patch.everSynced && this.patch.seasonEnds > 0) {
        const sd = c.seasonData();
        const left = Math.max(0, this.patch.seasonEnds - Date.now() / 1000);
        chips.push({ icon: 'tent', cls: 'cool', name: sd ? sd.name.replace(/^the /, '') : 'a new season', time: CC.fmtDur(left), p: 1 - Math.min(1, left / (CC.SEASON_DAYS * 86400)), title: sd ? sd.bonus : 'refresh to join it' });
      }
      if (this.patchOn()) chips.push({ icon: 'hands', cls: 'quiet', name: `${this.patch.online}`, time: c.handsBonus > 1 ? `+${Math.round((c.handsBonus - 1) * 100)}%` : 'tending', title: this.$('patch-line').textContent });
      else if (this.worldMode && this.patch && this.patch.everSynced) chips.push({ icon: 'globe', cls: 'hot', name: 're-syncing', time: '…', title: 'the patch is out of reach — pulls wait' });
      else if (this.awaitingWorld()) chips.push({ icon: 'globe', cls: 'hot', name: 'reaching the patch', time: '…' });
      if (CC.BED) chips.push({ icon: 'pl-sprout', cls: 'quiet', name: 'bed tick', time: CC.fmtDur(CC.BED.tick - c.bedT), p: c.bedT / CC.BED.tick });
    }

    /* the Seed Bed (R23): soil bar, clock, the seed log, the sacrifice */
    {
      const soil = c.soilData();
      const left = CC.BED.soilCooldown - (this.now() - c.bed.soilAt);
      for (const b of this.$('soil-btns').children) {
        b.classList.toggle('on', b.dataset.id === c.bed.soil);
        b.disabled = left > 0 && b.dataset.id !== c.bed.soil;
        b.style.setProperty('--p', b.dataset.id === c.bed.soil ? 0 : left > 0 ? 1 - left / CC.BED.soilCooldown : 0);
      }
      const alive = c.bed.plots.filter(Boolean).length;
      this.setText(this.$('bed-clock'),
        `${soil.every > 1 ? `grows every ${soil.every}th tick · ` : ''}${alive}/${c.bed.plots.length} plots` +
        (left > 0 ? ` · soil in ${CC.fmtDur(left)}` : '') + (c.bedMult() !== 1 ? ` · ${this.fmtX(c.bedMult())}` : ''));
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
      if (c.bed.sacrificeLeft > 0) this.setText(this.$('sacrifice-text'), `the log is given up in ${CC.fmtDur(c.bed.sacrificeLeft)} — anyone may cancel`);
    }

    /* Parish Orders (R21) — every card on the board (Wider Orders, R24) */
    {
      const list = this.worldMode && this.patch ? (this.patch.orders || []) : [];
      const bar = this.$('order-bar');
      bar.classList.toggle('hidden', !list.length);
      while (bar.children.length > list.length) bar.lastChild.remove();
      while (bar.children.length < list.length) {
        const card = document.createElement('div');
        card.className = 'obar';
        card.innerHTML = `<div class="o-seal">${CC.icon('order')}</div><div class="o-main"><div class="o-name"><span class="order-name"></span><i class="order-line"></i></div>` +
          `<div class="o-track order-track"><div class="o-fill order-fill"></div><i class="o-mark"></i><i class="o-mark"></i><i class="o-mark"></i></div>` +
          `<div class="o-tiers"><span class="order-progress"></span><span class="order-tier"></span></div></div>` +
          `<div class="o-due order-due"><span class="o-due-label">due in</span><b></b></div>` +
          `<div class="o-stakes"><span class="order-stakes"></span> <span class="order-last"></span></div>`;
        bar.appendChild(card);
      }
      list.forEach((o, k) => this.renderOrder(bar.children[k], o, k === 0));
    }
    /* the Gate (brief P20): three live deeds for a newcomer */
    if (this.tenure === 'new') {
      const d = this.deeds;
      const deeds = [
        { icon: 'hand', text: 'Pull a carrot', p: Math.min(1, d.clicks / 10), done: d.clicks >= 10 },
        { icon: 'b0', text: 'Buy a Window Box', p: Math.min(1, d.box), done: d.box >= 1 },
        { icon: 'rabbit', text: 'Greet the rabbit when it comes', p: Math.min(1, d.rabbit), done: d.rabbit >= 1 },
      ];
      if (this.t - (this._deedsSaved || 0) > 5) { this._deedsSaved = this.t; this.setPref('carrot-deeds', JSON.stringify(d)); }
      const gsig = deeds.map(d => `${d.done}${d.p.toFixed(2)}`).join();
      if (gsig !== this._gateSig) {
        this._gateSig = gsig;
        this.$('gate-card').classList.remove('hidden');
        this.$('gate-deeds').innerHTML = deeds.map(d => `<div class="deed${d.done ? ' done' : ''}">${CC.icon(d.icon)}<span>${d.text}</span><span class="rail" style="--p:${d.p}"><i></i></span></div>`).join('');
        if (deeds.every(d => d.done)) this.setTenure('settled');
      }
    }

    /* season (R17): the world's shared festival, clock always visible —
       but only when the server actually runs a calendar (seasonEnds > 0;
       a pre-R17 server must not produce a "0 days left" standing lie) */
    if (this.worldMode && this.patch && this.patch.everSynced && this.patch.seasonEnds > 0) {
      const sd = c.seasonData();
      const sl = this.$('season-line');
      sl.classList.remove('hidden');
      const days = Math.max(0, Math.min(CC.SEASON_DAYS, Math.ceil((this.patch.seasonEnds - Date.now() / 1000) / 86400)));
      this.setText(sl, sd ? `${sd.name} — ${days} day${days === 1 ? '' : 's'} left · ${sd.bonus}` : 'A new season is on — refresh the page to join it!');
    }

    this.setText(this.$('seed-line'), c.seeds > 0
      ? `${CC.fmt(c.seeds)} seeds — ${this.fmtX(c.seedMult())} production, forever` : '');

    /* the Potting Shed (R13): balance always on the main screen, catalog
       behind its own screen; the button glows when the world can afford
       something new */
    const shedBought = Object.keys(c.shed).length;
    const spHtml = (c.sprouts > 0 || shedBought > 0) ? `${CC.icon('sprout')} ${CC.fmtHtml(c.sprouts)} sprout${c.sprouts === 1 ? '' : 's'} to spend` : '';
    if (spHtml !== this._spHtml) { this._spHtml = spHtml; this.$('sprout-line').innerHTML = spHtml; }
    const sb = this.$('shed-btn');
    sb.classList.toggle('hidden', !(c.seeds > 0 || c.sprouts > 0 || shedBought > 0 || c.loam > 0 || c.fallows > 0));
    sb.classList.toggle('affordable', CC.SHED.some(u =>
      !c.shedMaxed(u) && c.shedVisible(u) && c.sprouts >= c.shedCost(u.id)));
    const shedSig = CC.SHED.map(u => {
      if (!c.shedVisible(u)) return '?';
      if (c.shedMaxed(u)) return 'x' + c.shedLevel(u.id);
      return (c.sprouts >= c.shedCost(u.id) ? '+' : '-') + c.shedLevel(u.id);
    }).join(',') + '|' + c.sprouts;
    if (shedSig !== this._shedSig) {
      this._shedSig = shedSig;
      this.$('shed-balance').innerHTML = `<b>${CC.fmt(c.sprouts)}</b> ${CC.icon('sprout')} sprouts ready for planting` +
        ` · <span class="stat-sub">${CC.fmt(c.sproutsSpent)} planted since records began</span>`;
      /* completed one-shots fold into a strip so the ladders come first (brief P21) */
      const done = this.$('shed-done-items'), live = this.$('shed-items');
      let folded = 0;
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
        el.querySelector('.s-cost').innerHTML = !vis ? CC.icon('lock')
          : maxed ? (u.repeat ? 'fully grown' : 'planted')
            : `${CC.fmt(c.shedCost(u.id))} ${CC.icon('sprout')}`;
        const home = maxed && !u.repeat ? done : live;
        if (el.parentNode !== home) home.appendChild(el);
        if (maxed && !u.repeat) folded++;
      });
      this.$('shed-done').classList.toggle('hidden', !folded);
      this.$('shed-done-sum').textContent = `${folded} planted — the one-shots, folded away`;
    }

    /* Lie Fallow (R24): the bell and the Cellar */
    {
      const bell = this.worldMode && this.patch ? this.patch.bell : null;
      const bb = this.$('bell-btn'), bl = this.$('bell-line');
      const avail = c.fallowAvailable();
      const restUntil = this.worldMode && this.patch ? (this.patch.bellRest || 0) + ((CC.FALLOW && CC.FALLOW.ringRest) || 600) : 0;
      const resting = !bell && restUntil > this.now();
      bb.classList.toggle('hidden', !(avail || bell));
      bb.classList.toggle('ringing', !!bell);
      bb.disabled = resting;
      let bbHtml;
      if (resting) {
        bbHtml = `${CC.icon('mute')} The bell rests — ${CC.fmtDur(restUntil - this.now())}`;
        bl.classList.add('hidden');
      } else if (bell) {
        const F = CC.FALLOW, nextAt = bell.at + bell.rung * F.ringGap;
        const votes = bell.votes || 0;
        bbHtml = `${CC.icon('mute')} ${votes ? `Ask for quiet (${votes} so far)` : 'Ask for quiet'}`;
        bl.classList.remove('hidden');
        this.setText(bl, `ring ${bell.rung} of ${F.rings}${bell.rehearsal ? ' (rehearsal)' : ''} · ` +
          (bell.rung < F.rings ? `next in ${CC.fmtDur(nextAt - this.now())}` : 'ringing out…') +
          ` · ${bell.rehearsal ? 'nothing resets this time' : `the world lies fallow at the ${F.rings}th`}`);
        chips.push({ icon: 'bell', cls: 'bell', name: `ring ${bell.rung}/${F.rings}${bell.rehearsal ? ' ·rehearsal' : ''}`,
          time: bell.rung < F.rings ? CC.fmtDur(nextAt - this.now()) : 'ringing out', p: (bell.rung - 1 + Math.min(1, 1 - (nextAt - this.now()) / F.ringGap)) / F.rings, title: bl.textContent });
      } else {
        bbHtml = avail ? `${CC.icon('bell')} Ring the bell — Lie Fallow (+${c.loamPending()} loam)${!c.rehearsed && this.worldMode ? ' · rehearsal' : ''}` : '';
        bl.classList.add('hidden');
      }
      if (bbHtml !== this._bbHtml) { this._bbHtml = bbHtml; bb.innerHTML = bbHtml; }
      const cSig = (CC.CELLAR || []).map(cd => c.cellarLevel(cd.id) + (c.cellarVisible(cd) ? 'v' : '')).join(',') + '|' + c.loam + '|' + c.fallows;
      if (cSig !== this._cellarSig) {
        this._cellarSig = cSig;
        this.$('cellar-balance').innerHTML = `<b>${CC.fmt(c.loam)}</b> ${CC.icon('loam')} loam` +
          ` · <span class="stat-sub">${c.fallows} Fallow${c.fallows === 1 ? '' : 's'} on record</span>`;
        (CC.CELLAR || []).forEach((cd, i) => {
          const el = this.cellarEls[i], lv = c.cellarLevel(cd.id), maxed = c.cellarMaxed(cd), lit = c.cellarVisible(cd);
          el.classList.toggle('locked', !lit);
          el.querySelector('.s-lv').textContent = lv > 0 ? ` · Lv ${lv}/${cd.cap}` : ` · 0/${cd.cap}`;
          el.classList.toggle('bought', maxed);
          el.classList.toggle('cant', !maxed && (!lit || c.loam < c.cellarCost(cd.id)));
          el.querySelector('.s-cost').innerHTML = !lit
            ? `${CC.icon('tierlock')} needs ${(cd.req || []).map(r => (c.cellarData(r) || { name: r }).name).join(' + ')}`
            : maxed ? 'at its cap' : `${c.cellarCost(cd.id)} ${CC.icon('loam')}`;
          el.querySelector('.s-cap').style.setProperty('--p', lv / cd.cap);
        });
      }
      /* the Honey Stall (R25) */
      const cosSig = ['gnome', 'bunting', 'tophat', 'cat'].map(id => c.charmCount(id) ? 1 : 0).join('');
      if (cosSig !== this._cosSig) { this._cosSig = cosSig; if (this._pal) this.paintBackdrop(this._pal); }
      const stSig = (CC.CHARMS || []).map(cd => c.charmCount(cd.id) + (c.charmBusy(cd.id) ? 'b' : '')).join(',') + '|' + c.honey;
      if (stSig !== this._stallSig) {
        this._stallSig = stSig;
        this.$('stall-balance').innerHTML = `<b>${CC.fmt(c.honey)}</b> ${CC.icon('honey')} honey in the jar`;
        (CC.CHARMS || []).forEach((cd, i) => {
          const el = this.stallEls[i], n = c.charmCount(cd.id), busy = c.charmBusy(cd.id);
          const owned = cd.once && n >= 1, full = cd.store && n >= cd.store;
          el.classList.toggle('bought', !!owned);
          el.classList.toggle('cant', !owned && (busy || full || c.honey < cd.cost));
          el.querySelector('.s-lv').textContent = cd.store && n > 0 ? ` · ×${n} stored` : '';
          const buff = busy && this.core.buffs.find(b => b.charm === cd.id);
          el.querySelector('.s-cost').innerHTML = owned ? 'ours, forever'
            : busy ? (cd.dur ? `working — ${CC.fmtDur(buff ? buff.left : 0)}` : `rests ${CC.fmtDur(buff ? buff.left : 0)}`)
              : full ? 'the shelf is full' : `${cd.cost} ${CC.icon('honey')}`;
        });
      }
    }

    /* the clock chips (brief P3): one wrap row under cps */
    {
      const sig = chips.map(ch => `${ch.icon}|${ch.name}|${ch.time}|${(ch.p || 0).toFixed(2)}`).join(';');
      if (sig !== this._chipSig) {
        this._chipSig = sig;
        const box = this.$('chips');
        while (box.children.length > chips.length) box.lastChild.remove();
        while (box.children.length < chips.length) { const el = document.createElement('span'); box.appendChild(el); }
        chips.forEach((ch, i) => {
          const el = box.children[i];
          el.className = `chip ${ch.cls || ''}${ch.p !== undefined ? ' fill' : ''}`;
          el.style.setProperty('--p', ch.p || 0);
          el.title = ch.title || '';
          el.innerHTML = `${CC.icon(ch.icon)}${ch.name ? `<span>${ch.name}</span>` : ''}<b>${ch.time}</b>`;
        });
        const urgent = ch => (ch.cls === 'bell' || ch.cls === 'hot' || ch.cls === 'market' || ch.cls === 'frost') ? 0 : 1;
        this.$('strip-chips').innerHTML = chips.slice().sort((a, b) => urgent(a) - urgent(b)).slice(0, 5).map(ch => `<span title="${ch.name} ${ch.time}">${CC.icon(ch.icon)}</span>`).join('');
      }
    }
    const pending = c.pendingSeeds();
    const pb = this.$('prestige-btn');
    pb.classList.toggle('hidden', pending < 1);
    if (pending >= 1) { const h = `${CC.icon('spring')} Go to Seed (+${CC.fmt(pending)})`; if (h !== this._pbHtml) { this._pbHtml = h; pb.innerHTML = h; } }

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
        const cant = isNextMystery || c.bank < cost || c.rowRoom(i) < bn;
        /* .ripe: a plank that just became affordable glows once (brief P14) */
        if (!cant && row.classList.contains('cant') && !isNextMystery && this.t > 2) { row.classList.add('ripe'); setTimeout(() => row.classList.remove('ripe'), 1200); this.badge('shop'); }
        row.classList.toggle('cant', cant);
        const next = c.nextBumperAt(i);
        row.querySelector('.b-name').textContent = isNextMystery ? '???' : b.name;
        /* ceil the label: fractional prices (1.15^n, Market discounts) must
           never display cheaper than they charge. The plank's right-hand
           label is the price in the world's own time (brief P2). */
        const cps = c.cps();
        const costHtml = isNextMystery ? ''
          : `${CC.fmtHtml(Math.ceil(cost))} ${CC.icon('carrot')}${bn > 1 ? ` ×${bn}` : ''}` +
            (c.owned[i] > 0 && next ? `<span>${CC.icon('wheat')} ${c.owned[i]}/${next}</span>` : '');
        if (row._cost !== costHtml) { row._cost = costHtml; row.querySelector('.b-cost').innerHTML = costHtml; }
        this.setText(row.querySelector('.b-time'), isNextMystery ? '' : (c.bank >= cost ? 'now' : CC.fmtTime((cost - c.bank) / Math.max(cps, 1e-9))));
        this.setText(row.querySelector('.b-count'), String(c.owned[i] || ''));
        const pf = (isNextMystery ? 0 : Math.min(1, c.bank / cost)).toFixed(3);
        if (row._p !== pf) { row._p = pf; row.style.setProperty('--p', pf); }
        const label = isNextMystery ? 'a plot not yet known' : `${b.name}, ${CC.fmt(Math.ceil(cost))} carrots${c.owned[i] ? `, ${c.owned[i]} owned` : ''}`;
        if (row._label !== label) { row._label = label; row.setAttribute('aria-label', label); }
      });
    }

    /* packets: patched by id, never rebuilt wholesale (a rebuild killed
       tooltips mid-read, brief P14); a bought packet tears off */
    const ups = c.visibleUpgrades().slice(0, 12);
    const sig = ups.map(u => u.id + (c.bank >= u.cost ? '+' : '-')).join(',');
    if (sig !== this._upgSig) {
      this._upgSig = sig;
      const box = this.$('upgrades');
      const want = new Set(ups.map(u => u.id));
      for (const el of [...box.children]) {
        if (!el.dataset.id) { el.remove(); continue; }
        if (!want.has(el.dataset.id) && !el.classList.contains('torn')) {
          if (this.core.bought[el.dataset.id]) { el.classList.add('torn'); setTimeout(() => el.remove(), CC.motion === 'full' ? 320 : 0); }
          else el.remove();
        }
      }
      for (const u of ups) {
        let el = box.querySelector(`[data-id="${u.id}"]`);
        if (!el) {
          el = document.createElement('button');
          el.type = 'button';
          el.dataset.id = u.id;
          el.innerHTML = `<span class="u-kind">${CC.icon(CC.ART.kindOf(u))}</span><b></b><span class="cost"></span>`;
          el.querySelector('b').textContent = u.name;
          el.addEventListener('click', () => this.buyUpgrade(u.id));
          el.addEventListener('mouseenter', () => this.tooltip({ kind: 'upgrade', u }, el));
          el.addEventListener('mouseleave', () => this.tooltip(null));
          el.addEventListener('focus', () => this.tooltip({ kind: 'upgrade', u }, el));
          el.addEventListener('blur', () => this.tooltip(null));
          box.appendChild(el);
        }
        el.className = 'upgrade' + (c.bank < u.cost ? ' cant' : '');
        el.querySelector('.cost').innerHTML = `${CC.fmtHtml(u.cost)} ${CC.icon('carrot')}`;
      }
      if (!ups.length && !box.querySelector('.u-empty')) { const e = document.createElement('span'); e.className = 'u-empty'; e.style.cssText = 'color:var(--dim);font-size:12px'; e.textContent = 'Nothing on the shelf right now — keep growing.'; box.appendChild(e); }
      if (ups.length) { const e = box.querySelector('.u-empty'); if (e) e.remove(); }
    }

    /* the shelf: a newly won ribbon pins itself */
    CC.RIBBONS.forEach((r, i) => {
      const el = this.ribbonEls[i], won = c.totalAllTime >= r.at;
      if (won && el.classList.contains('locked') && this.t > 2) { el.classList.add('pinned'); setTimeout(() => el.classList.remove('pinned'), 600); }
      el.classList.toggle('locked', !won);
    });

    /* almanac — signature is the page SET, not the count: a snapshot can
       swap which pages are latched at equal count (review P3) */
    const aSig = Object.keys(c.almanac).join();
    if (aSig !== this._almanacSeen) {
      this._almanacSeen = aSig;
      this.$('almanac-line').textContent =
        `${c.almanacCount()}/${CC.ALMANAC.length} pages written — ${this.fmtX(c.almanacMult())} production`;
      let newest = null;
      CC.ALMANAC.forEach((pg, i) => {
        const el = this.almanacEls[i], got = !!c.almanac[pg.id];
        if (got && el.classList.contains('locked') && this.t > 2) { el.classList.add('inked'); newest = el; }
        el.classList.toggle('locked', !got);
        el.classList.remove('newest');
        el.setAttribute('aria-label', got ? pg.name : 'an unwritten page');
      });
      if (newest) newest.classList.add('newest');
    }
    /* the Book's one-line summary */
    {
      const rib = c.ribbons().length, nextR = CC.RIBBONS.find(r => r.at > c.totalAllTime);
      const eta = nextR ? CC.fmtTime((nextR.at - c.totalAllTime) / Math.max(c.cps(), 1e-9)) : 'complete';
      const sum = `${rib}/${CC.RIBBONS.length} · ${c.almanacCount()}/${CC.ALMANAC.length} — ${this.fmtX(c.ribbonMult() * c.almanacMult())} · next ribbon ${eta}`;
      if (sum !== this._bookSum) { this._bookSum = sum; this.$('book-summary').textContent = sum; }
    }

    /* stats (re-rendered only when the text actually changes) */
    {
      const totalBuildings = c.owned.reduce((a, b) => a + b, 0);
      const bumpers = c.bumperTotal();
      const html =
        `<div class="stat-h">HARVEST</div>` +
        `<div>Lifetime harvest <b>${CC.fmtHtml(c.totalAllTime)}</b></div>` +
        `<div>This spring <b>${CC.fmtHtml(c.totalRun)}</b></div>` +
        `<div>Hand-pulled (clicks) <b>${CC.fmtHtml(c.clicks)}</b></div>` +
        `<div>Plots &amp; contraptions <b>${CC.fmtHtml(totalBuildings)}</b></div>` +
        `<div class="stat-h">THE WORLD</div>` +
        `<div>${CC.icon('spring')} Springs on record <b>${CC.fmtHtml(c.prestiges)}</b></div>` +
        `<div>${CC.icon('rabbit')} Rabbits caught <b>${CC.fmtHtml(c.rabbits)}</b></div>` +
        `<div>${CC.icon('wheat')} Bumper crops <b>${bumpers} (+${Math.round((Math.pow(CC.MILESTONE_MULT, bumpers) - 1) * 100)}%)</b></div>` +
        `<div>Production bonus <b>${this.fmtX(c.globalMult())}${c.buffMult() > 1 ? ` · ${this.fmtX(c.buffMult())} buffs` : ''}${c.seasonMult() > 1 ? ` · ${this.fmtX(c.seasonMult())} season` : ''}${c.handsBonus > 1 ? ` · ${this.fmtX(c.handsBonus)} hands` : ''}</b></div>` +
        `<div class="stat-sub">seeds ${this.fmtX(c.seedMult())} · ribbons ${this.fmtX(c.ribbonMult())} · rest ${this.fmtX(c.globalMult() / (c.seedMult() * c.ribbonMult()))}</div>` +
        (c.honey > 0 ? `<div>${CC.icon('honey')} Honey in the jar <b>${CC.fmtHtml(c.honey)}</b></div>` : '') +
        (c.bedMult() !== 1 ? `<div>${CC.icon('pl-ready')} The bed <b>${this.fmtX(c.bedMult())}</b></div>` : '') +
        (c.fallows > 0 || c.loam > 0 ? `<div>${CC.icon('bell')} Fallow Years <b>${c.fallows}</b></div><div>${CC.icon('loam')} Loam in the cellar <b>${CC.fmtHtml(c.loam)}</b></div>` : '') +
        (() => { /* Trials (R22): the ledger and what it paid */
          const done = (CC.TRIALS || []).reduce((a, t) => a + c.trialDone(t.id), 0);
          if (!done) return '';
          const p = c.perks, bits = [];
          if (p.scarecrow) bits.push(`Scarecrow ${p.scarecrow}`);
          if (p.startTier) bits.push(`tier-${p.startTier} start`);
          if (p.resproutCap) bits.push(`resprout +${p.resproutCap}`);
          for (const k in p.cap) { const u = CC.SHED.find(x => x.id === k); bits.push(`${u ? u.name : k} cap +${p.cap[k]}`); }
          if (p.longEars) bits.push(`Long Ears ${p.longEars}`);
          if (p.clickFrenzy) bits.push(`Click Frenzy ${p.clickFrenzy}`);
          return `<div>${CC.icon('trial')} Trials won <b>${done}</b></div>` +
            (bits.length ? `<div class="stat-sub">${bits.join(' · ')}</div>` : '');
        })() +
        `<div class="stat-h">NEXT</div>` +
        (() => { const rem = c.nextSeedAt() - c.totalAllTime; return `<div>Next seed in <b>${rem > 4 * c.totalAllTime * Number.EPSILON ? CC.fmtHtml(rem) : 'now'} ${CC.icon('carrot')}</b></div>`; })() +
        (() => { /* the tail must never fade into fog: name the next rung */
          const r = CC.RIBBONS.find(r => r.at > c.totalAllTime);
          return r ? `<div>Next ribbon in <b>${CC.fmtHtml(r.at - c.totalAllTime)} ${CC.icon('carrot')}</b></div>`
            : `<div>Trophy shelf <b>complete ${CC.icon('rosette')}</b></div>`;
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
    const x = this.ctx, W = this.W, H = this.H;
    x.drawImage(this.bg, 0, 0, W, H);
    if (this.crossT > 0 && this.bgOld) { x.globalAlpha = Math.min(1, this.crossT / 1.2); x.drawImage(this.bgOld, 0, 0, W, H); x.globalAlpha = 1; }
    const c = this.core;
    const pal = this._pal || CC.THEMES['homestead-day'];

    /* weather as a layer (brief P12): frenzy = warm vignette + slow rays;
       rain = a cool wash; embargo = a fog band; a celebration glows */
    const frenzy = c.buffs.some(b => b.mult >= 7), raining = c.buffs.some(b => CC.WEATHER.some(w => w.name === b.name));
    const embargo = c.buffs.some(b => b.mult < 1);
    const still = CC.motion !== 'full';
    if (frenzy) {
      x.save(); x.translate(W / 2, this.soilY - 40); x.rotate(still ? 0 : this.t * 0.25);
      x.fillStyle = 'rgba(255,200,80,0.10)';
      for (let k = 0; k < 8; k++) { x.rotate(Math.PI / 4); x.beginPath(); x.moveTo(0, 0); x.lineTo(260, -30); x.lineTo(260, 30); x.closePath(); x.fill(); }
      x.restore();
      const vg = x.createRadialGradient(W / 2, this.soilY - 40, 60, W / 2, this.soilY - 40, 260);
      vg.addColorStop(0, 'rgba(255,150,40,0)'); vg.addColorStop(1, `rgba(255,120,20,${0.18 + (still ? 0 : Math.sin(this.t * 6) * 0.05)})`);
      x.fillStyle = vg; x.fillRect(0, 0, W, H);
    } else if (raining) {
      x.fillStyle = `rgba(110,150,200,${0.06 + (still ? 0 : Math.sin(this.t * 3) * 0.02)})`;
      x.fillRect(0, 0, W, H);
    }
    if (embargo) { x.fillStyle = 'rgba(120,120,110,0.22)'; x.fillRect(0, this.soilY - 60, W, 46); }
    if (this.glow > 0) { x.fillStyle = `rgba(255,220,120,${Math.min(0.25, this.glow * 0.12)})`; x.fillRect(0, 0, W, H); }

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
    const bodyLen = 76 * size, girth = 24 * size;
    const sq = 1 - this.squash * 0.12;
    /* the hero carrot v2 (brief P10): five stage silhouettes from the
       sheet, fronds that sway and lean toward the hand, a tug on the pull */
    const stage = Math.min(4, Math.floor((size - 0.55) / 1.25 * 5));
    const heroId = 'hero' + Math.max(0, stage);
    const artPal = CC.ART.palette(pal, !!pal.stars);
    if (CC.ART.parts(heroId).length) {
      const streak = (this.clickTimes || []).filter(t => this.t - t < 1).length;
      const swayAmp = still ? 0 : 6 + Math.min(8, streak);
      const lean = (this.leanX || 0) * 6;
      const flick = !still && Math.sin(this.t * 0.37) > 0.995 ? 4 : 0;
      let fi = 0;
      x.save();
      x.translate(cx, this.soilY);
      x.scale(2 - sq, sq);
      x.translate(-cx, -this.soilY);
      CC.ART.draw(x, heroId, 0, 0, 320, artPal, {
        part: (p, i) => {
          if (!/frond/.test(p.cls)) return null;
          const k = fi++;
          const dx = Math.sin(this.t * 1.7 + k * 1.3) * swayAmp * 0.5 + lean + flick * (k % 2 ? 1 : -1);
          return typeof DOMMatrix !== 'undefined' ? new DOMMatrix().translate(dx, 0) : null;
        },
      });
      /* A Tiny Hat (R25): perched on the fronds, swaying with them */
      if (c.charmCount && c.charmCount('tophat')) {
        const hatY = this.soilY - [66, 84, 100, 116, 130][stage] * (0.8 + size * 0.2);
        const hx = cx + Math.sin(this.t * 1.7) * swayAmp * 0.4 + lean;
        x.save(); x.translate(hx, hatY); x.rotate(-0.14);
        if (!CC.ART.draw(x, 'tophat', -14, -20, 28, artPal)) {
          x.fillStyle = '#2a2218'; x.fillRect(-13, -4, 26, 4); x.fillRect(-8, -20, 16, 16);
          x.fillStyle = '#c8452c'; x.fillRect(-8, -8, 16, 4);
        }
        x.restore();
      }
      x.restore();
    } else {
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
    }

    /* ambient life: fireflies, butterflies, bees, one bird */
    for (const a of (this.ambient || [])) {
      if (a.kind === 'firefly') { x.fillStyle = `rgba(255,240,150,${0.4 + Math.sin(this.t * 4 + a.ph) * 0.4})`; x.beginPath(); x.arc(a.x, a.y, 1.8, 0, Math.PI * 2); x.fill(); }
      else if (a.kind === 'bird') { x.strokeStyle = 'rgba(40,26,12,0.6)'; x.lineWidth = 1.5; const f = Math.sin(this.t * 10) * 3; x.beginPath(); x.moveTo(a.x - 6, a.y + f); x.lineTo(a.x, a.y); x.lineTo(a.x + 6, a.y + f); x.stroke(); }
      else if (a.kind === 'cat') {
        x.save(); x.translate(a.x, a.y + Math.abs(Math.sin(this.t * 6 + a.ph)) * 1.5);
        if (a.vx < 0) x.scale(-1, 1);
        if (!CC.ART.draw(x, 'cat', -13, -20, 26, CC.ART.palette(this._pal, !!(this._pal && this._pal.stars)))) {
          x.fillStyle = '#3a3230'; x.beginPath(); x.ellipse(0, -6, 10, 5, 0, 0, Math.PI * 2); x.arc(9, -10, 4.5, 0, Math.PI * 2); x.fill();
          x.beginPath(); x.moveTo(6, -13); x.lineTo(7.5, -17); x.lineTo(9, -13); x.moveTo(9, -13); x.lineTo(10.5, -17); x.lineTo(12, -13); x.fill();
          x.strokeStyle = '#3a3230'; x.lineWidth = 2; x.beginPath(); x.moveTo(-9, -8); x.quadraticCurveTo(-15, -12 + Math.sin(this.t * 3) * 3, -14, -18); x.stroke();
        }
        x.restore();
      }
      else {
        const bee = a.kind === 'bee', wr = 2 + Math.abs(Math.sin(this.t * 18 + a.ph)) * 2.5; /* a flap from 2 to 4.5 — never a negative radius */
        x.fillStyle = bee ? '#e7b23a' : (a.ph % 2 > 1 ? '#f2b33d' : '#e89cb0'); x.strokeStyle = 'rgba(40,26,12,0.6)'; x.lineWidth = 1;
        x.beginPath(); x.ellipse(a.x - 3, a.y, 4, wr, -0.4, 0, Math.PI * 2); x.ellipse(a.x + 3, a.y, 4, wr, 0.4, 0, Math.PI * 2); x.fill(); x.stroke();
        if (bee) { x.fillStyle = '#2a2218'; x.fillRect(a.x - 1, a.y - 1, 2, 2); }
      }
    }
    /* the visitor (R19): golden rabbit, its tin impostor, or the stall */
    if (this.visitor && !this.visitor.gone) {
      const r = this.visitor;
      x.save();
      const spriteId = r.kind === 'parsnip' ? 'parsnip' : r.kind === 'tin' ? 'rabbit-tin' : 'rabbit';
      if (CC.ART.parts(spriteId).length) {
        /* visitors with a tell (brief P11): squash-stretch hop, a ground
           shadow, a dashed gold halo; the tin rabbit hops stiffer */
        const tin = r.kind === 'tin', man = r.kind === 'parsnip';
        const ph = still ? 0.5 : Math.abs(Math.sin(this.t * (tin ? 6.2 : 8)));
        const hop = man ? 0 : -ph * (tin ? 6 : 9);
        const sqz = man ? 1 : 1 + (ph - 0.5) * 0.2;
        x.translate(r.x, r.y + hop);
        if (r.dir === -1) x.scale(-1, 1);
        x.fillStyle = 'rgba(0,0,0,0.25)'; x.beginPath(); x.ellipse(0, 14 - hop, 18 * (1 + ph * 0.2), 4, 0, 0, Math.PI * 2); x.fill();
        x.setLineDash([4, 4]); x.lineDashOffset = still ? 0 : -this.t * 14; x.strokeStyle = 'rgba(255,210,120,0.85)'; x.lineWidth = 2;
        x.beginPath(); x.arc(0, man ? -22 : -6, man ? 36 : 30, 0, Math.PI * 2); x.stroke(); x.setLineDash([]); x.lineDashOffset = 0;
        x.scale(1 / sqz, sqz);
        if (man) CC.ART.draw(x, 'parsnip', -20, -58, 40, artPal);
        else CC.ART.draw(x, spriteId, -24, -26, 48, artPal);
      } else if (r.kind === 'parsnip') {
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
    if (raining) {
      x.strokeStyle = pal.rain || 'rgba(180,210,240,0.34)';
      x.lineWidth = 1.2;
      const n = still ? 14 : 42, tt = still ? 0 : this.t;
      for (let i = 0; i < n; i++) { /* rain falls to the soil line and ticks there */
        const rx = ((i * 89 + tt * 130 * (1 + (i % 3) * 0.15)) % (W + 30)) - 15;
        const ry = (i * 53 + tt * 340) % (this.soilY + 6);
        x.beginPath(); x.moveTo(rx, ry); x.lineTo(rx + 2.5, ry + 9); x.stroke();
        if (ry > this.soilY - 6) { x.beginPath(); x.arc(rx + 3, this.soilY + 4, 2, Math.PI, 0); x.stroke(); }
      }
    }
    if (this.wetUntil > this.t) { /* the wet band on the soil, fading after the rain */
      x.fillStyle = `rgba(60,40,20,${0.25 * Math.min(1, (this.wetUntil - this.t) / 6)})`; x.fillRect(0, this.soilY, W, 10);
    }

    /* particles */
    for (const p of this.particles) {
      x.globalAlpha = Math.min(1, p.life * 2);
      x.fillStyle = p.col;
      x.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    x.globalAlpha = 1;

    /* ripples: the hand on the soil */
    for (const r of (this.ripples || [])) {
      x.globalAlpha = 0.5 * (1 - r.t / 0.45);
      x.strokeStyle = pal.tops; x.lineWidth = 2;
      x.beginPath(); x.arc(r.x, r.y, 6 + r.t / 0.45 * 22, 0, Math.PI * 2); x.stroke();
    }
    x.globalAlpha = 1;
    /* floating +N — stroked, so it reads on every sky (brief P6) */
    x.font = 'bold 15px system-ui, sans-serif';
    x.textAlign = 'center';
    x.lineJoin = 'round';
    for (const f of this.floats) {
      x.globalAlpha = Math.min(1, f.life * 1.6);
      x.lineWidth = 3; x.strokeStyle = '#3b2b16';
      x.strokeText(f.text, f.x, f.y);
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
    const tab = params.get('tab'); /* mobile shell dev: open a tab */
    if (tab) game.setTab(tab);
    const vis = params.get('visitor'); /* dev garden: summon a visitor now (R19) */
    if (vis && !game.worldMode && CC.VISITORS.some(v => v.id === vis)) {
      game.spawnVisitor(vis, CC.VISITORS.find(v => v.id === vis).ttl);
      game.visitor.x = 120; /* mid-patch, ready for sprite work */
    }
  });
}
