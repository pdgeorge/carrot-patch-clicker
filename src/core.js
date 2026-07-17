/* Carrot Clicker — pure game core: economy, upgrades, buffs, prestige, save.
   No DOM access; fully drivable headless (see clicker/test/sim.js). */
globalThis.CC = globalThis.CC || {};

CC.fmt = function (n) {
  if (!isFinite(n)) return '∞';
  if (n < 0) return '-' + CC.fmt(-n);
  if (n < 1000) return n < 10 && n % 1 !== 0 ? n.toFixed(1) : Math.floor(n).toString();
  /* Ud..Vg (R14/R17): the Fair Circuit's stretched tail reaches 1e60 —
     these units must exist before the numbers they format do */
  const units = ['k', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc',
    'Ud', 'Dd', 'Td', 'Qad', 'Qid', 'Sxd', 'Spd', 'Ocd', 'Nod', 'Vg'];
  let u = -1;
  while (n >= 1000 && u < units.length - 1) { n /= 1000; u++; }
  /* repeated /1000 drifts: 1e45 lands at 999.999…, which would print
     "1000Td" — anything that ROUNDS to 1000 belongs to the next unit */
  if (n >= 999.5 && u < units.length - 1) { n /= 1000; u++; }
  return (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)) + units[u];
};

CC.Core = class {
  constructor() {
    this.bank = 0;
    this.lifetimeBase = 0;        /* lifetime harvest banked before this run (see totalAllTime) */
    this.totalRun = 0;
    this.clicks = 0;
    this.owned = CC.BUILDINGS.map(() => 0);
    this.bought = {};             /* upgrade id -> true */
    this.seeds = 0;               /* permanent: +8% each, never spent */
    this.sprouts = 0;             /* spendable twin: minted 1:1 with seeds (R13) */
    this.shed = {};               /* Potting Shed item id -> level (R15); survives prestige */
    this.prestiges = 0;           /* world counters (R15): deeds since records began */
    this.rabbits = 0;
    this.sproutsSpent = 0;
    this.almanac = {};            /* Almanac page id -> true; latches forever (R16) */
    this.mirrorBook = false;      /* world mode: the server's almanac is the book —
                                     a mirroring client must never latch its own */
    this.season = 'homestead';    /* R17: server-owned; the dev garden stays homestead */
    this.buffs = [];              /* {name, mult, left} */
    this.t = 0;
    this._ribbonCount = 0;
    this._bumperSeen = CC.BUILDINGS.map(() => 0);
  }

  /* Lifetime harvest = base (folded in at prestige) + this run's total, so
     earning always accumulates at run magnitude: at 3e22 lifetime a double's
     ulp is ~4M carrots and a naive `+=` silently drops clicks and small
     ticks (and freezes entirely past 2^75). Reads still round to one ulp of
     the sum — a display grain, never lost carrots. Mirrored in economy.py. */
  get totalAllTime() { return this.lifetimeBase + this.totalRun; }
  set totalAllTime(v) { this.lifetimeBase = v - this.totalRun; }

  /* ---------- upgrades ---------- */
  buildingUpgrades(i) {
    const b = CC.BUILDINGS[i];
    return CC.TIERS.map((t, ti) => ({
      id: `b${i}t${ti}`,
      type: 'building', b: i, need: t.need,
      cost: b.cost * t.costMult,
      name: t.prefix ? `${t.prefix} ${b.name}` : b.upName,
      flavor: t.prefix ? `${b.name} output doubled. Again. Nobody questions it anymore.` : b.upFlavor,
    }));
  }

  allUpgrades() {
    if (!this._upgrades) {
      this._upgrades = [];
      CC.BUILDINGS.forEach((b, i) => this._upgrades.push(...this.buildingUpgrades(i)));
      for (const u of CC.CLICK_UPGRADES) this._upgrades.push({ ...u, type: 'click' });
      for (const u of CC.GLOBAL_UPGRADES) this._upgrades.push({ ...u, type: 'global' });
      for (const u of CC.SYNERGY_UPGRADES) this._upgrades.push({ ...u, type: 'synergy' });
    }
    return this._upgrades;
  }

  /* Declarative unlock conditions (DESIGN R8/P7): `unlock: [...]` on any
     data-defined upgrade replaces its type's default visibility rule; all
     conditions must hold. Vocabulary (mirrored in carrot_patch/economy.py):
       { owned: i, n: N }   own ≥ N of building index i
       { lifetime: N }      lifetime harvest ≥ N
       { seeds: N }         seeds ≥ N
       { clicks: N }        lifetime clicks ≥ N (clicks survive prestige)
       { bought: 'id' }     another upgrade already bought
       { shed: 'id' }       Potting Shed item already bought (R13)
     Unknown conditions fail closed: the upgrade stays hidden. */
  condMet(c) {
    if (c.owned !== undefined) return this.owned[c.owned] >= c.n;
    if (c.lifetime !== undefined) return this.totalAllTime >= c.lifetime;
    if (c.seeds !== undefined) return this.seeds >= c.seeds;
    if (c.clicks !== undefined) return this.clicks >= c.clicks;
    if (c.bought !== undefined) return !!this.bought[c.bought];
    if (c.shed !== undefined) return this.shedLevel(c.shed) >= 1;
    /* world counters (R15) — records begin the day counters ship */
    if (c.prestiges !== undefined) return this.prestiges >= c.prestiges;
    if (c.rabbits !== undefined) return this.rabbits >= c.rabbits;
    if (c.sproutsSpent !== undefined) return this.sproutsSpent >= c.sproutsSpent;
    if (c.shedLv !== undefined) return this.shedLevel(c.shedLv) >= (c.n || 1);
    if (c.upgradesOwned !== undefined) return Object.keys(this.bought).length >= c.upgradesOwned;
    if (c.heirloomEvery !== undefined) {
      return CC.SHED.every(u => !u.resprout || this.shedLevel(u.id) >= c.heirloomEvery);
    }
    return false;
  }

  upgradeVisible(u) {
    if (this.bought[u.id]) return false;
    if (u.unlock) return u.unlock.every(c => this.condMet(c));
    if (u.type === 'building') return this.owned[u.b] >= u.need;
    if (u.type === 'synergy') return this.owned[u.target] >= u.needTarget && this.owned[u.per] >= u.needPer;
    return this.totalAllTime >= u.cost / 4;
  }

  visibleUpgrades() {
    return this.allUpgrades().filter(u => this.upgradeVisible(u)).sort((a, b) => a.cost - b.cost);
  }

  buyUpgrade(id) {
    const u = this.allUpgrades().find(u => u.id === id);
    if (!u || this.bought[id] || this.bank < u.cost || !this.upgradeVisible(u)) return false;
    this.bank -= u.cost;
    this.bought[id] = true;
    return true;
  }

  /* ---------- production ---------- */
  buildingMult(i) {
    let m = 1;
    for (let ti = 0; ti < CC.TIERS.length; ti++) if (this.bought[`b${i}t${ti}`]) m *= 2;
    for (const u of CC.SYNERGY_UPGRADES) {
      if (u.target === i && this.bought[u.id]) m *= 1 + u.pct * this.owned[u.per];
    }
    for (const u of CC.SHED) {
      if (u.building === i && u.bmult) m *= Math.pow(u.bmult, this.shedLevel(u.id));
    }
    return m;
  }

  /* bumper crops: +1% global per owned-count milestone, per building type */
  bumperCount(i) {
    let n = 0;
    for (const at of CC.MILESTONES) if (this.owned[i] >= at) n++;
    return n;
  }
  bumperTotal() {
    let n = 0;
    for (let i = 0; i < CC.BUILDINGS.length; i++) n += this.bumperCount(i);
    return n;
  }
  nextBumperAt(i) {
    for (const at of CC.MILESTONES) if (this.owned[i] < at) return at;
    return null;
  }

  ribbons() { return CC.RIBBONS.filter(r => this.totalAllTime >= r.at); }

  seedMult() { return 1 + 0.08 * this.seeds; }

  ribbonMult() {
    let m = 1;
    for (const r of this.ribbons()) m *= r.mult;
    return m;
  }

  almanacCount() { return Object.keys(this.almanac).length; }
  almanacMult() { return Math.pow(CC.ALMANAC_MULT, this.almanacCount()); }

  globalMult() {
    let m = this.seedMult() * this.ribbonMult();
    for (const u of CC.GLOBAL_UPGRADES) if (this.bought[u.id]) m *= u.mult;
    for (const u of CC.SHED) if (u.mult) m *= Math.pow(u.mult, this.shedLevel(u.id));
    m *= this.almanacMult();
    m *= Math.pow(CC.MILESTONE_MULT, this.bumperTotal());
    return m;
  }

  buffMult() {
    let m = 1;
    for (const b of this.buffs) m *= b.mult;
    return m;
  }

  /* seasons (R17): time-boxed world modifiers; unknown ids are homestead */
  seasonData() { return CC.SEASONS.find(s => s.id === this.season) || null; }
  seasonMult() { const s = this.seasonData(); return (s && s.mult) || 1; }

  baseCps() {
    let c = 0;
    for (let i = 0; i < CC.BUILDINGS.length; i++) {
      c += this.owned[i] * CC.BUILDINGS[i].cps * this.buildingMult(i);
    }
    return c * this.globalMult();
  }

  cps() { return this.baseCps() * this.buffMult() * this.seasonMult(); }

  clickPower() {
    let base = 1, pct = 0;
    for (const u of CC.CLICK_UPGRADES) {
      if (!this.bought[u.id]) continue;
      if (u.mult) base *= u.mult;
      if (u.cpsPct) pct += u.cpsPct;
    }
    for (const u of CC.SHED) if (u.cpsPct) pct += u.cpsPct * this.shedLevel(u.id);
    return (base + pct * this.baseCps()) * this.buffMult() * this.seasonMult();
  }

  /* ---------- actions ---------- */
  earn(n) { this.bank += n; this.totalRun += n; /* lifetime = base + run */ }

  click() {
    const g = this.clickPower();
    this.earn(g);
    this.clicks++;
    return g;
  }

  costOf(i, count = 1) {
    /* geometric sum: cost * 1.15^owned * (1.15^count - 1) / 0.15,
       discounted while a priceOff season runs (R17) */
    const r = 1.15, c0 = CC.BUILDINGS[i].cost * Math.pow(r, this.owned[i]);
    const s = this.seasonData();
    return c0 * (Math.pow(r, count) - 1) / (r - 1) * (1 - ((s && s.priceOff) || 0));
  }

  buy(i, count = 1) {
    const cost = this.costOf(i, count);
    if (this.bank < cost) return false;
    this.bank -= cost;
    this.owned[i] += count;
    return true;
  }

  /* ---------- the Potting Shed (R13/R15) ---------- */
  /* Levels: a one-shot item goes 0→1; a `repeat` item climbs forever (or to
     `max`) at ceil(cost·costGrowth^level) sprouts. Pre-R15 saves stored
     `true`, which reads as level 1 — never rewrite the map, just read it. */
  shedLevel(id) {
    const v = this.shed[id];
    return v === true ? 1 : (v || 0);
  }

  shedCost(id) {
    const u = CC.SHED.find(u => u.id === id);
    if (!u) return Infinity;
    return u.repeat ? Math.ceil(u.cost * Math.pow(u.costGrowth, this.shedLevel(id))) : u.cost;
  }

  shedMaxed(u) {
    const lv = this.shedLevel(u.id);
    return u.repeat ? (u.max !== undefined && lv >= u.max) : lv >= 1;
  }

  shedVisible(u) {
    if (u.unlock) return u.unlock.every(c => this.condMet(c));
    return true;
  }

  /* sprouts minted per seed at prestige: doublers stack (R15) */
  mintMult() {
    let m = 1;
    for (const u of CC.SHED) if (u.mintMult) m *= Math.pow(u.mintMult, this.shedLevel(u.id));
    return m;
  }

  buyShed(id) {
    const u = CC.SHED.find(u => u.id === id);
    if (!u || this.shedMaxed(u) || !this.shedVisible(u)) return false;
    const cost = this.shedCost(id);
    if (this.sprouts < cost) return false;
    this.sprouts -= cost;
    this.sproutsSpent += cost;
    this.shed[id] = this.shedLevel(id) + 1;
    return true;
  }

  /* ---------- golden rabbit ---------- */
  rabbitReward(rng = Math.random) {
    this.rabbits++;
    if (rng() < 0.55) {
      this.buffs.push({ name: 'Rabbit Frenzy', mult: 7, left: 30 });
      return { kind: 'frenzy', text: 'RABBIT FRENZY! Production ×7 for 30 seconds!' };
    }
    const gain = Math.max(this.clickPower() * 20, Math.min(this.bank * 0.15, this.cps() * 600) + this.cps() * 60);
    this.earn(gain);
    return { kind: 'lucky', gain, text: `Lucky bundle! +${CC.fmt(gain)} carrots!` };
  }

  /* ---------- prestige ---------- */
  seedsEarnedTotal() { return Math.floor(Math.sqrt(this.totalAllTime / 1e6)); }
  pendingSeeds() { return Math.max(0, this.seedsEarnedTotal() - this.seeds); }
  nextSeedAt() { return Math.pow(this.seedsEarnedTotal() + 1, 2) * 1e6; }

  prestige() {
    const gain = this.pendingSeeds();
    if (gain < 1) return 0;
    /* a deed done in the dying second of a spring still counts (review F3) */
    if (!this.mirrorBook) this.latchPages();
    this.seeds += gain;
    this.sprouts += gain * this.mintMult(); /* every seed sprouts (R13); doublers stack (R15) */
    this.prestiges++;
    this.bank = 0;
    this.lifetimeBase += this.totalRun; /* fold the run before resetting it */
    this.totalRun = 0;
    this.owned = CC.BUILDINGS.map(() => 0);
    this.bought = {};
    this.buffs = [];
    /* resprout (R15): heirloom strains regrow themselves each spring */
    for (const u of CC.SHED) {
      if (u.resprout && u.building !== undefined) {
        this.owned[u.building] = Math.min(this.shedLevel(u.id), 100);
      }
    }
    /* pre-seed, silently: resprouted rows must not fire a bumper toast storm */
    this._bumperSeen = CC.BUILDINGS.map((_, i) => this.bumperCount(i));
    return gain;
  }

  /* ---------- tick ---------- */
  tick(dt) {
    this.t += dt;
    const events = [];
    this.earn(this.cps() * dt);
    for (const b of this.buffs) b.left -= dt;
    const expired = this.buffs.filter(b => b.left <= 0);
    this.buffs = this.buffs.filter(b => b.left > 0);
    for (const b of expired) events.push({ type: 'buffEnd', name: b.name });
    const rc = this.ribbons().length;
    if (rc > this._ribbonCount) {
      /* index, not object — same event shape as economy.py, so one UI
         renderer serves both solo events and server events (F1) */
      for (let k = this._ribbonCount; k < rc; k++) events.push({ type: 'ribbon', i: k });
      this._ribbonCount = rc;
    }
    for (let i = 0; i < CC.BUILDINGS.length; i++) {
      const n = this.bumperCount(i);
      if (n > this._bumperSeen[i]) {
        events.push({ type: 'bumper', b: i, owned: this.owned[i], at: CC.MILESTONES[n - 1] });
        this._bumperSeen[i] = n;
      }
    }
    /* Almanac pages latch the moment their deed is done — forever (R16). */
    if (!this.mirrorBook) this.latchPages(events);
    return events;
  }

  /* Run-scoped deeds (owned-this-spring…) latch too: the page records that
     it HAPPENED, and prestige cannot unwrite it. Without `events` the latch
     is silent (loads, prestige-instant deeds). */
  latchPages(events) {
    for (const pg of CC.ALMANAC) {
      if (!this.almanac[pg.id] && pg.unlock.every(c => this.condMet(c))) {
        this.almanac[pg.id] = true;
        if (events) events.push({ type: 'almanac', id: pg.id });
      }
    }
  }

  /* ---------- save / load ---------- */
  serialize() {
    return {
      v: 1, bank: this.bank, totalAllTime: this.totalAllTime, totalRun: this.totalRun,
      clicks: this.clicks, owned: this.owned, bought: this.bought, seeds: this.seeds,
      sprouts: this.sprouts, shed: this.shed,
      prestiges: this.prestiges, rabbits: this.rabbits, sproutsSpent: this.sproutsSpent,
      almanac: this.almanac,
      /* season deliberately NOT saved: the dev garden has no calendar, and a
         ?season= theme test must never persist its bonus into the solo save;
         the world's season lives in the server save (economy.py) */
      buffs: this.buffs.map(b => ({ ...b })), /* a frenzy survives a mid-buff reload */
      last: Date.now(),
    };
  }

  deserialize(s) {
    if (!s || s.v !== 1) return { offline: 0 };
    this.bank = s.bank || 0;
    this.totalRun = s.totalRun || 0;
    this.totalAllTime = s.totalAllTime || 0; /* setter derives lifetimeBase — run first */
    this.clicks = s.clicks || 0;
    this.owned = CC.BUILDINGS.map((_, i) => (s.owned && s.owned[i]) || 0);
    this.bought = s.bought || {};
    this.seeds = s.seeds || 0;
    /* pre-R13 saves earned their seeds when none were spendable: mint the
       backlog — sprouts = seeds — as the fair one-time migration */
    this.sprouts = Math.max(0, s.sprouts !== undefined ? s.sprouts : (s.seeds || 0));
    /* a save is data, not authority (review F1): unknown shed ids are
       dropped, levels forced to sane ints — a forged 1e9 "level" would
       overflow every cost/effect pow */
    this.shed = {};
    for (const u of CC.SHED) {
      const v = (s.shed || {})[u.id];
      const lv = v === true ? 1 : (Math.floor(v) || 0);
      if (lv > 0) this.shed[u.id] = Math.min(lv, u.max !== undefined ? u.max : 800);
    }
    this.prestiges = Math.max(0, Math.floor(s.prestiges) || 0);
    this.rabbits = Math.max(0, Math.floor(s.rabbits) || 0);
    this.sproutsSpent = Math.max(0, s.sproutsSpent || 0);
    /* known page ids are historical fact and stay latched; junk ids would
       mint ×1.02 each forever — dropped */
    this.almanac = {};
    for (const pg of CC.ALMANAC) if ((s.almanac || {})[pg.id]) this.almanac[pg.id] = true;
    this.season = CC.SEASONS.some(x => x.id === s.season) ? s.season : 'homestead';
    /* pages already satisfied by an older save latch silently — the load
       is not the deed, so it gets no toast storm (R16, same as ribbons) */
    this.latchPages();
    this.buffs = (s.buffs || []).map(b => ({ ...b }));
    if (s.last) { /* buffs kept ticking while the tab was closed */
      const gone = Math.max(0, (Date.now() - s.last) / 1000);
      for (const b of this.buffs) b.left -= gone;
      this.buffs = this.buffs.filter(b => b.left > 0);
    }
    this._ribbonCount = this.ribbons().length;
    this._bumperSeen = CC.BUILDINGS.map((_, i) => this.bumperCount(i));
    /* offline earnings: half rate, capped at 8 hours */
    let offline = 0;
    if (s.last) {
      const away = Math.min(Math.max(0, (Date.now() - s.last) / 1000), 8 * 3600);
      offline = this.baseCps() * away * 0.5;
      if (offline > 0) this.earn(offline);
    }
    return { offline };
  }
};
