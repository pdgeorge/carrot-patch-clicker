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
         Pre-R19 servers only speak rabbitTtl — treat that as a golden one. */
      const vis = msg.visitor || (msg.rabbitTtl > 0 ? { kind: 'rabbit', ttl: msg.rabbitTtl } : null);
      if (vis && vis.ttl > 0 && !ui.visitor) {
        ui.spawnVisitor(vis.kind, vis.ttl, true /* quiet: a resync, not an arrival */);
      } else if (vis && vis.ttl > 0 && ui.visitor && ui.visitor.kind === vis.kind) {
        /* stay in step with the world's clock so the leaving-warning is timely */
        ui.visitor.patchTtl = vis.ttl;
        ui.visitor.born = ui.t;
      } else if (!vis && ui.visitor && !ui.visitor.leaving) {
        /* caught elsewhere or expired: bound away gracefully, don't blink out */
        ui.visitor.leaving = true;
        ui.visitor.dir = ui.visitor.x < 160 ? -1 : 1;
      }
      ui.updatePatchLine();
    } else if (msg.type === 'event') {
      /* structured world event (F1): ui decides words, sound, pixels */
      ui.patchEvent(msg.ev || {});
    } else if (msg.type === 'name') {
      ui.nameResult(msg);
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
