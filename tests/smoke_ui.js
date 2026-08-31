#!/usr/bin/env node
/* UI smoke test: boot the BUILT page headless in the dev garden and click
   every modal opener. This is the net the openModal() recursion slipped
   through — node --check and the engine suites cannot see a dead click
   handler. Needs chromium; skips (exit 0) when it is missing, so CI
   without a browser stays green. Run: node tests/smoke_ui.js */
const { spawnSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

if (spawnSync('chromium', ['--version'], { stdio: 'ignore' }).error) {
  console.log('smoke_ui: chromium not found — skipped');
  process.exit(0);
}
const dist = path.join(__dirname, '..', 'carrot_patch', 'dist', 'clicker.html');
if (!fs.existsSync(dist)) { console.error('smoke_ui: run `node build.js` first'); process.exit(1); }

let fails = 0;
const check = (cond, msg) => { fails += cond ? 0 : 1; console.log(`  ${cond ? '✓' : '✗ FAIL:'} ${msg}`); };

const port = 9700 + Math.floor(Math.random() * 200);
const profile = path.join(require('os').tmpdir(), 'cc-smoke-' + port);
const chrome = spawn('chromium', ['--headless=new', '--no-sandbox', '--disable-gpu',
  `--remote-debugging-port=${port}`, '--window-size=1280,1200', '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let targets;
  for (let i = 0; i < 60 && !targets; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch (e) { await sleep(200); } }
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const waiting = {}; const exceptions = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && waiting[m.id]) { waiting[m.id](m); delete waiting[m.id]; }
    if (m.method === 'Runtime.exceptionThrown') exceptions.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0]);
  };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; waiting[i] = res; ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error((r.result.exceptionDetails.exception?.description || 'eval failed').split('\n')[0]);
    return r.result.result.value;
  };
  await send('Runtime.enable');
  await send('Page.enable');
  /* the DEV GARDEN (file://): no server needed; grant enough for every button */
  await send('Page.navigate', { url: 'file://' + dist + '?grant=1e9&sprouts=1e9' });
  await sleep(2500);

  console.log('=== smoke: the page boots ===');
  check(await ev('typeof game === "object" && game.t > 0'), 'the frame loop is running');
  await ev('game.core.seeds = 2e22; game.core.lifetimeBase = 5e50; game.core.totalRun = 1e9;'); /* live-scale: bell + prestige visible */
  await sleep(300);

  console.log('=== smoke: every modal opener opens its modal ===');
  const modalOpens = async (btn, label) => {
    await ev(`document.getElementById('modal').classList.add('hidden')`);
    await ev(`document.getElementById('${btn}').click()`);
    const open = await ev(`!document.getElementById('modal').classList.contains('hidden')`);
    check(open, `${label} opens the confirm modal`);
    await ev(`document.getElementById('modal-no').click()`);
  };
  await modalOpens('prestige-btn', 'Go to Seed');
  await modalOpens('bell-btn', 'Ring the bell');
  await ev('for (const p of CC.PLANTS) game.core.bed.log[p.id] = 1; game.updateDOM();');
  await modalOpens('sacrifice-btn', 'the Sacrifice');

  console.log('=== smoke: the other overlays ===');
  await ev(`document.getElementById('shed-btn').click()`);
  check(await ev(`!document.getElementById('shed').classList.contains('hidden')`), 'the Potting Shed opens');
  await ev(`document.querySelector('#shed-tabs [data-tab="stall"]').click()`);
  check(await ev(`!document.getElementById('stall-pane').classList.contains('hidden')
    && document.querySelectorAll('#stall-items .shed-item').length >= 10`), 'the Honey Stall tab shows its charms');
  await ev(`document.querySelector('#shed-tabs [data-tab="cellar"]').click()`);
  check(await ev(`document.querySelectorAll('#cellar-items .cellar-shelf').length === 3
    && document.querySelectorAll('#cellar-items .shed-item.locked').length > 0`), 'the Cellar shows three shelves, the deep ones locked');
  await ev(`document.getElementById('shed-close').click()`);
  await ev(`(() => { const b = game.$('bed'), r = b.getBoundingClientRect();
    b.dispatchEvent(new PointerEvent('pointerdown', { clientX: r.left + 20, clientY: r.top + 20, bubbles: true })); })()`);
  await sleep(100);
  check(await ev(`!document.getElementById('bed-menu').classList.contains('hidden')`), 'an empty plot opens the planting menu');

  check(await ev(`['clover4','sugar','rainjar','picnic','candle','gnome','bunting','tophat','chimes','cat',
    'coldframe','hive','drill','press','tierlock'].every(id => CC.ART.parts(id).length > 0)`),
    'every R25 symbol is on the sheet and drawable');
  await ev(`(() => { game.core.honey = 500; ['gnome','bunting','tophat','chimes'].forEach(id => game.core.buyCharm(id)); })()`);
  /* the cat buys through the CARD, not the engine — a dead stall click must fail here */
  await ev(`document.getElementById('shed-btn').click();
    document.querySelector('#shed-tabs [data-tab="stall"]').click();`);
  await sleep(200);
  await ev(`document.querySelectorAll('#stall-items .shed-item')[CC.CHARMS.findIndex(c => c.id === 'cat')].click()`);
  await ev(`document.getElementById('shed-close').click()`);
  await sleep(700);
  check(await ev(`game.core.charmCount('cat') === 1`), 'the keepsakes buy in the dev garden — the cat through its stall card');

  await sleep(500);
  const fatal = exceptions.filter(x => !/favicon/.test(x));
  check(fatal.length === 0, `no uncaught exceptions (${fatal.slice(0, 3).join(' | ') || 'none'})`);

  console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL CHECKS PASSED');
  chrome.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { }
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('smoke_ui:', e.message); chrome.kill(); process.exit(1); });
