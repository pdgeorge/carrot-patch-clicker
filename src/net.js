/* Carrot Patch client — connects the clicker to a shared world server.
   Only activates when the page is served over http(s) and a same-origin
   /ws endpoint answers; on file://, artifacts, or plain static hosting the
   game silently stays single-player.

   Clicks are batched: they apply locally instantly for feel, accumulate in
   a counter, and flush as ONE message per second — an auto-clicker costs
   the same bandwidth as a patient human. The server clamps rates anyway. */
globalThis.CC = globalThis.CC || {};

CC.Patch = class {
  constructor(ui) {
    this.ui = ui;
    this.core = ui.core;
    this.on = false;
    this.pending = 0;
    this.online = 0;
    this.clickRate = 0;
    this._tried = false;
    if (!location.protocol.startsWith('http')) return;
    this.connect();
    setInterval(() => this.flush(), 1000);
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
      this.ui.setPatchMode(true);
      if (first) this.ui.toast('🌍 Connected to the CARROT PATCH — one garden, whole world.');
      else this.ui.toast('🌍 Reconnected to the patch.');
    };
    ws.onmessage = e => {
      let msg;
      try { msg = JSON.parse(e.data); } catch (err) { return; }
      this.handle(msg);
    };
    ws.onclose = () => {
      const was = this.on;
      this.on = false;
      if (was) {
        this.ui.setPatchMode(false);
        this.ui.toast('🌍 Lost the patch — retrying…');
      }
      if (this._tried) {
        /* we had a server once: keep trying, it may just be restarting */
        setTimeout(() => this.connect(), 4000);
      } else {
        /* never connected: probably plain static hosting — try thrice, then stay solo */
        this._attempts = (this._attempts || 0) + 1;
        if (this._attempts < 3) setTimeout(() => this.connect(), 5000);
      }
    };
    ws.onerror = () => { try { ws.close(); } catch (e) { /* already closed */ } };
  }

  handle(msg) {
    const c = this.core, ui = this.ui;
    if (msg.type === 'snapshot') {
      const s = msg.state;
      c.bank = s.bank;
      c.totalAllTime = s.totalAllTime;
      c.totalRun = s.totalRun;
      c.clicks = s.clicks;
      c.owned = s.owned.slice();
      c.bought = s.bought;
      c.seeds = s.seeds;
      c.buffs = s.buffs.map(b => ({ ...b }));
      c._ribbonCount = c.ribbons().length;
      c._bumperSeen = CC.BUILDINGS.map((_, i) => c.bumperCount(i));
      this.online = msg.online;
      this.clickRate = msg.clickRate;
      /* the golden rabbit is global: server says whether one is loose */
      if (msg.rabbitTtl > 0 && !ui.rabbit) {
        ui.rabbit = { x: -30, y: ui.soilY - 14, dir: 1, born: ui.t, patchTtl: msg.rabbitTtl };
      } else if (msg.rabbitTtl <= 0 && ui.rabbit) {
        ui.rabbit = null;
      }
      ui.updatePatchLine();
    } else if (msg.type === 'toast') {
      ui.toast(msg.text);
      if (msg.text.startsWith('🌸')) CC.audio.seed();
      else if (msg.text.startsWith('🐇')) CC.audio.rabbit();
    } else if (msg.type === 'rabbit') {
      ui.rabbit = { x: -30, y: ui.soilY - 14, dir: 1, born: ui.t, patchTtl: msg.ttl };
      ui.toast('🐇 A golden rabbit is loose in the patch — first click catches it!');
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
