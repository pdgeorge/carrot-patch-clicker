/* Carrot Clicker — pure game core: economy, upgrades, buffs, prestige, save.
   No DOM access; fully drivable headless (see clicker/test/sim.js). */
globalThis.CC = globalThis.CC || {};

CC.fmt = function (n) {
  if (!isFinite(n)) return '∞';
  if (n < 0) return '-' + CC.fmt(-n);
  if (n < 1000) return n < 10 && n % 1 !== 0 ? n.toFixed(1) : Math.floor(n).toString();
  const units = ['k', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
  let u = -1;
  while (n >= 1000 && u < units.length - 1) { n /= 1000; u++; }
  return (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)) + units[u];
};

CC.Core = class {
  constructor() {
    this.bank = 0;
    this.totalAllTime = 0;        /* lifetime harvest, survives prestige */
    this.totalRun = 0;
    this.clicks = 0;
    this.owned = CC.BUILDINGS.map(() => 0);
    this.bought = {};             /* upgrade id -> true */
    this.seeds = 0;
    this.buffs = [];              /* {name, mult, left} */
    this.t = 0;
    this._ribbonCount = 0;
    this._bumperSeen = CC.BUILDINGS.map(() => 0);
  }

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
     Unknown conditions fail closed: the upgrade stays hidden. */
  condMet(c) {
    if (c.owned !== undefined) return this.owned[c.owned] >= c.n;
    if (c.lifetime !== undefined) return this.totalAllTime >= c.lifetime;
    if (c.seeds !== undefined) return this.seeds >= c.seeds;
    if (c.clicks !== undefined) return this.clicks >= c.clicks;
    if (c.bought !== undefined) return !!this.bought[c.bought];
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

  globalMult() {
    let m = 1 + 0.08 * this.seeds;
    for (const r of this.ribbons()) m *= r.mult;
    for (const u of CC.GLOBAL_UPGRADES) if (this.bought[u.id]) m *= u.mult;
    m *= Math.pow(CC.MILESTONE_MULT, this.bumperTotal());
    return m;
  }

  buffMult() {
    let m = 1;
    for (const b of this.buffs) m *= b.mult;
    return m;
  }

  baseCps() {
    let c = 0;
    for (let i = 0; i < CC.BUILDINGS.length; i++) {
      c += this.owned[i] * CC.BUILDINGS[i].cps * this.buildingMult(i);
    }
    return c * this.globalMult();
  }

  cps() { return this.baseCps() * this.buffMult(); }

  clickPower() {
    let base = 1, pct = 0;
    for (const u of CC.CLICK_UPGRADES) {
      if (!this.bought[u.id]) continue;
      if (u.mult) base *= u.mult;
      if (u.cpsPct) pct += u.cpsPct;
    }
    return (base + pct * this.baseCps()) * this.buffMult();
  }

  /* ---------- actions ---------- */
  earn(n) { this.bank += n; this.totalAllTime += n; this.totalRun += n; }

  click() {
    const g = this.clickPower();
    this.earn(g);
    this.clicks++;
    return g;
  }

  costOf(i, count = 1) {
    /* geometric sum: cost * 1.15^owned * (1.15^count - 1) / 0.15 */
    const r = 1.15, c0 = CC.BUILDINGS[i].cost * Math.pow(r, this.owned[i]);
    return c0 * (Math.pow(r, count) - 1) / (r - 1);
  }

  buy(i, count = 1) {
    const cost = this.costOf(i, count);
    if (this.bank < cost) return false;
    this.bank -= cost;
    this.owned[i] += count;
    return true;
  }

  /* ---------- golden rabbit ---------- */
  rabbitReward(rng = Math.random) {
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

  prestige() {
    const gain = this.pendingSeeds();
    if (gain < 1) return 0;
    this.seeds += gain;
    this.bank = 0;
    this.totalRun = 0;
    this.owned = CC.BUILDINGS.map(() => 0);
    this.bought = {};
    this.buffs = [];
    this._bumperSeen = CC.BUILDINGS.map(() => 0);
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
      for (let k = this._ribbonCount; k < rc; k++) events.push({ type: 'ribbon', ribbon: CC.RIBBONS[k] });
      this._ribbonCount = rc;
    }
    for (let i = 0; i < CC.BUILDINGS.length; i++) {
      const n = this.bumperCount(i);
      if (n > this._bumperSeen[i]) {
        events.push({ type: 'bumper', b: i, owned: this.owned[i], at: CC.MILESTONES[n - 1] });
        this._bumperSeen[i] = n;
      }
    }
    return events;
  }

  /* ---------- save / load ---------- */
  serialize() {
    return {
      v: 1, bank: this.bank, totalAllTime: this.totalAllTime, totalRun: this.totalRun,
      clicks: this.clicks, owned: this.owned, bought: this.bought, seeds: this.seeds,
      last: Date.now(),
    };
  }

  deserialize(s) {
    if (!s || s.v !== 1) return { offline: 0 };
    this.bank = s.bank || 0;
    this.totalAllTime = s.totalAllTime || 0;
    this.totalRun = s.totalRun || 0;
    this.clicks = s.clicks || 0;
    this.owned = CC.BUILDINGS.map((_, i) => (s.owned && s.owned[i]) || 0);
    this.bought = s.bought || {};
    this.seeds = s.seeds || 0;
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
