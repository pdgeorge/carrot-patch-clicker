/* Carrot Clicker — pure game core: economy, upgrades, buffs, prestige, save.
   No DOM access; fully drivable headless (see clicker/test/sim.js). */
globalThis.CC = globalThis.CC || {};

CC.fmt = function (n) {
  if (CC.fog) return '???'; /* the Fog Trial (R22): numbers hidden, tend by feel */
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
  const num = n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2);
  /* readable numbers (R21): a display preference, never a different value —
     "Td" means nothing to a newcomer; "tredecillion" at least sounds big */
  return CC.fmtLong ? num + ' ' + CC.LONG_UNITS[u] : num + units[u];
};
CC.fmtLong = false;
CC.LONG_UNITS = ['thousand', 'million', 'billion', 'trillion', 'quadrillion', 'quintillion',
  'sextillion', 'septillion', 'octillion', 'nonillion', 'decillion', 'undecillion',
  'duodecillion', 'tredecillion', 'quattuordecillion', 'quindecillion', 'sexdecillion',
  'septendecillion', 'octodecillion', 'novemdecillion', 'vigintillion'];
/* durations for the Parish clocks: "2d 4h", "1h 22m", "45s" */
CC.fmtDur = function (s) {
  s = Math.max(0, Math.floor(s));
  if (s >= 86400) return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${s}s`;
};

/* Market Hour (R21): a weekly data-defined window. Takes a UTC epoch so
   the server, the dev garden's clock, and the tests agree to the second;
   the engine itself never reads a clock (the caller sets core.marketHour). */
CC.marketHourAt = function (epoch) {
  const m = CC.MARKET_HOUR;
  if (!m) return { active: false, next: 0, end: 0 };
  const d = new Date(epoch * 1000);
  const h = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  const weekStart = epoch - (d.getUTCDay() * 24 + h) * 3600; /* Sunday 00:00 UTC */
  let start = weekStart + (m.dow * 24 + m.startUtc) * 3600;
  let end = start + m.hours * 3600;
  if (epoch >= end) { start += 7 * 86400; end += 7 * 86400; }
  return { active: epoch >= start && epoch < end, next: start, end };
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
    this.tins = 0;                /* R19 visitor counters: clanks, gambles, rains */
    this.stalls = 0;
    this.weathers = 0;
    this.almanac = {};            /* Almanac page id -> true; latches forever (R16) */
    this.mirror = false;          /* world mode: this core only mirrors the server — no automation,
                                     no transitions, the snapshot is the truth (R22 review) */
    this.mirrorBook = false;      /* world mode: the server's almanac is the book —
                                     a mirroring client must never latch its own */
    this.season = 'homestead';    /* R17: server-owned; the dev garden stays homestead */
    this.honey = 0;               /* R21: the calendar currency, minted by events, never by cps */
    this.beeT = 0;                /* seconds toward the Bee Cooperative's next drop */
    this.handsBonus = 1;          /* R21 Many Hands: presence-boxed, server-set (transient) */
    this.marketHour = false;      /* R21: the weekly window, server-set (transient) */
    /* Trials (R22): one rule for one spring; what they paid survives everything */
    this.trial = null;            /* {id, goal, t} while a Trial spring runs */
    this.trialsDone = {};         /* id -> completions (0..CC.TRIAL.maxDone) */
    this.trialBest = {};          /* id -> fastest completion, seconds */
    this.runBest = 0;             /* the best plain spring on record — the Trial goal's memory */
    this.runT = 0;                /* seconds since this spring began */
    this.perks = CC.Core.freshPerks(); /* automation, caps, unlocks — never multipliers */
    this.haltT = 0;               /* Late Frost: seconds of stillness left after a purchase */
    this.scT = 0;                 /* Scarecrow clock */
    /* the Seed Bed (R23): the world's shared bed; the log outlives everything */
    this.bed = CC.Core.freshBed();
    this.bedT = 0;                /* seconds toward the next bed tick */
    this.sacrifices = 0;
    /* Lie Fallow (R24): the second prestige; Loam buys rules, never numbers */
    this.loam = 0;
    this.cellar = {};             /* Root Cellar perk id -> level; survives everything */
    this.fallows = 0;
    this.rehearsed = false;       /* the first bell is a rehearsal; this arms the real one */
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
  static freshPerks() {
    return { scarecrow: 0, startTier: 0, resproutCap: 0, cap: {}, longEars: 0, clickFrenzy: 0 };
  }

  /* ---------- the Seed Bed (R23) ---------- */
  static freshBed(w, h) {
    const B = CC.BED || { w: 4, h: 4 };
    return { soil: 'dirt', plots: Array((w || B.w) * (h || B.h)).fill(null), log: {}, seed: 1, n: 0,
      soilAt: 0, sacrificeLeft: 0, sacrificeRest: 0 };
  }
  /* the bed's size: Deeper Beds (Cellar) adds a row and a column per level */
  bedW() { return (CC.BED ? CC.BED.w : 4) + this.cellarLevel('beds'); }
  bedH() { return (CC.BED ? CC.BED.h : 4) + this.cellarLevel('beds'); }
  /* regrow the plot grid to the current size, keeping every plant by (x, y) */
  bedResize(oldW, oldH) {
    const W = this.bedW(), H = this.bedH();
    if (oldW === W && oldH === H) return;
    const old = this.bed.plots, next = Array(W * H).fill(null);
    for (let y = 0; y < Math.min(oldH, H); y++) for (let x = 0; x < Math.min(oldW, W); x++) next[y * W + x] = old[y * oldW + x] || null;
    this.bed.plots = next;
  }

  /* ---------- Lie Fallow & the Root Cellar (R24) ---------- */
  cellarData(id) { return (CC.CELLAR || []).find(c => c.id === id) || null; }
  cellarLevel(id) { return (this.cellar && this.cellar[id]) || 0; }
  cellarCost(id) { return ((CC.FALLOW && CC.FALLOW.cellarStep) || 8) * (this.cellarLevel(id) + 1); } /* triangular: level n costs step·n Loam */
  cellarMaxed(c) { return this.cellarLevel(c.id) >= c.cap; }
  buyCellar(id) {
    const c = this.cellarData(id);
    if (!c || this.cellarMaxed(c) || this.loam < this.cellarCost(id)) return false;
    const w = this.bedW(), h = this.bedH();
    this.loam -= this.cellarCost(id);
    this.cellar[id] = this.cellarLevel(id) + 1;
    if (id === 'beds') this.bedResize(w, h);
    return true;
  }
  /* seeds retired into loam: ⌊(log10 seeds)²⌋ — a flat ~500 per cycle */
  loamPending() { return this.seeds >= 10 ? Math.floor(Math.pow(Math.log10(this.seeds), 2)) : 0; }
  fallowAvailable() { return !!CC.FALLOW && this.loamPending() >= CC.FALLOW.minLoam; }
  /* Tilth: each Fallow sweetens the sprout mint a little, to a cap */
  tilthMult() { return this.tilthPct() / 100; }
  /* integer percent, so gain × mint × tilth is exact before the floor (binary 1.05·k is not) */
  tilthPct() { return CC.FALLOW ? 100 + Math.round(CC.FALLOW.tilthPerFallow * 100) * Math.min(this.fallows, CC.FALLOW.tilthCap) : 100; }
  scarecrowEvery() { return Math.max(10, CC.TRIAL.scarecrowEvery - (this.cellarData('pace') || { per: 10 }).per * this.cellarLevel('pace')); }
  gateRate() { return 1 + (this.cellarData('gate') || { per: 0.05 }).per * this.cellarLevel('gate'); }
  /* the world lies fallow: seeds → loam; bank, plots, upgrades, lifetime
     (hence ribbons), seeds, sprouts and the shed LADDERS reset. The Almanac,
     counters, one-shots, the seed log, Trials' ledger and perks, honey and
     the Cellar stay. Seed Memory starts the cycle at 10^lv seeds' worth of
     lifetime — a head start of hours, never a bonus. */
  fallow() {
    if (!this.fallowAvailable()) return 0;
    if (!this.mirrorBook) this.latchPages();
    const gain = this.loamPending();
    this.loam += gain;
    this.fallows++;
    const mem = this.cellarLevel('memory');
    this.bank = 0;
    this.totalRun = 0;
    this.lifetimeBase = mem > 0 ? Math.pow(10, 2 * mem + 6) : 0;
    this.seeds = mem > 0 ? Math.pow(10, mem) : 0;
    this.sprouts = 0;
    this.bought = {};
    for (const u of CC.SHED) if (u.repeat) delete this.shed[u.id];
    this.buffs = this.buffs.filter(b => b.keep);
    this.trial = null; this.haltT = 0; this.runBest = 0; this.runT = 0;
    this.owned = CC.BUILDINGS.map(() => 0);
    this.springStart();
    this._ribbonCount = this.ribbons().length;
    return gain;
  }
  /* what every spring starts with: resprouted heirlooms (deeper with the
     Short Rows and Deeper Beds perks), Quick Spring plots, free upgrade tiers */
  springStart() {
    const cap = CC.TRIAL.resproutCapBase + this.perks.resproutCap + 25 * this.cellarLevel('beds');
    for (const u of CC.SHED) {
      if (u.resprout && u.building !== undefined) {
        this.owned[u.building] = Math.max(this.owned[u.building], Math.min(this.shedLevel(u.id), cap));
      }
    }
    const quick = (this.cellarData('quick') || { per: 10 }).per * this.cellarLevel('quick');
    if (quick > 0) for (let i = 0; i < CC.BUILDINGS.length; i++) this.owned[i] = Math.max(this.owned[i], quick);
    for (let ti = 0; ti < this.perks.startTier; ti++) {
      for (let i = 0; i < CC.BUILDINGS.length; i++) this.bought[`b${i}t${ti}`] = true;
    }
    this._bumperSeen = CC.BUILDINGS.map((_, i) => this.bumperCount(i));
  }
  /* one 32-bit LCG, mirrored bit-for-bit in economy.py, so both engines
     roll the same mutations from the same seed (the snapshot carries it) */
  bedRand() {
    this.bed.seed = (Math.imul(this.bed.seed, 1664525) + 1013904223) >>> 0;
    return this.bed.seed / 4294967296;
  }
  plantData(id) { return (CC.PLANTS || []).find(p => p.id === id) || null; }
  soilData() { return (CC.SOILS || []).find(x => x.id === this.bed.soil) || (CC.SOILS || [])[0] || { every: 1, effect: 1, mutation: 1 }; }
  plotMature(pl) { const p = pl && this.plantData(pl.sp); return !!(p && pl.age >= p.mature); }
  /* steady cps for bed prices: buildings × season, no buffs — a rain at the
     bell must not make seeds dear; floored so an empty world can still plant */
  bedCpsRef() { return Math.max(10, this.baseCps(true) * this.seasonMult()); }
  /* {carrots} for tier-1 seeds, {honey} for anything found, null if not for sale */
  bedPrice(sp) {
    const p = this.plantData(sp);
    if (!p || p.wild) return null;
    if (p.tier === 1) return { carrots: this.bedCpsRef() * p.cost * 60 };
    if (this.bed.log[sp]) return { honey: (CC.BED.honeyTierCost || [])[p.tier] || 100 };
    return null;
  }
  bedPlant(i, sp) {
    if (!(i >= 0 && i < this.bed.plots.length) || this.bed.plots[i]) return false;
    const price = this.bedPrice(sp);
    if (!price) return false;
    if (price.carrots !== undefined) { if (this.bank < price.carrots) return false; this.bank -= price.carrots; }
    else { if (this.honey < price.honey) return false; this.honey -= price.honey; }
    this.bed.plots[i] = { sp, age: 0 };
    return true;
  }
  /* only a MATURE plant can be picked: there is no uproot (P1 griefing rule) */
  bedHarvest(i) {
    const pl = this.bed.plots[i];
    if (!this.plotMature(pl)) return null;
    const p = this.plantData(pl.sp);
    const soil = this.soilData();
    let gain = 0;
    if (p.payout) {
      gain = Math.min(this.bedCpsRef() * p.payout * 60 * soil.effect, this.bank * CC.BED.payoutCapPct + this.bedCpsRef() * 60);
      this.earn(gain);
    }
    const honey = p.honey ? Math.round(p.honey * soil.effect) : 0;
    this.honey += honey;
    const first = !this.bed.log[pl.sp];
    this.bed.log[pl.sp] = (this.bed.log[pl.sp] || 0) + 1;
    this.bed.plots[i] = null;
    return { sp: pl.sp, gain, honey, first };
  }
  bedSoil(id, now) {
    if (!(CC.SOILS || []).some(x => x.id === id) || id === this.bed.soil) return false;
    if (now - this.bed.soilAt < CC.BED.soilCooldown) return false;
    this.bed.soil = id;
    this.bed.soilAt = now;
    return true;
  }
  logFull() { return (CC.PLANTS || []).every(p => this.bed.log[p.id]); }
  logTier(n) { return (CC.PLANTS || []).some(p => p.tier === n && this.bed.log[p.id]); }
  /* a complete log may be given up for honey — after a cancellable wait */
  bedSacrifice() {
    if (!this.logFull() || this.bed.sacrificeLeft > 0 || this.bed.sacrificeRest > 0) return false;
    this.bed.sacrificeLeft = CC.BED.sacrificeWait || 21600;
    return true;
  }
  /* a cancelled sacrifice rests a while: cancel/re-fire cannot ping-pong */
  bedCancel() {
    const was = this.bed.sacrificeLeft > 0;
    this.bed.sacrificeLeft = 0;
    if (was) this.bed.sacrificeRest = CC.BED.sacrificeRest || 600;
    return was;
  }
  /* aggregates while mature — each capped, so 16 Fairy Rings are a bounded blessing */
  bedMult() {
    const e = this.soilData().effect;
    let m = 1;
    for (const pl of this.bed.plots) {
      const p = pl && this.plotMature(pl) ? this.plantData(pl.sp) : null;
      if (p && p.mult) m *= 1 + (p.mult - 1) * e;
    }
    return Math.max(0.5, Math.min(CC.BED.multCap, m));
  }
  bedRabbit() {
    let m = 1;
    for (const pl of this.bed.plots) { const p = pl && this.plotMature(pl) ? this.plantData(pl.sp) : null; if (p && p.rabbit) m *= p.rabbit; }
    return Math.min(CC.BED.rabbitCap, m);
  }
  bedWeather() {
    let m = 1;
    for (const pl of this.bed.plots) { const p = pl && this.plotMature(pl) ? this.plantData(pl.sp) : null; if (p && p.weather) m *= p.weather; }
    return Math.min(CC.BED.weatherCap, m);
  }
  bedNeighbors(i) {
    const W = this.bedW(), H = this.bedH(), x = i % W, y = Math.floor(i / W), out = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < W && ny < H) out.push(ny * W + nx);
    }
    return out;
  }
  /* one bed tick: age, die, then every empty plot rolls for wild seeds and
     for a cross between two mature neighbours. Order is fixed (plot index,
     species table order) and the RNG is shared, so both engines agree. */
  bedTick() {
    const events = [];
    const bed = this.bed, soil = this.soilData();
    bed.n++;
    if (bed.n % soil.every !== 0) return events;
    for (let i = 0; i < bed.plots.length; i++) {
      const pl = bed.plots[i];
      if (!pl) continue;
      const p = this.plantData(pl.sp);
      if (!p) { bed.plots[i] = null; continue; }
      pl.age++;
      if (pl.age >= p.life) { bed.plots[i] = null; events.push({ type: 'bedDied', i, sp: pl.sp }); }
    }
    for (let i = 0; i < bed.plots.length; i++) {
      if (bed.plots[i]) continue;
      const near = this.bedNeighbors(i).map(j => bed.plots[j]).filter(pl => this.plotMature(pl)).map(pl => pl.sp);
      let born = null;
      for (const p of CC.PLANTS) {
        if (p.wild) { if (this.bedRand() < p.wild) { born = p.id; break; } continue; }
        if (!p.parents) continue;
        const [a, b] = p.parents;
        const ok = a === b ? near.filter(x => x === a).length >= 2 : near.includes(a) && near.includes(b);
        if (ok && this.bedRand() < p.chance * soil.mutation) { born = p.id; break; }
      }
      if (born) { bed.plots[i] = { sp: born, age: 0 }; events.push({ type: 'bedSprout', i, sp: born }); }
    }
    return events;
  }

  /* ---------- Trials (R22) ---------- */
  trialData(id) { return (CC.TRIALS || []).find(t => t.id === (id === undefined ? (this.trial && this.trial.id) : id)) || null; }
  /* the active rule's value for k, else undefined — every hook asks here */
  rule(k) { const t = this.trialData(); return t ? t.rule[k] : undefined; }
  trialDone(id) { return this.trialsDone[id] || 0; }
  /* the spring being left counts toward the goal's memory only if it was
     plain and at least an hour long (a spam of instant springs lowers nothing) */
  plainRun() { return !this.trial && this.runT >= CC.TRIAL.minSpringSec ? this.totalRun : 0; }
  /* how much of a plain spring's income the rule leaves, measured on THIS
     garden: Drought a quarter, Short Rows the first six rows' share, Hands
     Only a reference hand's clicks (refClicks/s) — rules that cost time,
     not income, are 1. Clamped so a goal is never zero. */
  ruleHandicap(id) {
    const t = this.trialData(id);
    if (!t) return 1;
    const saved = this.trial, savedHalt = this.haltT;
    this.trial = null; this.haltT = 0;
    const plain = this.cps();
    this.trial = { id, goal: 0, t: 0 };
    const under = t.rule.buildingsOff ? this.clickPower() * CC.TRIAL.refClicks : this.cps();
    this.trial = saved; this.haltT = savedHalt;
    if (!(plain > 0)) return t.rule.mulAll || 1; /* a bare garden: a flat rule still counts */
    return Math.max(1e-6, Math.min(1, under / plain)); /* Short Rows on a 700-plot world is well under 0.1 % */
  }
  /* "get back to where we were": the best plain spring on record (or the
     one ending now), scaled by the rule's handicap, doubling per completion */
  trialGoal(id) {
    const best = Math.max(1e6, this.runBest, this.plainRun());
    return best * this.ruleHandicap(id) * Math.pow(CC.TRIAL.step, this.trialDone(id));
  }
  /* a row that Short Rows has cut holds nothing this spring — for synergies
     and bumpers too, not just its own output (R22 review) */
  rowCount(i) { return this.rowExists(i) ? this.owned[i] : 0; }
  trialAvailable(id) {
    const t = this.trialData(id);
    return !!t && this.trialDone(id) < CC.TRIAL.maxDone;
  }
  /* Late Frost: production stills on every purchase and thaws linearly */
  haltMult() {
    const h = this.rule('haltOnBuy');
    return h && this.haltT > 0 ? Math.max(0, 1 - this.haltT / h) : 1;
  }
  touchHalt() { const h = this.rule('haltOnBuy'); if (h) this.haltT = h; }
  /* a building "exists" unless Short Rows has cut the field */
  rowExists(i) { const m = this.rule('buildingsMax'); return m === undefined || i < m; }
  /* apply one Trial reward to the world's perks; returns the ledger line */
  applyReward(r) {
    const p = this.perks;
    if (r.scarecrow) p.scarecrow = Math.min(5, p.scarecrow + r.scarecrow);
    if (r.startTier) p.startTier = Math.min(CC.TIERS.length, p.startTier + r.startTier);
    if (r.resproutCap) p.resproutCap = Math.min(100, p.resproutCap + r.resproutCap);
    if (r.cap) p.cap[r.cap] = Math.min(10, (p.cap[r.cap] || 0) + (r.n || 1));
    if (r.longEars) p.longEars = Math.min(5, p.longEars + r.longEars);
    if (r.clickFrenzy) p.clickFrenzy = Math.min(5, p.clickFrenzy + r.clickFrenzy);
    if (r.honey) this.honey += r.honey;
  }

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
    if (c.tins !== undefined) return this.tins >= c.tins;
    if (c.stalls !== undefined) return this.stalls >= c.stalls;
    if (c.weathers !== undefined) return this.weathers >= c.weathers;
    if (c.heirloomEvery !== undefined) {
      return CC.SHED.every(u => !u.resprout || this.shedLevel(u.id) >= c.heirloomEvery);
    }
    /* Trials (R22) */
    if (c.trial !== undefined) return this.trialDone(c.trial) >= (c.n || 1);
    if (c.trialMax !== undefined) {
      return (CC.TRIALS || []).filter(t => this.trialDone(t.id) >= CC.TRIAL.maxDone).length >= c.trialMax;
    }
    /* the Seed Bed (R23) */
    if (c.logTier !== undefined) return this.logTier(c.logTier);
    if (c.logFull !== undefined) return this.logFull();
    if (c.sacrifices !== undefined) return this.sacrifices >= c.sacrifices;
    /* Lie Fallow (R24) */
    if (c.fallows !== undefined) return this.fallows >= c.fallows;
    if (c.loam !== undefined) return this.loam >= c.loam;
    if (c.cellar !== undefined) return this.cellarLevel(c.cellar) >= (c.n || 1);
    if (c.cellarAny !== undefined) return (CC.CELLAR || []).some(x => this.cellarLevel(x.id) >= 1);
    if (c.cellarFull !== undefined) return (CC.CELLAR || []).every(x => this.cellarMaxed(x));
    if (c.rehearsed !== undefined) return this.rehearsed;
    return false;
  }

  upgradeVisible(u) {
    if (this.bought[u.id]) return false;
    if (u.type === 'building' && !this.rowExists(u.b)) return false; /* Short Rows */
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
    this.touchHalt(); /* Late Frost: an upgrade is a purchase too */
    this.bank -= u.cost;
    this.bought[id] = true;
    return true;
  }

  /* ---------- production ---------- */
  buildingMult(i) {
    let m = 1;
    for (let ti = 0; ti < CC.TIERS.length; ti++) if (this.bought[`b${i}t${ti}`]) m *= 2;
    for (const u of CC.SYNERGY_UPGRADES) {
      if (u.target === i && this.bought[u.id]) m *= 1 + u.pct * this.rowCount(u.per);
    }
    for (const u of CC.SHED) {
      if (u.building === i && u.bmult) m *= Math.pow(u.bmult, this.shedLevel(u.id));
    }
    return m;
  }

  /* bumper crops: +1% global per owned-count milestone, per building type */
  bumperCount(i) {
    let n = 0;
    for (const at of CC.MILESTONES) if (this.rowCount(i) >= at) n++;
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
    const k = this.rule('mulAll');  /* Drought: every blessing shrinks to a quarter (scale-free) */
    return k ? m * k : m;
  }

  buffMult() {
    let m = 1;
    for (const b of this.buffs) m *= b.mult;
    return m;
  }

  /* seasons (R17): time-boxed world modifiers; unknown ids are homestead */
  seasonData() { return CC.SEASONS.find(s => s.id === this.season) || null; }
  seasonMult() { const s = this.seasonData(); return (s && s.mult) || 1; }

  /* `raw` ignores Hands Only (the plots sleep, but clicks are still worth
     their share of what the plots WOULD make — the sanctioned bot spring);
     Short Rows cuts the field for both */
  baseCps(raw = false) {
    if (!raw && this.rule('buildingsOff')) return 0;
    let c = 0;
    for (let i = 0; i < CC.BUILDINGS.length; i++) {
      if (!this.rowExists(i)) continue;
      c += this.owned[i] * CC.BUILDINGS[i].cps * this.buildingMult(i);
    }
    return c * this.globalMult();
  }

  cps() { return this.baseCps() * this.buffMult() * this.seasonMult() * this.handsBonus * this.haltMult() * this.bedMult(); }

  /* one multiplier for every price discount in play: a priceOff season and
     Market Hour stack multiplicatively (R17/R21) */
  priceDisc() {
    const s = this.seasonData();
    const m = this.marketHour && CC.MARKET_HOUR ? CC.MARKET_HOUR.priceOff : 0;
    return (1 - ((s && s.priceOff) || 0)) * (1 - (m || 0));
  }

  /* Honey (R21): minted by deeds, never by production, so it can't inflate */
  mintHoney(kind) {
    const n = (CC.HONEY && CC.HONEY[kind]) || 0;
    if (n > 0) this.honey += n;
    return n;
  }

  clickPower() {
    let base = 1, pct = 0;
    for (const u of CC.CLICK_UPGRADES) {
      if (!this.bought[u.id]) continue;
      if (u.mult) base *= u.mult;
      if (u.cpsPct) pct += u.cpsPct;
    }
    for (const u of CC.SHED) if (u.cpsPct) pct += u.cpsPct * this.shedLevel(u.id);
    /* Click Frenzy (R22 perk): a Rabbit Frenzy also multiplies clicks ×(1+2·lv) */
    const cf = this.perks.clickFrenzy && this.buffs.some(b => b.name === 'Rabbit Frenzy')
      ? 1 + 2 * this.perks.clickFrenzy : 1;
    /* Late Frost stills the harvest share of a click too; the bare hand never stills */
    return (base + pct * this.baseCps(true) * this.haltMult()) * this.buffMult() * this.seasonMult() * this.handsBonus * cf * this.bedMult();
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
    return c0 * (Math.pow(r, count) - 1) / (r - 1) * this.priceDisc();
  }

  /* Trials (R22): the most a row may hold right now — Short Rows cuts the
     field, Crop Rotation chains each row to the one before it */
  rowRoom(i) {
    if (!this.rowExists(i)) return 0;
    if (this.rule('chain') && i > 0) return Math.max(0, this.owned[i - 1] - this.owned[i]);
    return Infinity;
  }

  buy(i, count = 1) {
    if (count < 1 || count > this.rowRoom(i)) return false;
    const cost = this.costOf(i, count);
    if (this.bank < cost) return false;
    this.bank -= cost;
    this.owned[i] += count;
    this.touchHalt();
    return true;
  }

  /* largest count the bank affords right now (R20 "Max"): invert the
     geometric sum, then verify ±1 against costOf so float drift can never
     overcharge; capped at 5000 to keep 1.15^n inside double range */
  maxAffordable(i) {
    const r = 1.15;
    const c0 = CC.BUILDINGS[i].cost * Math.pow(r, this.owned[i]) * this.priceDisc();
    if (this.bank < c0) return 0;
    let m = Math.min(5000, Math.floor(Math.log(1 + this.bank * (r - 1) / c0) / Math.log(r)));
    while (m > 0 && this.costOf(i, m) > this.bank) m--;
    while (m < 5000 && this.costOf(i, m + 1) <= this.bank) m++;
    return Math.min(m, this.rowRoom(i));
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

  /* the highest level a ladder can hold without costGrowth^level leaving
     double range (overflow → Infinity/OverflowError). Per item, because a
     1.04 ladder climbs far past what a 1.45 one can: a flat 800 once
     clamped the live world's 1045-turn compost heap on reload. */
  shedCap(u) {
    if (u.max !== undefined) return u.max + ((this.perks.cap || {})[u.id] || 0); /* Trial perk (R22) */
    if (!u.repeat || !(u.costGrowth > 1)) return 1;
    return Math.floor(600 / Math.log(u.costGrowth)); /* e^600 ≈ 1e260 */
  }

  shedMaxed(u) {
    const lv = this.shedLevel(u.id);
    return u.repeat ? (u.max !== undefined && lv >= this.shedCap(u)) : lv >= 1; /* cap perks count (R22) */
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

  /* One reward dispatch for every patch visitor (R19). The tin rabbit is
     a decoy: it pays nothing but the Almanac remembers. The Parsnip Man's
     stall is the world's shared gamble — one click decides for everyone. */
  visitorReward(kind, rng = Math.random) {
    this.mintHoney(kind === 'parsnip' ? 'stall' : kind === 'tin' ? 'tin' : 'rabbit');
    if (kind === 'tin') {
      this.tins++;
      return { kind: 'tin' };
    }
    if (kind === 'parsnip') {
      this.stalls++;
      if (rng() < 0.4) {
        this.buffs.push({ name: 'Parsnip Embargo', mult: 0.5, left: 45 });
        return { kind: 'embargo' };
      }
      /* same floor as the rabbit's bundle: a coup right after a world
         prestige must never pay a humiliating +0 (review) */
      const gain = Math.max(this.clickPower() * 20,
        Math.min(this.bank * 0.25, this.cps() * 900) + this.cps() * 90);
      this.earn(gain);
      return { kind: 'coup', gain };
    }
    return this.rabbitReward(rng); /* the golden classic */
  }

  /* ---------- prestige ---------- */
  seedsEarnedTotal() { return Math.floor(Math.sqrt(this.totalAllTime / 1e6)); }
  pendingSeeds() { return Math.max(0, this.seedsEarnedTotal() - this.seeds); }
  nextSeedAt() { return Math.pow(this.seedsEarnedTotal() + 1, 2) * 1e6; }

  prestige(trialId) {
    const gain = this.pendingSeeds();
    if (gain < 1) return 0;
    /* a deed done in the dying second of a spring still counts (review F3) */
    if (!this.mirrorBook) this.latchPages();
    /* Trials (R22): remember this spring, then maybe open the next one
       under a rule. Going to seed mid-Trial abandons it — a spring is the
       unit, and the goal was this spring's. */
    const goal = trialId && this.trialAvailable(trialId) && !this.trial ? this.trialGoal(trialId) : 0;
    this.runBest = Math.max(this.runBest, this.plainRun()); /* only an honest plain spring raises the bar */
    this.runT = 0;
    this.trial = goal > 0 ? { id: trialId, goal, t: 0 } : null;
    this.haltT = 0;
    this.seeds += gain;
    this.sprouts += Math.floor(gain * this.mintMult() * this.tilthPct() / 100); /* every seed sprouts (R13); doublers stack (R15); Tilth (R24) */
    this.prestiges++;
    this.mintHoney('spring');
    this.bank = 0;
    this.lifetimeBase += this.totalRun; /* fold the run before resetting it */
    this.totalRun = 0;
    this.owned = CC.BUILDINGS.map(() => 0);
    this.bought = {};
    /* a spring clears the weather, never a Parish reward: Bumper Day/Week
       are earned by the whole world and outlive any one run (R21) */
    this.buffs = this.buffs.filter(b => b.keep);
    /* resprouts (R15), Quick Spring (R24), free tiers (R22) — and the bumper
       pre-seed, so a resprouted row never fires a toast storm */
    this.springStart();
    return gain;
  }

  /* ---------- tick ---------- */
  tick(dt) {
    this.t += dt;
    const events = [];
    this.earn(this.cps() * dt);
    for (const b of this.buffs) b.left -= dt;
    /* the Bee Cooperative (p5) produces honey on the clock (R21) */
    if (!this.mirror && CC.HONEY && this.shedLevel('p5') >= 1) {
      const per = 86400 / CC.HONEY.beePerDay;
      this.beeT += dt;
      while (this.beeT >= per) { this.beeT -= per; this.honey++; }
    }
    const expired = this.buffs.filter(b => b.left <= 0);
    this.buffs = this.buffs.filter(b => b.left > 0);
    for (const b of expired) events.push({ type: 'buffEnd', name: b.name });
    /* Trials (R22): the thaw, the clock, the goal */
    this.runT += dt;
    if (this.haltT > 0) this.haltT = Math.max(0, this.haltT - dt);
    if (this.trial) {
      const tr = this.trial;
      tr.t += dt;
      if (this.mirror) { /* the server decides wins and losses; this core only keeps the clock */
      } else if (this.totalRun >= tr.goal) {
        const t = this.trialData();
        const n = this.trialDone(tr.id) + 1;
        this.trialsDone[tr.id] = n;
        if (!(this.trialBest[tr.id] <= tr.t)) this.trialBest[tr.id] = tr.t;
        if (t && t.reward) this.applyReward(t.reward);
        events.push({ type: 'trial', id: tr.id, won: true, n, t: tr.t });
        this.trial = null;
        this.haltT = 0;
      } else if (tr.t >= CC.TRIAL.hours * 3600) {
        events.push({ type: 'trial', id: tr.id, won: false, n: this.trialDone(tr.id), t: tr.t });
        this.trial = null;
        this.haltT = 0;
      }
    }
    /* the Seed Bed (R23): ticks on its own clock; a pending sacrifice counts down */
    if (CC.BED && this.bed) {
      this.bedT += dt;
      while (this.bedT >= CC.BED.tick) { this.bedT -= CC.BED.tick; if (!this.mirror) events.push(...this.bedTick()); }
      if (this.bed.sacrificeRest > 0) this.bed.sacrificeRest = Math.max(0, this.bed.sacrificeRest - dt);
      if (!this.mirror && this.bed.sacrificeLeft > 0) {
        this.bed.sacrificeLeft -= dt;
        if (this.bed.sacrificeLeft <= 0) {
          this.bed.sacrificeLeft = 0;
          if (this.logFull()) {
            this.honey += CC.BED.sacrificeHoney;
            this.sacrifices++;
            this.bed.log = {};
            events.push({ type: 'sacrifice', honey: CC.BED.sacrificeHoney });
          }
        }
      }
    }
    /* the Scarecrow (R22 perk): every minute it buys one of the cheapest
       affordable building among the rows it tends, if that costs no more
       than 1% of the bank — a patient hand, never a multiplier. It rests
       during Late Frost (its purchase would still the garden). */
    if (!this.mirror && this.perks.scarecrow > 0 && !this.rule('haltOnBuy')) {
      this.scT += dt;
      if (this.scT >= this.scarecrowEvery()) {
        this.scT = 0;
        let pick = -1, best = Infinity;
        for (let i = 0; i < Math.min(CC.BUILDINGS.length, 2 * this.perks.scarecrow); i++) {
          if (this.rowRoom(i) < 1) continue;
          const c = this.costOf(i, 1);
          if (c <= this.bank * CC.TRIAL.scarecrowPct && c < best) { best = c; pick = i; }
        }
        if (pick >= 0 && this.buy(pick, 1)) events.push({ type: 'scarecrow', b: pick });
      }
    }
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
      tins: this.tins, stalls: this.stalls, weathers: this.weathers,
      honey: this.honey, beeT: this.beeT,
      trial: this.trial ? { ...this.trial } : null, trialsDone: this.trialsDone, trialBest: this.trialBest,
      runBest: this.runBest, runT: this.runT, perks: this.perks, haltT: this.haltT,
      bed: { soil: this.bed.soil, plots: this.bed.plots.map(p => p && { ...p }), log: { ...this.bed.log },
        seed: this.bed.seed, n: this.bed.n, soilAt: this.bed.soilAt, sacrificeLeft: this.bed.sacrificeLeft,
        sacrificeRest: this.bed.sacrificeRest },
      bedT: this.bedT, sacrifices: this.sacrifices,
      loam: this.loam, cellar: this.cellar, fallows: this.fallows, rehearsed: this.rehearsed,
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
    /* Trial perks first: a cap perk raises a ladder's cap, and the shed clamp below must see it (R22 review) */
    const pk = s.perks || {};
    const cnt = (v, hi) => Math.min(hi, Math.max(0, Math.floor(v) || 0));
    this.perks = {
      scarecrow: cnt(pk.scarecrow, 5), startTier: cnt(pk.startTier, CC.TIERS.length),
      resproutCap: cnt(pk.resproutCap, 100), longEars: cnt(pk.longEars, 5), clickFrenzy: cnt(pk.clickFrenzy, 5),
      cap: {},
    };
    for (const u of CC.SHED) { const v = cnt((pk.cap || {})[u.id], 10); if (v > 0 && u.max !== undefined) this.perks.cap[u.id] = v; }
    this.shed = {};
    for (const u of CC.SHED) {
      const v = (s.shed || {})[u.id];
      const lv = v === true ? 1 : (Math.floor(v) || 0);
      if (lv > 0) this.shed[u.id] = Math.min(lv, this.shedCap(u));
    }
    this.prestiges = Math.max(0, Math.floor(s.prestiges) || 0);
    this.rabbits = Math.max(0, Math.floor(s.rabbits) || 0);
    this.sproutsSpent = Math.max(0, s.sproutsSpent || 0);
    this.tins = Math.max(0, Math.floor(s.tins) || 0);
    this.stalls = Math.max(0, Math.floor(s.stalls) || 0);
    this.weathers = Math.max(0, Math.floor(s.weathers) || 0);
    this.honey = Math.max(0, Math.floor(s.honey) || 0);
    this.beeT = Math.max(0, Math.min(+s.beeT || 0, 86400));
    /* Trials (R22): ids must exist, counts stay inside the ladder, the
       goal must be a real number — a forged Infinity goal would never end */
    const T = CC.TRIAL || { maxDone: 5, runLog: 5, hours: 48 };
    this.trialsDone = {};
    this.trialBest = {};
    for (const t of (CC.TRIALS || [])) {
      const n = Math.floor((s.trialsDone || {})[t.id]) || 0;
      if (n > 0) this.trialsDone[t.id] = Math.min(n, T.maxDone);
      const b = +(s.trialBest || {})[t.id];
      if (b > 0 && isFinite(b)) this.trialBest[t.id] = b;
    }
    const tr = s.trial;
    this.trial = tr && this.trialData(tr.id) && tr.goal > 0 && isFinite(tr.goal)
      ? { id: tr.id, goal: +tr.goal, t: Math.max(0, Math.min(+tr.t || 0, T.hours * 3600)) } : null;
    /* pre-fix saves carried a five-entry runLog: its best seeds the high-water mark */
    const oldLog = (Array.isArray(s.runLog) ? s.runLog : []).map(x => +x).filter(x => x >= 0 && isFinite(x));
    this.runBest = Math.max(0, +s.runBest > 0 && isFinite(+s.runBest) ? +s.runBest : 0, ...oldLog);
    /* a save from before runT existed is a spring of unknown age: call it old
       enough to count, or the first Trial after a deploy would ask for 1e6 */
    this.runT = s.runT === undefined ? CC.TRIAL.minSpringSec : Math.max(0, Math.min(+s.runT || 0, 1e9));
    this.haltT = Math.max(0, Math.min(+s.haltT || 0, 3600));
    /* the Seed Bed (R23): species must exist, ages are ints, the seed is a
       uint32, the log holds counts — a forged plot never grows a null */
    /* the Cellar first: the bed's size depends on it (R24) */
    this.loam = Math.max(0, Math.floor(s.loam) || 0);
    this.fallows = Math.max(0, Math.floor(s.fallows) || 0);
    this.rehearsed = !!s.rehearsed;
    this.cellar = {};
    for (const cd of (CC.CELLAR || [])) { const lv = Math.floor((s.cellar || {})[cd.id]) || 0; if (lv > 0) this.cellar[cd.id] = Math.min(lv, cd.cap); }
    const B = { w: this.bedW(), h: this.bedH() }, rb = s.bed || {}, fresh = CC.Core.freshBed(B.w, B.h);
    this.bed = fresh;
    if ((CC.SOILS || []).some(x => x.id === rb.soil)) fresh.soil = rb.soil;
    const plots = Array.isArray(rb.plots) ? rb.plots : [];
    for (let i = 0; i < B.w * B.h; i++) {
      const pl = plots[i];
      const p = pl && typeof pl === 'object' ? this.plantData(pl.sp) : null;
      if (p) fresh.plots[i] = { sp: p.id, age: Math.max(0, Math.min(Math.floor(+pl.age) || 0, p.life)) };
    }
    for (const p of (CC.PLANTS || [])) { const n = Math.floor((rb.log || {})[p.id]) || 0; if (n > 0) fresh.log[p.id] = Math.min(n, 1e9); }
    fresh.seed = (Math.floor(+rb.seed) >>> 0) || 1;
    fresh.n = Math.max(0, Math.floor(+rb.n) || 0);
    fresh.soilAt = Math.max(0, +rb.soilAt || 0);
    fresh.sacrificeLeft = Math.max(0, Math.min(+rb.sacrificeLeft || 0, CC.BED.sacrificeWait || 21600));
    fresh.sacrificeRest = Math.max(0, Math.min(+rb.sacrificeRest || 0, 3600));
    this.bedT = Math.max(0, Math.min(+s.bedT || 0, CC.BED.tick));
    this.sacrifices = Math.max(0, Math.floor(s.sacrifices) || 0);
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
      if (this.trial) this.trial.t += gone; /* a Trial's 48 h is wall time (mirrors economy.py) */
      /* the bed kept growing too (R23), within the offline cap */
      if (CC.BED) {
        this.bedT += Math.min(gone, 8 * 3600);
        while (this.bedT >= CC.BED.tick) { this.bedT -= CC.BED.tick; this.bedTick(); }
      }
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
