// Static server for the dressing-room viewer: serves C:\MMO Build (viewer/, extracted/, tables/) read-only.
//   node viewer/serve.cjs [port]        then open http://localhost:8790/
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const port = Number(process.argv[2] || 8790);
let statusEngine = null;
const status = () => statusEngine || (statusEngine = require('./status-engine.cjs'));
const mime = { '.jpg': 'image/jpeg', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.csv': 'text/csv; charset=utf-8', '.css': 'text/css' };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  // the NPC placement page saves here (this PC only: the server listens on 127.0.0.1); keeps one backup
  if (req.method === 'POST' && p === '/api/npc-spots') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 5e6) req.destroy(); });
    req.on('end', () => {
      try {
        const j = JSON.parse(body);
        if (!j || typeof j.maps !== 'object') throw new Error('no maps');
        const f = path.join(root, 'UE', 'DemoData', 'npc-spots.json');
        if (fs.existsSync(f)) fs.copyFileSync(f, f + '.bak');
        fs.writeFileSync(f, JSON.stringify(j, null, 1), 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}');
      } catch (e) { res.writeHead(400); res.end(String(e.message)); }
    });
    return;
  }
  // a page saves its own rendered picture (reference renders): only .png files under handoff/remake/, this PC only
  if (req.method === 'POST' && p === '/api/save-image') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 4e7) req.destroy(); });
    req.on('end', () => {
      try {
        const j = JSON.parse(body);
        const file = path.normalize(path.join(root, 'handoff', 'remake', String(j.path || '')));
        if (!file.startsWith(path.join(root, 'handoff', 'remake') + path.sep) || !file.toLowerCase().endsWith('.png')) throw new Error('bad path');
        const m = /^data:image\/png;base64,(.+)$/.exec(String(j.dataUrl || ''));
        if (!m) throw new Error('not a png data url');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, Buffer.from(m[1], 'base64'));
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}');
      } catch (e) { res.writeHead(400); res.end(String(e.message)); }
    });
    return;
  }
  // the status sheet: the game server's own stat code (viewer/status-engine.cjs) on the dressing room's character
  if (p === '/api/status-meta' && req.method === 'GET') {
    try { const j = JSON.stringify(status().meta()); res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(j); }
    catch (e) { res.writeHead(500); return res.end(String(e.stack || e)); }
  }
  if (req.method === 'POST' && p === '/api/status') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try { const j = JSON.stringify(status().compute(JSON.parse(body))); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(j); }
      catch (e) { res.writeHead(400); res.end(String(e.stack || e)); }
    });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  // the page uses relative paths (app.js, data/…), so it must be served from under /viewer/
  if (p === '/' || p === '/viewer' || p === '/index.html') { res.writeHead(302, { Location: '/viewer/' }); return res.end(); }
  if (p === '/viewer/') p = '/viewer/index.html';
  const file = path.normalize(path.join(root, p));
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('not found: ' + p); }
    res.writeHead(200, { 'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}).listen(port, '127.0.0.1', () => console.log(`dressing room (this PC only): http://localhost:${port}/`));
