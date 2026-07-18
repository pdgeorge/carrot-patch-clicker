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
    } else {
      this.$('tender-sign').classList.add('hidden');
      this.$('tender-list').innerHTML =
        '<div class="board-empty">The world signs here — this is the dev garden.</div>';
    }

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
      this.$('patch-line').textContent =
        `🌍 ${this.patch.online} tender${this.patch.online === 1 ? '' : 's'} tending · ${CC.fmt(this.patch.clickRate)} clicks/s worldwide`;
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
      .then(j => this.renderTenders(j.tenders || []))
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
      if (e.target.dataset.n) {
        this.buyN = +e.target.dataset.n;
        for (const b of this.$('buy-amount').children) b.classList.toggle('on', +b.dataset.n === this.buyN);
      }
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
    if (this.worldMode) {
      /* intent only — the next snapshot carries the world's answer */
      if (this.core.bank >= this.core.costOf(i, n)) CC.audio.thunk();
      this.patch.send({ type: 'buy', b: i, n });
      return;
    }
    /* all-or-nothing, exactly like the ×N price on the row (audit f9) */
    if (this.core.buy(i, n)) CC.audio.thunk();
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
    const yes = this.$('modal-yes');
    yes.textContent = `Go to seed (+${CC.fmt(n)})`;
    yes.onclick = () => {
      this.$('modal').classList.add('hidden');
      if (patch) {
        this.patch.send({ type: 'prestige' });
        return; /* the server announces it to the world */
      }
      const before = this.core.seedMult();
      const gained = this.core.prestige();
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
      this.toast(`🌸 SOMEONE SENT THE WHOLE GARDEN TO SEED. +${CC.fmt(ev.gained)} seeds ` +
        `— ${what}. A new spring begins.`);
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
    if (!what) {
      tip.classList.add('hidden');
      return;
    }
    if (what.kind === 'building') {
      const b = CC.BUILDINGS[what.i], core = this.core;
      const each = b.cps * core.buildingMult(what.i) * core.globalMult();
      const owned = core.owned[what.i];
      const next = core.nextBumperAt(what.i);
      tip.innerHTML = `<b>${b.name}</b> — ${CC.fmt(Math.ceil(core.costOf(what.i, this.buyN)))} 🥕` +
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
      let w = CC.VISITORS.reduce((s, v) => s + v.weight, 0) * Math.random();
      const pick = CC.VISITORS.find(v => (w -= v.weight) < 0) || CC.VISITORS[0];
      this.spawnVisitor(pick.id, pick.ttl);
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
    this.$('bank').textContent = CC.fmt(Math.floor(c.bank));
    this.$('cps').textContent = `${CC.fmt(c.cps())} per second · click for ${CC.fmt(c.clickPower())}`;

    const buff = c.buffs[0];
    this.$('buff-line').textContent = buff ? `⚡ ${buff.name} ×${buff.mult} — ${Math.ceil(buff.left)}s` : '';

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
        row.classList.toggle('hidden', !known && !isNextMystery);
        row.classList.toggle('mystery', isNextMystery);
        const cost = c.costOf(i, this.buyN);
        row.classList.toggle('cant', isNextMystery || c.bank < cost);
        const next = c.nextBumperAt(i);
        row.querySelector('.b-name').textContent = isNextMystery ? '???' : b.name;
        /* ceil the label: fractional prices (1.15^n, Market discounts) must
           never display cheaper than they charge */
        row.querySelector('.b-cost').textContent = isNextMystery ? ''
          : `${CC.fmt(Math.ceil(cost))} 🥕${this.buyN > 1 ? ` ×${this.buyN}` : ''}` +
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
        `<div>Production bonus <b>${this.fmtX(c.globalMult())}${c.buffMult() > 1 ? ` · ⚡${this.fmtX(c.buffMult())}` : ''}${c.seasonMult() > 1 ? ` · 🎪${this.fmtX(c.seasonMult())}` : ''}</b></div>` +
        `<div class="stat-sub">seeds ${this.fmtX(c.seedMult())} · ribbons ${this.fmtX(c.ribbonMult())} · rest ${this.fmtX(c.globalMult() / (c.seedMult() * c.ribbonMult()))}</div>` +
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
