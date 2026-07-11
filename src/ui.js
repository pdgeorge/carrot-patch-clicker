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
    this.rabbit = null;
    this.nextRabbit = 40 + Math.random() * 60;
    this.tickerT = 0;
    this._upgSig = null; this._shopSig = null;
    this._wipeArm = 0;

    this.store = (() => {
      try {
        localStorage.setItem('__cc_t', '1'); localStorage.removeItem('__cc_t');
        return localStorage;
      } catch (e) { return null; }
    })();

    /* served page = the world game, always; file:// = private dev garden (P6) */
    this.worldMode = location.protocol.startsWith('http');

    this.buildStatic();
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
    /* pre-render soil texture */
    const c = document.createElement('canvas');
    c.width = this.canvas.width; c.height = this.canvas.height;
    const x = c.getContext('2d');
    const soilY = 132;
    const sky = x.createLinearGradient(0, 0, 0, soilY);
    sky.addColorStop(0, '#5a4a7a');
    sky.addColorStop(0.7, '#c98a5a');
    sky.addColorStop(1, '#e8b06a');
    x.fillStyle = sky;
    x.fillRect(0, 0, c.width, soilY);
    /* sun */
    const sun = x.createRadialGradient(250, 60, 0, 250, 60, 60);
    sun.addColorStop(0, 'rgba(255,240,190,0.95)');
    sun.addColorStop(1, 'rgba(255,220,120,0)');
    x.fillStyle = sun;
    x.fillRect(180, 0, 140, 130);
    /* hedge */
    x.fillStyle = '#31502e';
    x.fillRect(0, soilY - 16, c.width, 16);
    const soil = x.createLinearGradient(0, soilY, 0, c.height);
    soil.addColorStop(0, '#4a3421');
    soil.addColorStop(1, '#2a2016');
    x.fillStyle = soil;
    x.fillRect(0, soilY, c.width, c.height - soilY);
    for (let i = 0; i < 900; i++) {
      const px = Math.random() * c.width, py = soilY + Math.random() * (c.height - soilY);
      x.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.15)' : 'rgba(190,150,100,0.08)';
      x.fillRect(px, py, 1.5 + Math.random() * 2, 1.5 + Math.random() * 2);
    }
    this.bg = c;
    this.soilY = soilY;

    /* shop rows */
    const shop = this.$('shop');
    this.rows = CC.BUILDINGS.map((b, i) => {
      const row = document.createElement('div');
      row.className = 'b-row';
      row.innerHTML = `<div><div class="b-name"></div><div class="b-cost"></div></div><div class="b-count"></div>`;
      row.addEventListener('click', e => this.buyBuilding(i, e.shiftKey ? 10 : this.buyN));
      row.addEventListener('mouseenter', () => this.tooltip({ kind: 'building', i }));
      row.addEventListener('mouseleave', () => this.tooltip(null));
      shop.appendChild(row);
      return row;
    });

    /* ribbon shelf */
    const shelf = this.$('ribbons');
    this.ribbonEls = CC.RIBBONS.map(r => {
      const el = document.createElement('div');
      el.className = 'ribbon locked';
      el.style.background = r.color;
      el.addEventListener('mouseenter', () => this.tooltip({ kind: 'ribbon', r }));
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
      if (this.rabbit && Math.hypot(mx - this.rabbit.x, my - this.rabbit.y) < 34) {
        this.catchRabbit();
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
    this.$('prestige-btn').addEventListener('click', () => this.askPrestige());
    this.$('prestige-btn').addEventListener('mouseenter', () => this.tooltip({ kind: 'prestige' }));
    this.$('prestige-btn').addEventListener('mouseleave', () => this.tooltip(null));
    this.$('mute-btn').addEventListener('click', () => {
      CC.audio.ensure();
      CC.audio.muted = !CC.audio.muted;
      this.$('mute-btn').textContent = CC.audio.muted ? '🔇' : '🔊';
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
      if (this.core.bank >= this.core.costOf(i, 1)) CC.audio.thunk();
      this.patch.send({ type: 'buy', b: i, n });
      return;
    }
    let bought = 0;
    while (bought < n && this.core.buy(i, 1)) bought++;
    if (bought > 0) CC.audio.thunk();
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

  catchRabbit() {
    if (this.worldMode) {
      /* worldMode, not patchOn: during a re-sync gap the solo reward path
         must never run against predicted world state */
      this.patch.send({ type: 'catch' });
      this.rabbit = null; /* server will announce who-caught-what */
      return;
    }
    const r = this.core.rabbitReward();
    this.rabbit = null;
    this.nextRabbit = this.t + 75 + Math.random() * 105;
    CC.audio.rabbit();
    this.toast(`🐇 ${r.text}`);
    this.$('ticker-text').textContent = CC.RABBIT_NEWS[Math.floor(Math.random() * CC.RABBIT_NEWS.length)];
    this.tickerT = -6;
  }

  askPrestige() {
    if (this.awaitingWorld()) return;
    const n = this.core.pendingSeeds();
    if (n < 1) return;
    const patch = this.worldMode;
    this.$('modal-title').textContent = patch ? '🌸 Send the WORLD to Seed?' : '🌸 Go to Seed?';
    this.$('modal-body').innerHTML = (patch
      ? `This is the <b>shared garden</b>. Going to seed resets it for <b>every gardener on Earth</b> —`
      : `Let go of every plot, stall, and contract. The garden resets to bare soil —`) +
      ` but ribbons are kept, and everyone gains <b>${CC.fmt(n)} seed${n > 1 ? 's' : ''}</b>.` +
      `<br><br>Each seed boosts all production by <b>+8%, forever</b>.` +
      (patch ? `<br><br><i>Your name will not be recorded. Your deed will be felt.</i>` : '');
    const yes = this.$('modal-yes');
    yes.textContent = `Go to seed (+${CC.fmt(n)})`;
    yes.onclick = () => {
      this.$('modal').classList.add('hidden');
      if (patch) {
        this.patch.send({ type: 'prestige' });
        return; /* the server announces it to the world */
      }
      const gained = this.core.prestige();
      CC.audio.seed();
      this.toast(`🌸 Second spring. +${CC.fmt(gained)} seeds — production +${gained * 8}% forever.`);
      this.save();
    };
    this.$('modal').classList.remove('hidden');
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
    } else if (ev.type === 'prestige') {
      CC.audio.seed();
      this.toast(`🌸 SOMEONE SENT THE WHOLE GARDEN TO SEED. +${CC.fmt(ev.gained)} seeds ` +
        `(+${ev.gained * 8}% forever) for everyone. A new spring begins.`);
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

  tooltip(what) {
    const tip = this.$('tooltip');
    tip.classList.remove('hidden');
    if (!what) {
      tip.innerHTML = `<span class="flavor">Click the carrot. The rest follows.</span>`;
      return;
    }
    if (what.kind === 'building') {
      const b = CC.BUILDINGS[what.i], core = this.core;
      const each = b.cps * core.buildingMult(what.i) * core.globalMult();
      const owned = core.owned[what.i];
      const next = core.nextBumperAt(what.i);
      tip.innerHTML = `<b>${b.name}</b> — ${CC.fmt(core.costOf(what.i, this.buyN))} 🥕` +
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
    } else if (what.kind === 'prestige') {
      tip.innerHTML = `<b>Go to Seed</b> — prestige reset<br>` +
        `Seeds so far: earned at √(lifetime ÷ 1M). Each seed = +8% production, permanently.` +
        `<br><span class="flavor">Every carrot next year is a little bit you.</span>`;
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

    /* golden rabbit lifecycle (locally scheduled only in the dev garden) */
    if (!this.worldMode && !this.rabbit && this.t >= this.nextRabbit) {
      this.rabbit = { x: -30, y: this.soilY - 14, dir: 1, born: this.t };
    }
    if (this.rabbit) {
      const r = this.rabbit;
      r.x += r.dir * 55 * dt;
      if (r.x > this.canvas.width - 20) r.dir = -1;
      if (r.x < 20 && r.dir === -1) r.dir = 1;
      if (this.t - r.born > (r.patchTtl || 12)) {
        this.rabbit = null;
        this.nextRabbit = this.t + 75 + Math.random() * 105;
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
    this.$('bank').textContent = CC.fmt(Math.floor(c.bank));
    this.$('cps').textContent = `${CC.fmt(c.cps())} per second · click for ${CC.fmt(c.clickPower())}`;

    const buff = c.buffs[0];
    this.$('buff-line').textContent = buff ? `⚡ ${buff.name} ×${buff.mult} — ${Math.ceil(buff.left)}s` : '';

    this.$('seed-line').textContent = c.seeds > 0
      ? `🌸 ${CC.fmt(c.seeds)} seeds — +${c.seeds * 8}% forever` : '';

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
        row.querySelector('.b-cost').textContent = isNextMystery ? ''
          : `${CC.fmt(cost)} 🥕${this.buyN > 1 ? ` ×${this.buyN}` : ''}` +
            (c.owned[i] > 0 && next ? `  ·  🌾${c.owned[i]}/${next}` : '');
        row.querySelector('.b-count').textContent = c.owned[i] || '';
      });
    }

    /* upgrades */
    const ups = c.visibleUpgrades().slice(0, 12);
    const sig = ups.map(u => u.id + (c.bank >= u.cost ? '+' : '-')).join(',');
    if (sig !== this._upgSig) {
      this._upgSig = sig;
      const box = this.$('upgrades');
      box.innerHTML = '';
      for (const u of ups) {
        const el = document.createElement('div');
        el.className = 'upgrade' + (c.bank < u.cost ? ' cant' : '');
        el.innerHTML = `<b>${u.name}</b><span class="cost">${CC.fmt(u.cost)} 🥕</span>`;
        el.addEventListener('click', () => this.buyUpgrade(u.id));
        el.addEventListener('mouseenter', () => this.tooltip({ kind: 'upgrade', u }));
        el.addEventListener('mouseleave', () => this.tooltip(null));
        box.appendChild(el);
      }
      if (!ups.length) box.innerHTML = '<span style="color:#b8a98c;font-size:12px">Nothing on the shelf right now — keep growing.</span>';
    }

    /* ribbons */
    CC.RIBBONS.forEach((r, i) => this.ribbonEls[i].classList.toggle('locked', c.totalAllTime < r.at));

    /* stats (re-rendered only when the text actually changes) */
    {
      const totalBuildings = c.owned.reduce((a, b) => a + b, 0);
      const bumpers = c.bumperTotal();
      const html =
        `<div>Lifetime harvest <b>${CC.fmt(c.totalAllTime)}</b></div>` +
        `<div>This spring <b>${CC.fmt(c.totalRun)}</b></div>` +
        `<div>Hand-pulled (clicks) <b>${CC.fmt(c.clicks)}</b></div>` +
        `<div>Plots &amp; contraptions <b>${CC.fmt(totalBuildings)}</b></div>` +
        `<div>Bumper crops 🌾 <b>${bumpers} (+${Math.round((Math.pow(CC.MILESTONE_MULT, bumpers) - 1) * 100)}%)</b></div>` +
        `<div>Production bonus <b>×${c.globalMult().toFixed(2)}</b></div>` +
        `<div>Next seed at <b>${CC.fmt(Math.pow(c.seedsEarnedTotal() + 1, 2) * 1e6)}</b></div>`;
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

    /* frenzy glow */
    if (c.buffMult() > 1) {
      x.fillStyle = `rgba(255,150,40,${0.08 + Math.sin(this.t * 6) * 0.05})`;
      x.fillRect(0, 0, W, H);
    }

    /* the carrot: grows with lifetime harvest */
    const size = 0.55 + Math.min(1.35, Math.log10(1 + c.totalAllTime) * 0.11);
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
      x.strokeStyle = '#3f9142';
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
    grad.addColorStop(0, '#ff9232');
    grad.addColorStop(1, '#d4570a');
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

    /* golden rabbit */
    if (this.rabbit) {
      const r = this.rabbit;
      const hop = -Math.abs(Math.sin(this.t * 8)) * 9;
      x.save();
      x.translate(r.x, r.y + hop);
      if (r.dir === -1) x.scale(-1, 1);
      const glow = x.createRadialGradient(0, 0, 0, 0, 0, 30);
      glow.addColorStop(0, 'rgba(255,215,90,0.55)');
      glow.addColorStop(1, 'rgba(255,215,90,0)');
      x.fillStyle = glow;
      x.beginPath(); x.arc(0, 0, 30, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#e8c25a';
      x.beginPath(); x.ellipse(0, 0, 14, 9, 0, 0, Math.PI * 2); x.fill();
      x.beginPath(); x.ellipse(12, -5, 7, 6, 0, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#d4a83a';
      x.beginPath(); x.ellipse(10, -14, 2.2, 7, -0.15, 0, Math.PI * 2); x.fill();
      x.beginPath(); x.ellipse(14, -13.5, 2.2, 6.5, 0.2, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#fff8e0';
      x.beginPath(); x.arc(-13, -1, 3.5, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#2a221a';
      x.beginPath(); x.arc(13.5, -6, 1.1, 0, Math.PI * 2); x.fill();
      x.restore();
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
    const grant = new URLSearchParams(location.search).get('grant');
    if (grant) game.core.earn(+grant); /* debug/testing */
  });
}
