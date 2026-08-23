/* Carrot Patch client — connects the clicker to a shared world server.

   A served page (http/https) is ALWAYS the world game (DESIGN P6): if the
   server can't be reached the client shows a waiting state and redials
   forever — it never falls back to a private solo garden. The private solo
   game exists only on file:// (a dev tool; this class deactivates there).

   Clicks are batched: they apply locally instantly for feel, accumulate in
   a counter, and flush as ONE message per second — an auto-clicker costs
   the same bandwidth as a patient human. The server clamps rates anyway. */
globalThis.CC = globalThis.CC || {};

/* Staleness threshold (DESIGN R1): the server heartbeats a snapshot every
   second, so a healthy socket is never quiet this long. */
CC.PATCH_STALE_MS = 5000;

CC.Patch = class {
  constructor(ui) {
    this.ui = ui;
    this.core = ui.core;
    this.on = false;
    this.pending = 0;
    this.online = 0;
    this.clickRate = 0;
    this._tried = false;
    this._lastMsg = 0;
    this._retryTimer = null;
    this.everSynced = false; /* first snapshot received — the world is loaded */
    this.order = null;       /* R21: the Parish Order on the board, or null */
    this.orders = [];        /* R24 Wider Orders: every card on the board */
    this.bell = null;        /* R24: Lie Fallow's bell while it rings */
    this.market = null;      /* R21: {active, next, end} — the Market Hour clock */
    this.skew = 0;           /* server wall clock minus ours: deadlines never trust the tab */
    if (!location.protocol.startsWith('http')) return;
    this.connect();
    setInterval(() => this.flush(), 1000);
    /* Silent socket death (laptop sleep, dropped Wi-Fi) never fires
       onclose — the watchdog notices the missing heartbeat and redials.
       Also runs the instant the tab becomes visible again. */
    setInterval(() => this.watchdog(), 2000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.watchdog();
    });
  }

  wsUrl() {
    const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    const dir = location.pathname.replace(/[^/]*$/, '');
    return proto + location.host + dir + 'ws';
  }

  connect() {
    let ws;
    try { ws = new WebSocket(this.wsUrl()); } catch (e) { return; }
    this.ws = ws;
    ws.onopen = () => {
      const first = !this._tried;
      this._tried = true;
      this.on = true;
      this._lastMsg = performance.now();
      this.ui.setPatchMode(true);
      if (first) this.ui.toast('🌍 Connected to the CARROT PATCH — one garden, whole world.');
      else this.ui.toast('🌍 Reconnected to the patch.');
      /* re-sign the noticeboard silently so tallies keep landing (R11) */
      const nm = this.ui.pref('carrot-tender-name');
      if (nm) this.send({ type: 'name', name: nm });
    };
    ws.onmessage = e => {
      this._lastMsg = performance.now();
      let msg;
      try { msg = JSON.parse(e.data); } catch (err) { return; }
      this.handle(msg);
    };
    ws.onclose = () => {
      const was = this.on;
      this.on = false;
      if (was) {
        this.ui.setPatchResync();
        this.ui.toast('🌍 Lost the patch — re-syncing…');
      }
      /* a served page never falls back to solo (P6): redial forever —
         the server may just be restarting, or the proxy may come good */
      this._retryTimer = setTimeout(() => { this._retryTimer = null; this.connect(); }, 4000);
    };
    ws.onerror = () => { try { ws.close(); } catch (e) { /* already closed */ } };
  }

  /* R1 staleness watchdog: a healthy server talks every second; silence
     past CC.PATCH_STALE_MS means the socket died without telling us. */
  watchdog() {
    if (this.on) {
      if (performance.now() - this._lastMsg > CC.PATCH_STALE_MS) {
        this.ui.toast('🌍 Patch gone quiet — re-syncing…');
        this.redial();
      }
    } else if (!this._retryTimer && (!this.ws || this.ws.readyState === 3)) {
      /* tab woke up after a scheduled retry already came and went */
      this.redial();
    }
  }

  redial() {
    if (this._retryTimer) { clearTimeout(this._retryTimer); this._retryTimer = null; }
    if (this.ws) {
      this.ws.onclose = null; /* we're taking over the reconnect */
      try { this.ws.close(); } catch (e) { /* already closed */ }
    }
    if (this.on) {
      this.on = false;
      this.ui.setPatchResync();
    }
    this.connect(); /* fresh socket ⇒ fresh snapshot ⇒ re-synced (P5) */
  }

  handle(msg) {
    const c = this.core, ui = this.ui;
    if (msg.type === 'snapshot') {
      this.everSynced = true;
      const s = msg.state;
      c.bank = s.bank;
      c.totalRun = s.totalRun;          /* before totalAllTime: its setter derives lifetimeBase from the run */
      c.totalAllTime = s.totalAllTime;
      c.clicks = s.clicks;
      c.owned = s.owned.slice();
      c.bought = s.bought;
      c.seeds = s.seeds;
      /* pre-R13 server: mirror the save migration (sprouts backlog = seeds) */
      c.sprouts = s.sprouts !== undefined ? s.sprouts : (s.seeds || 0);
      c.shed = s.shed || {};
      c.prestiges = s.prestiges || 0;   /* R15 counters gate keystone visibility */
      c.rabbits = s.rabbits || 0;
      c.sproutsSpent = s.sproutsSpent || 0;
      c.almanac = s.almanac || {};      /* R16: the server's book is the book */
      c.season = s.season || 'homestead'; /* R17: one world, one season */
      this.seasonEnds = s.seasonEnds || 0;
      c.buffs = s.buffs.map(b => ({ ...b }));
      c._ribbonCount = c.ribbons().length;
      c._bumperSeen = CC.BUILDINGS.map((_, i) => c.bumperCount(i));
      this.online = msg.online;
      this.clickRate = msg.clickRate;
      /* visitors are global (R19): the server says who is in the patch.
         Pre-R19 servers only speak rabbitTtl — treat that as a golden one.
         The snapshot always arrives BEFORE the spawn event, so ARRIVAL is
         detected here: loud when the previous snapshot showed an empty
         patch, quiet on joins/resyncs mid-visit (review F1). */
      const vis = msg.visitor || (msg.rabbitTtl > 0 ? { kind: 'rabbit', ttl: msg.rabbitTtl } : null);
      const v = ui.visitor;
      if (vis && vis.ttl > 0) {
        if (v && v.gone) {
          /* dismissed locally (caught / walked off); wait for the server */
        } else if (!v) {
          ui.spawnVisitor(vis.kind, vis.ttl, !this._patchWasEmpty);
        } else if (v.kind !== vis.kind) {
          /* swapped while this tab looked away (hidden tabs pause rAF) —
             never leave a stale sprite that clicks into the wrong gamble */
          ui.spawnVisitor(vis.kind, vis.ttl, false);
        } else {
          v.patchTtl = vis.ttl;
          v.born = ui.t; /* stay in step with the world's clock */
        }
      } else if (v) {
        if (v.gone) ui.visitor = null;            /* the server agrees it's over */
        else if (!v.leaving) {                    /* caught elsewhere or expired */
          v.leaving = true;
          v.dir = v.x < 160 ? -1 : 1;
        }
      }
      this._patchWasEmpty = !vis;
      c.tins = s.tins || 0;                       /* mirror the R19 counters */
      c.stalls = s.stalls || 0;
      c.weathers = s.weathers || 0;
      /* the Parish (R21): honey is a balance, the rest are the server's
         readings of its own clocks — a pre-R21 server leaves them neutral */
      c.honey = s.honey || 0;
      c.handsBonus = s.handsBonus || 1;
      c.marketHour = !!s.marketHour;
      /* Trials (R22): the rule, the ledger and the perks are the server's */
      c.trial = s.trial ? { ...s.trial } : null;
      c.trialsDone = s.trialsDone || {};
      c.trialBest = s.trialBest || {};
      c.runBest = s.runBest || 0;
      c.runT = s.runT || 0;
      c.perks = s.perks ? { cap: {}, ...s.perks } : CC.Core.freshPerks();
      c.haltT = s.haltT || 0;
      /* Lie Fallow (R24): loam, the Cellar, the bell */
      c.loam = s.loam || 0;
      c.cellar = s.cellar || {};
      c.fallows = s.fallows || 0;
      c.rehearsed = !!s.rehearsed;
      this.orders = msg.orders || (msg.order ? [msg.order] : []);
      this.bell = msg.bell || null;
      this.bellRest = msg.bellRest || 0;
      /* the Seed Bed (R23): the server's bed is the bed */
      if (s.bed) {
        c.bed = { ...s.bed, plots: (s.bed.plots || []).map(p => p && { ...p }), log: { ...(s.bed.log || {}) } };
        c.bedT = s.bedT || 0;
        c.sacrifices = s.sacrifices || 0;
      }
      /* the Quilt (R22): diffs ride as events; a version gap means a refetch */
      if (msg.quiltV !== undefined && msg.quiltV > ui.quilt.v) ui.fetchQuilt();
      this.order = msg.order || null;
      this.market = msg.market || null;
      if (msg.now) this.skew = msg.now - Date.now() / 1000;
      ui.updatePatchLine();
      ui.whileAway();
    } else if (msg.type === 'event') {
      /* structured world event (F1): ui decides words, sound, pixels */
      ui.patchEvent(msg.ev || {});
    } else if (msg.type === 'name') {
      ui.nameResult(msg);
    } else if (msg.type === 'plant') {
      ui.plantResult(msg); /* the trowel locks only on a seed that landed (R24 review) */
    } else if (msg.type === 'toast') {
      /* legacy prose for pre-F1 clients — this client renders 'event'
         instead; ignoring avoids double toasts during the transition */
    } else if (msg.type === 'visitor') {
      if (!ui.visitor) ui.spawnVisitor(msg.kind, msg.ttl);
    } else if (msg.type === 'rabbit') {
      /* legacy spawn from a pre-R19 server (new servers send 'visitor'
         first, so this stays a no-op for them) */
      if (!ui.visitor) ui.spawnVisitor('rabbit', msg.ttl);
    }
  }

  send(obj) {
    if (this.on && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  /* one message per second, no matter how fast anyone clicks */
  flush() {
    if (this.pending > 0) {
      this.send({ type: 'clicks', n: this.pending });
      this.pending = 0;
    }
  }
};
