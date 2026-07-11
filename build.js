#!/usr/bin/env node
/* Builds the Carrot Patch client from src/ into carrot_patch/dist/:
   - clicker.html      : the full self-contained game page the server serves
   - patch-data.json   : game data exported for the Python economy, so the
                         client and server can never disagree about numbers */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const SRC = path.join(__dirname, 'src');
const OUT = path.join(__dirname, 'carrot_patch', 'dist');
const read = f => fs.readFileSync(path.join(SRC, f), 'utf8');

/* Build id: content hash of everything that deploys. Deterministic on
   purpose — CI rebuilds dist and diffs it against the commit, so the id
   must depend only on the sources, never on a clock or git state. */
const BUILD_INPUTS = [
  'build.js',
  'src/styles.css', 'src/page.html',
  'src/data.js', 'src/core.js', 'src/net.js', 'src/ui.js',
  'carrot_patch/__init__.py', 'carrot_patch/economy.py', 'carrot_patch/main.py',
];
const hash = crypto.createHash('sha256');
for (const f of BUILD_INPUTS) hash.update(fs.readFileSync(path.join(__dirname, f)));
const BUILD = hash.digest('hex').slice(0, 7);

const JS_ORDER = ['data.js', 'core.js', 'net.js', 'ui.js'];
const css = read('styles.css');
const js = `globalThis.CC = globalThis.CC || {}; CC.BUILD = '${BUILD}';\n`
  + JS_ORDER.map(f => `/* ==== ${f} ==== */\n${read(f)}`).join('\n');
const body = read('page.html');

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Carrot Clicker</title>
<style>
html, body { margin: 0; padding: 0; }
${css}
</style>
</head>
<body>
${body}
<script>
${js}
</script>
</body>
</html>
`;

const sandbox = vm.createContext({});
vm.runInContext(read('data.js'), sandbox);
const CC = sandbox.CC;
const data = JSON.stringify({
  buildings: CC.BUILDINGS, tiers: CC.TIERS,
  clickUpgrades: CC.CLICK_UPGRADES, globalUpgrades: CC.GLOBAL_UPGRADES,
  synergyUpgrades: CC.SYNERGY_UPGRADES,
  milestones: CC.MILESTONES, milestoneMult: CC.MILESTONE_MULT,
  ribbons: CC.RIBBONS,
}, null, 1);

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'clicker.html'), page);
fs.writeFileSync(path.join(OUT, 'patch-data.json'), data);
console.log(`built carrot_patch/dist/clicker.html (${(page.length / 1024).toFixed(0)} KB) and patch-data.json — build ${BUILD}`);
