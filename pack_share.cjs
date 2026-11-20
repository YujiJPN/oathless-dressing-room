// Builds a self-contained copy of the dressing room (着せ替え) that runs on another PC with Node.js only:
//   node viewer/pack_share.cjs <out folder>
// It copies the page, its data, every model / sheet / motion file the data names (extracted/), the server data the
// status panels read (UE/ServerData items / techniques / opcodes, UE/DemoData technic.json), the reference rules
// profile and the game server's stat code (our-game: rules/ without tests, server/active-effects.cjs, game-data.json),
// in the same layout as MMO Build, so serve.cjs and status-engine.cjs run unchanged.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const GAME = 'C:\\Claude Docs\\our-game';
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'share', 'dressing-room'));

let count = 0, bytes = 0;
function copy(src, rel) {
  const dst = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  count++; bytes += fs.statSync(src).size;
}

// the page
for (const f of ['index.html', 'app.js', 'status.js', 'op-ja.js', 'serve.cjs', 'status-engine.cjs']) copy(path.join(__dirname, f), path.join('viewer', f));
for (const f of fs.readdirSync(path.join(__dirname, 'data'))) copy(path.join(__dirname, 'data', f), path.join('viewer', 'data', f));

// the files the data names (app.js: MODELS / SHEETS / ANIMS, or an absolute /extracted/... path)
const DIRS = ['extracted/models', 'extracted/sheets', 'extracted/anims'];
const assets = new Set();
function walk(v) {
  if (typeof v === 'string') {
    if (!/\.(glb|png)$/i.test(v)) return;
    for (const d of DIRS) {
      const rel = v.startsWith('/') ? v.slice(1) : path.posix.join(d, v);
      if (fs.existsSync(path.join(ROOT, rel))) { assets.add(rel); return; }
    }
  } else if (Array.isArray(v)) v.forEach(walk);
  else if (v && typeof v === 'object') Object.values(v).forEach(walk);
}
for (const n of ['items', 'appearance', 'races', 'effects', 'icons']) walk(JSON.parse(fs.readFileSync(path.join(__dirname, 'data', n + '.json'), 'utf8')));
for (const rel of assets) copy(path.join(ROOT, rel), rel);

// the status panels' data and code
for (const f of ['items.json', 'techniques.json', 'technique-opcodes.json']) copy(path.join(ROOT, 'UE', 'ServerData', f), path.join('UE', 'ServerData', f));
copy(path.join(ROOT, 'UE', 'DemoData', 'technic.json'), path.join('UE', 'DemoData', 'technic.json'));
copy(path.join(ROOT, 'rules-profile', 'reference.cjs'), path.join('rules-profile', 'reference.cjs'));
for (const f of fs.readdirSync(path.join(GAME, 'rules'))) if (f.endsWith('.cjs') && !f.startsWith('test')) copy(path.join(GAME, 'rules', f), path.join('our-game', 'rules', f));
copy(path.join(GAME, 'server', 'active-effects.cjs'), path.join('our-game', 'server', 'active-effects.cjs'));
copy(path.join(GAME, 'game-data.json'), path.join('our-game', 'game-data.json'));

// how to start it
fs.writeFileSync(path.join(OUT, 'start.bat'), '@echo off\r\ncd /d "%~dp0"\r\nstart "" http://localhost:8790/\r\nnode viewer\\serve.cjs 8790\r\n');
fs.writeFileSync(path.join(OUT, 'README.md'), [
  '# 着せ替え',
  '',
  'Oathless のキャラクター着せ替え・ステータス・スキルシミュレーター・強化。',
  '',
  '## 起動',
  '',
  '1. Node.js（https://nodejs.org/ の LTS 版）をインストール',
  '2. `start.bat` をダブルクリック（またはこのフォルダで `node viewer/serve.cjs 8790`）',
  '3. ブラウザで http://localhost:8790/ が開きます',
  '',
  'このPCの中だけで動きます（外からは見えません）。3D表示の部品はインターネットから読み込みます。',
  '',
].join('\n'));
count += 2;
console.log(`${count} files, ${(bytes / 1e6).toFixed(1)} MB -> ${OUT}`);
