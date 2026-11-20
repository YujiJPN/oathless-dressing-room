// MoE zone viewer: shows the NHD zone/house geometry exported by tools/nhd2glb.py (extracted/zones/*.glb),
// textured with the zone's sheet where tables/zone-sheets.csv knows it. Served by viewer/serve.cjs.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const $ = (id) => document.getElementById(id);
const status = (t) => { $('status').textContent = t; };

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const head = lines[0].split(',');
  return lines.slice(1).map((l) => { const cells = l.split(','); const o = {}; head.forEach((h, i) => { o[h] = cells[i] ?? ''; }); return o; });
}
const catalog = parseCsv(await fetch('/extracted/zones/catalog.csv').then((r) => r.text()));
let zoneNames = {};
try {
  const zn = parseCsv(await fetch('/tables/zone-names.csv').then((r) => r.text()));
  for (const r of zn) zoneNames[r.id || r.zone_id] = r.name || r.name_jp || '';
} catch { /* optional */ }
const zones = catalog.filter((r) => r.glb && r.glb.endsWith('.glb')).map((r) => ({
  ...r, label: `${r.zone_index !== '' ? 'zone ' + r.zone_index + ' · ' : 'house · '}${r.path}`,
  tris: Number(r.triangles), kb: Math.round(Number(r.glb_bytes || 0) / 1024),
})).sort((a, b) => (a.zone_index === '' ? 1 : 0) - (b.zone_index === '' ? 1 : 0) || Number(a.zone_index) - Number(b.zone_index) || b.tris - a.tris);

