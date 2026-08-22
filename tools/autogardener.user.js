// ==UserScript==
// @name         Carrot Patch Autogardener
// @namespace    https://github.com/pdgeorge/carrot-patch-clicker
// @version      1.1.0
// @description  Tends the shared carrot patch: clicks, buys whatever is best value right now, greets visitors. Auto-clickers are gardeners too (DESIGN P4).
// @author       the gardeners
// @match        https://pdgeorge.com.au/carrot-patch/*
// @match        http://localhost:8420/*
// @match        http://127.0.0.1:8420/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

/* HOW IT DECIDES  ────────────────────────────────────────────────────────
 *
 * It never re-implements the game's maths. Every candidate purchase is
 * valued by asking the REAL engine: apply the purchase to the local core,
 * read cps()/clickPower(), put it back. So bumper-crop milestones, synergy
 * upgrades, heirloom strains, season bonuses and buffs are all priced
 * correctly and for free — and the script can't drift from the game.
 *
 *   value  = Δ(cps + clickPower × clickRate)      ← "effective production"
 *
 * WHAT it buys and HOW MANY are separate questions, on purpose. Payback
 * (cost ÷ value) rises with quantity — the 1.15× cost curve guarantees it —
 * so ranking by payback alone would forever choose "one unit of the single
 * best thing", which crawls when the shared bank is astronomical. So:
 *
 *   which  = the building with the shortest payback for ONE unit
 *   how many = the most units whose payback stays within a few times that
 *              (relative, so it is scale-free), capped by a share of the bank
 *
 * It never hoards: carrots sitting in the bank have no other use in this
 * game — no alternative currency, prestige counts lifetime not bank — so
 * anything with positive value beats holding. An absolute "only buy things
 * that repay in N seconds" rule would idle on an enormous bank; a relative
 * one keeps buying the best thing available at any scale.
 *
 * Upgrades are handled differently again: they are one-off, permanent, and
 * every one in this game is strictly positive, so the correct move is the
 * one the repo's own reference bot makes — buy every affordable upgrade,
 * cheapest first. Ranking them against buildings starves the cheap ones
 * (a 100-carrot click upgrade never out-paybacks a building, so it would
 * never be bought at all).
 *
 * Greedy is genuinely near-optimal HERE, specifically because the bank is
 * shared: hoarding for a big-ticket item doesn't work when a dozen other
 * gardeners are spending the same carrots. Buy good value now.
 *
 * Gains are also computed analytically as a floor, because at extreme world
 * scale a marginal building can be smaller than one float-ulp of total cps —
 * the engine diff would read zero and the item would look worthless.
 *
 * Everything is routed through the game's own methods, so intents obey the
 * real protocol and the server stays the only truth (P2). The script also
 * keeps itself under the server's 10 msg/sec flood guard, leaving headroom
 * for the client's own click batches.
 *
 * PRESTIGE IS OFF BY DEFAULT, deliberately: Going to Seed resets the
 * garden for EVERY player on Earth. That is a decision to make with the
 * world, not something a bot should do to strangers at 3am. Turn it on
 * knowingly.
 * ─────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

  const CFG = {
    clickRate: 15,        // clicks/sec (the server's anti-flood ceiling is 1000/msg)
    click: true,
    buildings: true,
    upgrades: true,
    shed: true,           // spend the world's sprouts in the Potting Shed
    visitors: true,       // catch golden rabbits, tin rabbits and the Parsnip Man
    parsnip: true,        // the stall is a shared gamble: ~60% coup / 40% embargo
    prestige: false,      // resets the world for everyone — off on purpose
    prestigeAt: 0.15,     // if on: prestige when pending seeds ≥ 15% of held seeds
    slack: 4,             // bulk-buy while payback stays within N× the best unit's
    spendFrac: 0.75,      // …and never more than this share of the bank at once
    actionsPerTick: 3,    // purchases considered per decision pass
    decisionMs: 400,      // how often to consider a purchase
    msgBudget: 6,         // max intents/sec we send (server allows 10)
  };

  const LS = 'carrot-autogardener-cfg';
  try { Object.assign(CFG, JSON.parse(localStorage.getItem(LS) || '{}')); } catch (e) { /* defaults */ }
  const saveCfg = () => { try { localStorage.setItem(LS, JSON.stringify(CFG)); } catch (e) { /* private mode */ } };

  let ui, core, CC;
  const sent = [];                    // timestamps of intents, for the flood budget
  const stats = { clicks: 0, buys: 0, upgrades: 0, sheds: 0, visitors: 0, prestiges: 0 };
  let lastAction = 'waiting for the patch…';

  const fmt = n => (CC && CC.fmt ? CC.fmt(n) : Math.floor(n).toString());
  const canSend = () => {
    const now = performance.now();
    while (sent.length && now - sent[0] > 1000) sent.shift();
    return sent.length < CFG.msgBudget;
  };
  const spend = () => sent.push(performance.now());

  /* ---------- valuation ---------- */

  // what the world actually produces per second, counting our clicking
  const effective = () => core.cps() + core.clickPower() * (CFG.click ? CFG.clickRate : 0);
  const seasonM = () => (typeof core.seasonMult === 'function' ? core.seasonMult() : 1);

  // Δ effective production from n more of building i. The engine answers
  // (so milestones/synergies/strains count), with an analytic floor for the
  // scale where a marginal building hides under one ulp of total cps.
  function buildingGain(i, n, base) {
    core.owned[i] += n;
    const eng = effective() - base;
    core.owned[i] -= n;
    const analytic = n * CC.BUILDINGS[i].cps * core.buildingMult(i)
      * core.globalMult() * core.buffMult() * seasonM();
    return Math.max(eng, analytic);
  }

  // the most units worth taking in one go: marginal value must stay within
  // CFG.slack× the single unit's payback (relative ⇒ scale-free), and inside
  // its share of the bank. Binary search — costOf is monotone in n.
  function bulkCount(i, base, pay1) {
    const budget = core.bank * CFG.spendFrac;
    const limit = pay1 * CFG.slack;
    const ok = n => {
      const cost = core.costOf(i, n);
      if (!(cost <= budget)) return false;
      const g = buildingGain(i, n, base);
      return g > 0 && cost / g <= limit;
    };
    if (!ok(1)) return 0;
    let lo = 1, hi = 1;
    while (hi < 1000 && ok(hi * 2)) hi *= 2;
    hi = Math.min(hi * 2, 1000);
    while (lo < hi) {                     // largest n that still passes
      const mid = Math.ceil((lo + hi) / 2);
      if (ok(mid)) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  // everything the bank could take of building i right now (for 'max')
  function affordableCount(i) {
    if (typeof core.maxAffordable === 'function') return core.maxAffordable(i);
    let n = 0;
    while (n < 5000 && core.costOf(i, n + 1) <= core.bank) n++;
    return n;
  }

  // WHICH building: best payback for a single unit. HOW MANY: bulkCount.
  function bestBuilding(base) {
    let pick = null;
    for (let i = 0; i < CC.BUILDINGS.length; i++) {
      const cost1 = core.costOf(i, 1);
      if (!(cost1 <= core.bank)) continue;
      const g1 = buildingGain(i, 1, base);
      if (!(g1 > 0)) continue;
      const pay1 = cost1 / g1;
      if (!pick || pay1 < pick.pay1) pick = { i, pay1 };
    }
    if (!pick) return null;
    const want = bulkCount(pick.i, base, pick.pay1);
    if (want < 1) return null;
    // milestone sniping: if the next bumper crop is within reach of this
    // budget, stretch to land exactly on it
    const next = typeof core.nextBumperAt === 'function' ? core.nextBumperAt(pick.i) : null;
    const toMilestone = next ? next - core.owned[pick.i] : 0;
    const n = (toMilestone > want && core.costOf(pick.i, toMilestone) <= core.bank * CFG.spendFrac)
      ? toMilestone : want;
    return { kind: 'building', i: pick.i, n, cost: core.costOf(pick.i, n) };
  }

  // Upgrades are one-off, permanent and all strictly positive in this game:
  // buy every affordable one, cheapest first (the repo's own reference bot
  // does exactly this). Ranking them against buildings starves cheap ones.
  function nextUpgrade() {
    let best = null;
    for (const u of core.visibleUpgrades()) {
      if (!(u.cost <= core.bank)) continue;
      if (!best || u.cost < best.cost) best = u;
    }
    return best ? { kind: 'upgrade', id: best.id, name: best.name, cost: best.cost } : null;
  }

  function shedOptions(base) {
    // sprouts are a separate currency with no other use, so this is a
    // separate greedy race rather than part of the carrot comparison
    if (!CC.SHED || typeof core.shedLevel !== 'function') return [];
    const out = [];
    for (const u of CC.SHED) {
      if (core.shedMaxed(u) || !core.shedVisible(u)) continue;
      const cost = core.shedCost(u.id);
      if (!(cost <= core.sprouts)) continue;
      const lv = core.shedLevel(u.id);
      core.shed[u.id] = lv + 1;
      let gain = effective() - base;
      if (lv === 0) delete core.shed[u.id]; else core.shed[u.id] = lv;
      if (!(gain > 0)) {                    // same ulp floor as buildings
        if (u.mult) gain = core.cps() * (u.mult - 1);
        else if (u.bmult && u.building !== undefined) {
          gain = core.owned[u.building] * CC.BUILDINGS[u.building].cps
            * core.buildingMult(u.building) * core.globalMult() * core.buffMult()
            * seasonM() * (u.bmult - 1);
        }
      }
      // mint doublers pay nothing now and double every future prestige's
      // sprouts — always worth taking when the world can afford one
      const pay = u.mintMult ? -1 : (gain > 0 ? cost / gain : Infinity);
      if (pay < Infinity) out.push({ kind: 'shed', id: u.id, name: u.name, cost, gain, pay });
    }
    return out;
  }

  /* ---------- acting ---------- */

  function doClicks(n) {
    for (let k = 0; k < n; k++) {
      core.click();
      if (ui.patchOn && ui.patchOn()) ui.patch.pending++;   // batched: 1 msg/sec
      stats.clicks++;
    }
    ui.squash = Math.max(ui.squash || 0, 0.8);              // one visible pull
  }

  // The server whitelists n ∈ {1, 5, 10, "max"} (it matches the human
  // selector), so a bulk buy is expressed as the largest allowed step ≤ what
  // we want — or "max" when we want everything the bank can take. Successive
  // passes walk the rest. The dev garden takes any exact count.
  function sendBuy(i, n) {
    if (!ui.worldMode) { ui.buyBuilding(i, n); return n; }
    if (n >= affordableCount(i)) { ui.buyBuilding(i, 'max'); return n; }
    const step = n >= 10 ? 10 : n >= 5 ? 5 : 1;
    ui.buyBuilding(i, step);
    return step;
  }

  function takeAction() {
    const base = effective();

    // 1. greet whoever is in the patch — rabbits pay, the tin rabbit writes
    //    an Almanac page, and the stall is a positive-expectation gamble
    const guest = ui.visitor || ui.rabbit;
    if (CFG.visitors && guest && !guest.gone && canSend()) {
      if (guest.kind !== 'parsnip' || CFG.parsnip) {
        spend();
        (ui.catchVisitor || ui.catchRabbit).call(ui);
        stats.visitors++;
        lastAction = `greeted the ${guest.kind || 'rabbit'}`;
        return true;
      }
    }

    // 2. spend sprouts (own currency, own race)
    if (CFG.shed && canSend()) {
      const best = shedOptions(base).sort((a, b) => a.pay - b.pay)[0];
      if (best) {
        spend();
        ui.buyShed(best.id);
        stats.sheds++;
        lastAction = `planted ${best.name}`;
        if (ui.worldMode) core.sprouts -= best.cost;   // same optimism as carrots
        return true;
      }
    }

    // 3. every affordable upgrade, cheapest first — one-off and permanent,
    //    so they are never in competition with buildings
    if (CFG.upgrades && canSend()) {
      const up = nextUpgrade();
      if (up) {
        spend();
        ui.buyUpgrade(up.id);
        stats.upgrades++;
        lastAction = `bought ${up.name}`;
        // world mode only sends an intent, so nothing has left the bank yet:
        // deduct optimistically or the next pass spends the same carrots
        // twice. The snapshot corrects us within a second either way.
        if (ui.worldMode) core.bank -= up.cost;
        return true;
      }
    }

    // 4. buildings: best value, bought in bulk
    if (CFG.buildings && canSend()) {
      const pick = bestBuilding(base);
      if (pick) {
        spend();
        const got = sendBuy(pick.i, pick.n);
        stats.buys++;
        lastAction = `bought ${got}× ${CC.BUILDINGS[pick.i].name}`;
        if (ui.worldMode) core.bank -= core.costOf(pick.i, got);
        return true;
      }
    }

    // 5. going to seed — only if the gardener explicitly allowed it
    if (CFG.prestige && canSend()) {
      const pending = core.pendingSeeds();
      if (pending >= 1 && pending >= Math.max(1, core.seeds) * CFG.prestigeAt) {
        spend();
        if (ui.worldMode) ui.patch.send({ type: 'prestige' });
        else { core.prestige(); ui.save && ui.save(); }
        stats.prestiges++;
        lastAction = `sent the garden to seed (+${fmt(pending)})`;
        return true;
      }
    }

    lastAction = 'saving up — nothing affordable yet';
    return false;
  }

  /* ---------- panel ---------- */

  function buildPanel() {
    const box = document.createElement('div');
    box.id = 'autogardener';
    box.innerHTML = `
      <style>
        #autogardener { position: fixed; left: 10px; bottom: 10px; z-index: 40;
          width: 216px; font: 12px/1.45 system-ui, sans-serif; color: #f3e9d6;
          background: linear-gradient(180deg, rgba(46,34,19,0.96), rgba(24,17,8,0.96));
          border: 1px solid #241708; border-radius: 6px;
          box-shadow: 0 6px 18px rgba(0,0,0,0.5); user-select: none; }
        #autogardener h4 { margin: 0; padding: 7px 10px; font-size: 12px; letter-spacing: 0.08em;
          background: linear-gradient(180deg, #4a3621, #382714); border-radius: 5px 5px 0 0;
          cursor: pointer; display: flex; justify-content: space-between; align-items: center; }
        #autogardener .ag-body { padding: 8px 10px 10px; }
        #autogardener .ag-row { display: flex; justify-content: space-between; align-items: center;
          gap: 6px; padding: 2px 0; }
        #autogardener label { cursor: pointer; }
        #autogardener input[type=number] { width: 52px; background: #1c1409; color: #f3e9d6;
          border: 1px solid #4a3621; border-radius: 3px; padding: 1px 4px; font: inherit; }
        #autogardener .ag-doing { margin-top: 6px; padding-top: 6px; border-top: 1px dashed rgba(200,170,120,0.3);
          color: #ffd98a; min-height: 30px; }
        #autogardener .ag-stats { color: #c0ac88; font-size: 11px; margin-top: 4px;
          font-variant-numeric: tabular-nums; }
        #autogardener .ag-danger { color: #f0a0a0; }
        #autogardener.ag-off h4 { filter: grayscale(0.7); }
        #autogardener.ag-collapsed .ag-body { display: none; }
      </style>
      <h4><span>🥕 AUTOGARDENER</span><span class="ag-toggle">▾</span></h4>
      <div class="ag-body">
        <div class="ag-row"><label><input type="checkbox" data-k="click"> click</label>
          <input type="number" data-k="clickRate" min="0" max="1000" step="1"></div>
        <div class="ag-row"><label><input type="checkbox" data-k="buildings"> buildings</label>
          <label><input type="checkbox" data-k="upgrades"> upgrades</label></div>
        <div class="ag-row"><label><input type="checkbox" data-k="shed"> shed</label>
          <label><input type="checkbox" data-k="visitors"> visitors</label></div>
        <div class="ag-row"><label><input type="checkbox" data-k="parsnip"> take the stall's gamble</label></div>
        <div class="ag-row ag-danger"><label title="Going to Seed resets the garden for every player on Earth">
          <input type="checkbox" data-k="prestige"> go to seed (whole world!)</label></div>
        <div class="ag-doing"></div>
        <div class="ag-stats"></div>
      </div>`;
    document.body.appendChild(box);

    box.querySelector('h4').addEventListener('click', () => {
      box.classList.toggle('ag-collapsed');
      box.querySelector('.ag-toggle').textContent = box.classList.contains('ag-collapsed') ? '▸' : '▾';
    });
    for (const el of box.querySelectorAll('[data-k]')) {
      const k = el.dataset.k;
      if (el.type === 'checkbox') el.checked = !!CFG[k]; else el.value = CFG[k];
      el.addEventListener('change', () => {
        CFG[k] = el.type === 'checkbox' ? el.checked : Math.max(0, +el.value || 0);
        if (k === 'click' && CFG.click && ui) ui.autoClick = false;  // don't double up
        saveCfg();
      });
    }
    return box;
  }

  /* ---------- boot ---------- */

  function start() {
    ui = W.game; core = ui.core; CC = W.CC;
    const box = buildPanel();
    const doing = box.querySelector('.ag-doing');
    const statLine = box.querySelector('.ag-stats');
    if (CFG.click) ui.autoClick = false;   // this script does the clicking

    let acc = 0;
    setInterval(() => {                     // clicking, paced locally
      if (!ready()) return;
      if (!CFG.click) return;
      acc += CFG.clickRate / 10;
      const n = Math.floor(acc);
      acc -= n;
      if (n > 0) doClicks(n);
    }, 100);

    setInterval(() => {                     // deciding
      if (!ready()) { lastAction = 'reaching the carrot patch…'; return; }
      try {
        for (let k = 0; k < CFG.actionsPerTick; k++) {
          if (!canSend() || !takeAction()) break;
        }
      } catch (e) { lastAction = 'error: ' + e.message; console.error('[autogardener]', e); }
    }, CFG.decisionMs);

    setInterval(() => {                     // reporting
      doing.textContent = lastAction;
      statLine.textContent =
        `${fmt(stats.clicks)} clicks · ${stats.buys} buys · ${stats.upgrades} upgrades` +
        (stats.sheds ? ` · ${stats.sheds} planted` : '') +
        (stats.visitors ? ` · ${stats.visitors} greeted` : '') +
        (stats.prestiges ? ` · ${stats.prestiges} springs` : '');
    }, 500);

    console.log('[autogardener] tending the patch. Config:', CFG);
  }

  const ready = () => ui && core && !(ui.awaitingWorld && ui.awaitingWorld());

  (function wait() {
    if (W.game && W.game.core && W.CC && document.body) start();
    else setTimeout(wait, 400);
  })();
})();
