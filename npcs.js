// NPC placement page: the client's own area maps with every recorded NPC as a draggable dot, coloured by role.
// Data: UE/DemoData/npc-spots.json (x, z in the map's glb metres) and minimaps.json (the client's sheet formula
// px = 512*f1 + f3*x, py = 512*f2 + f3*z). Save writes npc-spots.json through viewer/serve.cjs (this PC only).
'use strict';
const ROLES = {
  'vendor': '#f2b84b', 'repairer': '#ff7a45', 'guild master': '#c77dff', 'banker': '#4cc9f0', 'trainer': '#80ed99',
  'quest giver': '#ffd6a5', 'guide': '#a0c4ff', 'guard': '#adb5bd', 'soul binder': '#ff8fab', 'villager': '#6c757d', 'pet': '#495057', '': '#ffffff',
};
const MAPNAMES = { 10000: 'Bisque: Northwest', 10200: 'Bisque: Central', 10300: 'Bisque: West', 10500: 'Bisque: East', 9000: 'Bisque Port', 10600: 'Bisque Waterway',
  6000: 'Neok Mountain', 6200: 'Neok Highland', 8000: 'Mutum Cemetery', 8100: 'Mutum Catacomb', 17000: 'Nubur Village', 19000: 'Hidden Village Neya' };
const $ = (id) => document.getElementById(id);
let spots, mm, pts = {}, cur = null, sel = null, adding = false, dirty = false;
const SNAP_M = 3;   // dropping an NPC within this many metres of a client spawn point puts it exactly on the point

async function load() {
  spots = await (await fetch('/UE/DemoData/npc-spots.json', { cache: 'no-store' })).json();
  mm = (await (await fetch('/UE/DemoData/minimaps.json', { cache: 'no-store' })).json()).maps;
  pts = (await (await fetch('/UE/DemoData/spawn-points.json', { cache: 'no-store' })).json()).maps;
  for (const id of Object.keys(mm)) { spots.maps[id] = spots.maps[id] || []; }
  const ids = Object.keys(mm).sort((a, b) => (MAPNAMES[a] || a).localeCompare(MAPNAMES[b] || b));
  $('map').innerHTML = ids.map((id) => `<option value="${id}">${MAPNAMES[id] || id}  (${spots.maps[id].length})</option>`).join('');
  $('rolefilter').innerHTML += Object.keys(ROLES).filter(Boolean).map((r) => `<option>${r}</option>`).join('');
  $('f_role').innerHTML = Object.keys(ROLES).map((r) => `<option value="${r}">${r || '(unknown)'}</option>`).join('');
  $('legend').innerHTML = Object.entries(ROLES).filter(([r]) => r).map(([r, c]) => `<span><i class="dot" style="background:${c}"></i>${r}</span>`).join('');
  const best = ids.reduce((a, b) => (spots.maps[b].length > spots.maps[a].length ? b : a), ids[0]);
  $('map').value = best;
  showMap(best);
}

const toPx = (m, s) => [(512 * m.f1 + m.f3 * s.x) / 512 * 100, (512 * m.f2 + m.f3 * s.z) / 512 * 100];   // % of the sheet
const fromPx = (m, px, py) => ({ x: +((px / 100 * 512 - 512 * m.f1) / m.f3).toFixed(1), z: +((py / 100 * 512 - 512 * m.f2) / m.f3).toFixed(1) });

function showMap(id) {
  cur = id; sel = null;
  $('sheet').src = `/renders/minimaps/${id}.png`;
  draw(); list(); edit();
}

function visible() { const f = $('rolefilter').value; return spots.maps[cur].filter((s) => !f || s.role === f); }

function nearestPoint(x, z) {
  let best = null, bd = 1e9;
  for (const p of pts[cur] || []) { if (p[1] !== 'spawn') continue; const d = Math.hypot(p[2] - x, p[4] - z); if (d < bd) { bd = d; best = p; } }
  return [best, bd];
}
function snap(s) {
  const [p, d] = nearestPoint(s.x, s.z);
  if (p && d <= SNAP_M) { s.x = p[2]; s.z = p[4]; s.y = p[3]; s.point = p[0]; } else { delete s.point; }
}

function draw() {
  const m = mm[cur];
  const used = new Set(spots.maps[cur].map((s) => s.point));
  const dots = $('showpts').checked ? (pts[cur] || []).map((p) => { const [x, y] = toPx(m, { x: p[2], z: p[4] }); return `<circle cx="${x}%" cy="${y}%" r="${used.has(p[0]) ? 0 : 2.6}" fill="${p[1] === 'water' ? '#e040fb' : '#3d8bff'}" opacity="0.85" pointer-events="none"/>`; }).join('') : '';
  $('svg').innerHTML = dots + visible().map((s) => {
    const [x, y] = toPx(m, s);
    const c = ROLES[s.role || ''] || '#fff';
    const on = s === sel;
    return `<g data-i="${spots.maps[cur].indexOf(s)}" style="cursor:grab">
      <circle cx="${x}%" cy="${y}%" r="${on ? 9 : 6}" fill="${c}" stroke="${on ? '#fff' : '#000'}" stroke-width="${on ? 2.5 : 1.5}"/>
      <text x="${x}%" y="${y}%" dx="10" dy="4" fill="#fff" stroke="#000" stroke-width="3" paint-order="stroke" font-size="12">${s.en || s.name}</text></g>`;
  }).join('');
}