// ---------- scene ----------
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b2230);
scene.fog = new THREE.Fog(0x1b2230, 600, 2500);
scene.add(new THREE.HemisphereLight(0xffffff, 0x303030, 1.0));
const sun = new THREE.DirectionalLight(0xffffff, 1.2); sun.position.set(300, 600, 200); scene.add(sun);
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 6000);
camera.position.set(0, 80, 160);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0, 0);
function resize() { const w = canvas.clientWidth, h = canvas.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
window.addEventListener('resize', resize);
resize();

// fly keys
const keys = new Set();
window.addEventListener('keydown', (e) => { if (e.target.tagName !== 'INPUT') keys.add(e.key.toLowerCase()); });
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

const loader = new GLTFLoader();
loader.setResourcePath(location.origin + '/extracted/zones/');   // the GLBs name their textures as /extracted/sheets/… (site-absolute)
let current = null, bounds = null;
const texCache = new Map();
function applyView() {
  if (!current) return;
  current.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material;
    m.wireframe = $('wire').checked;
    m.vertexColors = $('vcol').checked;
    m.map = $('tex').checked ? (o.userData.map || null) : null;
    m.color.set(m.map || !$('vcol').checked ? 0xffffff : 0xffffff);
    m.needsUpdate = true;
  });
}
async function show(z) {
  status(`loading ${z.glb} (${z.kb} KB)…`);
  $('list').querySelectorAll('div').forEach((d) => d.classList.toggle('sel', d.dataset.glb === z.glb));
  let gltf;
  try { gltf = await loader.loadAsync('/extracted/zones/' + z.glb); } catch (err) { status('load error: ' + err.message); return; }
  if (current) { scene.remove(current); current.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
  current = gltf.scene;
  let drawn = 0, textured = 0;
  current.traverse((o) => {
    if (!o.isMesh) return;
    drawn++;
    const src = o.material;
    const map = src.map || null; if (map) { textured++; map.colorSpace = THREE.SRGBColorSpace; map.wrapS = map.wrapT = THREE.RepeatWrapping; }
    o.userData.map = map;
    o.material = new THREE.MeshLambertMaterial({ map, vertexColors: true, side: THREE.DoubleSide });
    o.frustumCulled = true;
  });
  scene.add(current);
  bounds = new THREE.Box3().setFromObject(current);
  fit();
  applyView();
  const size = bounds.getSize(new THREE.Vector3());
  $('info').textContent = `${z.path}\nrecord ${z.recno}, ${(Number(z.bytes) / 1024).toFixed(0)} KB NHD\n${z.blocks} mesh blocks, ${z.nodes} nodes, ${z.draws} draws\n${Number(z.vertices).toLocaleString()} vertices, ${z.tris.toLocaleString()} triangles\n${z.textures} textures${z.sheet ? ' from sheet ' + z.sheet : ' (sheet unknown: vertex colours only)'}\nextent ${size.x.toFixed(0)} × ${size.y.toFixed(0)} × ${size.z.toFixed(0)} units (metres)\n${drawn} meshes, ${textured} textured`;
  status(`${z.label} · ${z.tris.toLocaleString()} triangles`);
}
function fit() {
  if (!bounds) return;
  const c = bounds.getCenter(new THREE.Vector3()), s = bounds.getSize(new THREE.Vector3());
  const r = Math.max(s.x, s.z) * 0.6 + 20;
  controls.target.copy(c);
  camera.position.set(c.x + r * 0.7, c.y + r * 0.6, c.z + r * 0.7);
  camera.far = Math.max(6000, r * 8); camera.updateProjectionMatrix();
  scene.fog.near = r * 2; scene.fog.far = r * 6;
  controls.update();
}
function top() {
  if (!bounds) return;
  const c = bounds.getCenter(new THREE.Vector3()), s = bounds.getSize(new THREE.Vector3());
  controls.target.copy(c); camera.position.set(c.x, c.y + Math.max(s.x, s.z) * 1.1 + 20, c.z + 0.01); controls.update();
}

// ---------- UI ----------
function renderList() {
  const q = $('q').value.trim().toLowerCase();
  const hits = zones.filter((z) => !q || z.label.toLowerCase().includes(q) || z.glb.toLowerCase().includes(q));
  $('list').innerHTML = hits.map((z) => `<div data-glb="${z.glb}">${z.label}<span class="meta">${z.tris.toLocaleString()} tris · ${z.kb} KB${z.sheet ? ' · textured' : ''}</span></div>`).join('');
  $('list').querySelectorAll('div').forEach((d) => d.addEventListener('click', () => show(zones.find((z) => z.glb === d.dataset.glb))));
}
$('q').addEventListener('input', renderList);
for (const id of ['tex', 'vcol', 'wire']) $(id).addEventListener('change', applyView);
$('top').addEventListener('click', top);
$('fit').addEventListener('click', fit);
$('shot').addEventListener('click', () => { renderer.render(scene, camera); const a = document.createElement('a'); a.href = canvas.toDataURL('image/png'); a.download = `moe-zone-${Date.now()}.png`; a.click(); });
renderList();
status(`${zones.length} zone/house files`);
const first = zones.find((z) => z.zone_index === '2') || zones[0];
if (first && location.hash.length < 2) show(first);
if (location.hash.length > 1) { const z = zones.find((x) => x.glb === decodeURIComponent(location.hash.slice(1))); if (z) show(z); }

const clock = new THREE.Clock();
(function frame() {
  requestAnimationFrame(frame);
  const dt = clock.getDelta();
  if (keys.size) {
    const speed = (keys.has('shift') ? 400 : 120) * dt;
    const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
    const right = new THREE.Vector3().crossVectors(dir, camera.up).normalize();
    const move = new THREE.Vector3();
    if (keys.has('w')) move.add(dir); if (keys.has('s')) move.sub(dir);
    if (keys.has('d')) move.add(right); if (keys.has('a')) move.sub(right);
    if (keys.has('e')) move.y += 1; if (keys.has('q')) move.y -= 1;
    if (move.lengthSq()) { move.normalize().multiplyScalar(speed); camera.position.add(move); controls.target.add(move); }
  }
  controls.update(); renderer.render(scene, camera);
})();