function list() {
  const all = spots.maps[cur];
  $('list').innerHTML = visible().sort((a, b) => (a.role || 'zz').localeCompare(b.role || 'zz') || (a.en || '').localeCompare(b.en || ''))
    .map((s) => `<div data-i="${all.indexOf(s)}" class="${s === sel ? 'sel' : ''}"><i class="dot" style="background:${ROLES[s.role || ''] || '#fff'}"></i>
      <span>${s.en || s.name}<br><span class="muted">${s.role || 'role unknown'} · ${s.name}</span></span></div>`).join('') || '<span class="muted">None yet.</span>';
  const tot = {};
  for (const v of Object.values(spots.maps)) for (const s of v) tot[s.role || 'unknown'] = (tot[s.role || 'unknown'] || 0) + 1;
  $('totals').innerHTML = Object.entries(tot).sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r}: ${n}`).join('<br>');
  for (const o of $('map').options) o.text = `${MAPNAMES[o.value] || o.value}  (${spots.maps[o.value].length})`;
}

function edit() {
  $('none').hidden = !!sel; $('edit').hidden = !sel;
  if (!sel) return;
  $('f_name').value = sel.name || ''; $('f_en').value = sel.en || ''; $('f_role').value = sel.role || '';
  $('f_basis').value = sel.role_basis || ''; $('f_x').value = sel.x; $('f_z').value = sel.z; $('f_y').value = sel.y ?? ''; $('f_yaw').value = sel.yaw ?? '';
  $('f_note').value = sel.note || '';
  $('ptinfo').textContent = sel.point ? `On client spawn point #${sel.point} (exact spot and height).` : 'Not on a client spawn point: the spot is estimated from the recording. Drag it onto a blue dot if one is right.';
  $('src').textContent = sel.video ? `Recording ${sel.video} at ${Math.floor(sel.t / 60)}:${String(sel.t % 60).padStart(2, '0')}  (map match ${sel.match ?? '-'})` : 'Placed by hand.';
  $('frame').hidden = !sel.frame; if (sel.frame) $('frame').src = '/' + sel.frame;
}

function pick(i) { sel = spots.maps[cur][i]; draw(); list(); edit(); }
function changed() { dirty = true; $('status').textContent = 'Unsaved changes.'; draw(); list(); }

for (const [id, key, num] of [['f_name', 'name'], ['f_en', 'en'], ['f_role', 'role'], ['f_basis', 'role_basis'], ['f_note', 'note'], ['f_x', 'x', 1], ['f_z', 'z', 1], ['f_y', 'y', 1], ['f_yaw', 'yaw', 1]]) {
  $(id).addEventListener('input', () => { if (!sel) return; const v = $(id).value; sel[key] = num ? (v === '' ? undefined : +v) : v; changed(); });
}
$('map').onchange = () => showMap($('map').value);
$('rolefilter').onchange = () => { draw(); list(); };
$('list').onclick = (e) => { const d = e.target.closest('[data-i]'); if (d) pick(+d.dataset.i); };
$('del').onclick = () => { if (!sel || !confirm(`Delete ${sel.en || sel.name}?`)) return; spots.maps[cur].splice(spots.maps[cur].indexOf(sel), 1); sel = null; changed(); edit(); };
$('add').onclick = () => { adding = true; $('status').textContent = 'Click the map where the NPC stands.'; };

// drag dots; click the map to add
let drag = null;
const rel = (e) => { const r = $('svg').getBoundingClientRect(); return [(e.clientX - r.left) / r.width * 100, (e.clientY - r.top) / r.height * 100]; };
$('svg').addEventListener('pointerdown', (e) => {
  const g = e.target.closest('[data-i]');
  if (adding) {
    const [px, py] = rel(e);
    const s = Object.assign({ name: '', en: 'New NPC', role: '' }, fromPx(mm[cur], px, py));
    snap(s); spots.maps[cur].push(s); adding = false; sel = s; changed(); edit(); return;
  }
  if (!g) return;
  pick(+g.dataset.i); drag = sel; $('svg').setPointerCapture(e.pointerId);
});
$('svg').addEventListener('pointermove', (e) => { if (!drag) return; const [px, py] = rel(e); Object.assign(drag, fromPx(mm[cur], px, py)); $('f_x').value = drag.x; $('f_z').value = drag.z; dirty = true; draw(); });
$('svg').addEventListener('pointerup', () => { if (drag) { snap(drag); edit(); drag = null; changed(); } });
$('showpts').onchange = () => draw();

$('save').onclick = async () => {
  spots._note = spots._note || 'NPC spots (glb metres in each map frame) from the owner reference recordings, edited on viewer/npcs.html. Private.';
  const r = await fetch('/api/npc-spots', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(spots) });
  dirty = !r.ok; $('status').textContent = r.ok ? 'Saved. The game reads it on the next build.' : 'Save failed: ' + await r.text();
};
window.onbeforeunload = () => (dirty ? 'unsaved' : undefined);
load();


