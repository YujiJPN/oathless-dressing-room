// MoE dressing room: assembles the race-specific pieces of an outfit on one skeleton and plays the race's clips.
// Data comes from viewer/data/*.json (build_data.py); meshes/sheets/clips from extracted/ (served by serve.cjs).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const $ = (id) => document.getElementById(id);
const status = (t) => { $('status').textContent = t; };
const MODELS = '/extracted/models/', SHEETS = '/extracted/sheets/', ANIMS = '/extracted/anims/';
const SLOTS = ['head', 'face/mask', 'hair ornament', 'earring', 'medal', 'torso', 'shoulder', 'back', 'hands', 'ring', 'waist/tail', 'protector', 'legs', 'feet', 'weapon', 'shield'];
// Where a rigid (single-bone) item hangs — the client's own rule (FUN_005b5670 / FUN_0085ddf0): every player skeleton
// carries attachment dummies whose bone record holds a code (bone +44, low nibble); an attached item names that code —
// an accessory through its appearance row's slot code, a weapon through its visual record +0x20, a shield through +0x18.
const CODE_BONE = { 1: 'I51', 2: 'I52', 3: 'I53', 4: 'I54', 5: 'I59', 6: 'I61', 7: 'I63', 8: 'I62', 9: 'I57', 10: 'I58', 11: 'I25', 12: 'I20', 13: 'I28', 14: 'I56', 15: 'I55' };
// (I51 top of head, I52 face, I53 head centre/ears, I54 chest, I59 right shoulder, I61 back, I62/I63 hips, I57 waist
// front, I58 waist back, I25 left hand, I20 right hand, I28 left forearm, I56 left hand ring, I55 right hand ring)
const MOUNT = { 'hair ornament': 'I51', 'face/mask': 'I52', earring: 'I53', medal: 'I54', ring: 'I55', 'waist/tail': 'I58', back: 'I61', protector: 'I57', shoulder: 'I59', weapon: 'I20', shield: 'I25' };
const MOUNT_CHOICES = ['I51', 'I52', 'I53', 'I54', 'I55', 'I56', 'I57', 'I58', 'I59', 'I61', 'I62', 'I63', 'I20', 'I25', 'I28', 'I06', 'I18', 'I01', 'I05', 'I24'];

const [items, appearance, racesFile, effects, icons] = await Promise.all(['items', 'appearance', 'races', 'effects', 'icons'].map((n) => fetch(`data/${n}.json`).then((r) => r.json())));
const races = racesFile.races, starter = racesFile.starter, actions = racesFile.actions || [];
// shown names in Japanese: the race table's name_ja and the sex table's 男 / 女 (game-data race_table); even blocks male
const RACE_JA = ['ニューター 男', 'ニューター 女', 'コグニート 男', 'コグニート 女', 'パンデモス 男', 'パンデモス 女', 'エルモニー 男', 'エルモニー 女'];
for (const [b, r] of Object.entries(races)) if (RACE_JA[b]) r.label = RACE_JA[b];
// the equipment slots' names from the client's slot table (tables-C/client/equip-slots.csv), by the same slot bits
// tools/build_item_appearance.py names them with
const SLOT_JA = { head: '頭(防)', torso: '胴(防)', shoulder: '肩(防)', 'waist/tail': '腰(装)', 'hair ornament': '頭(装)', 'face/mask': '顔(装)', hands: '手(防)',
  legs: 'パンツ(防)', feet: '靴(防)', back: '背中(装)', protector: '腰(防)', earring: '耳(装)', medal: '胸(装)', ring: '指(装)', weapon: '右手', shield: '左手' };
const slotJa = (s) => SLOT_JA[s] || s;
const itemName = (it) => it.n || it.e;
// the race block a Race / sex entry draws its pieces from (a prototype's own block)
const blockOf = (key = state.block) => (races[key] && races[key].block) || key;
const itemById = new Map(items.map((it) => [it.id, it]));

// ---------- scene ----------
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2b2f35);
// flat lighting like the client's (fixed-function: ambient ~0.4 of the material + one directional): a bright, nearly
// uniform hemisphere and soft directionals, so the underside of a low-poly jaw does not go black
scene.add(new THREE.HemisphereLight(0xffffff, 0xc0c0c8, 1.4));
const key = new THREE.DirectionalLight(0xffffff, 0.9); key.position.set(1, 2, 3); scene.add(key);
const fill = new THREE.DirectionalLight(0xffffff, 0.5); fill.position.set(-2, 1, -2); scene.add(fill);
const under = new THREE.DirectionalLight(0xffffff, 0.35); under.position.set(0.5, -1, 3); scene.add(under);
// the pieces' origin is the hips: the body spans about y -0.85 .. 0.85 m
const grid = new THREE.GridHelper(2, 10, 0x4a4f57, 0x383c42); grid.position.y = -0.86; scene.add(grid);
const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 100);
camera.position.set(0.4, 0.15, 4.4);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0, 0);
function resize() { const w = canvas.clientWidth, h = canvas.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
window.addEventListener('resize', resize);
resize();
// frame a point at a distance, keeping the current viewing direction (Head / Body buttons)
function frame(target, dist) {
  const dir = new THREE.Vector3().subVectors(camera.position, controls.target); if (dir.lengthSq() < 1e-6) dir.set(0.1, 0.05, 1); dir.normalize();
  controls.target.set(target[0], target[1], target[2]); camera.position.copy(controls.target).addScaledVector(dir, dist); controls.update();
}
function headPoint() {
  if (character) { const b = character.skeleton.bones.find((x) => /^I06/.test(x.name)); if (b) { const p = new THREE.Vector3(); b.getWorldPosition(p); p.y += 0.06; return [p.x, p.y, p.z]; } }
  return [0, 0.7, 0];
}
$('viewhead').addEventListener('click', () => frame(headPoint(), 0.8));
$('viewbody').addEventListener('click', () => { camera.position.set(0.4, 0.15, 4.4); controls.target.set(0, 0, 0); controls.update(); });

// ---------- state ----------
const state = { block: '1', face: 0, hair: 11, hairColor: '#f2f2f6', body: false, equipped: new Map(), mounts: new Map(), clip: '', playing: true, glow: 0.6, additive: true };
// A worn piece hides the base body's meshes of its slot; the client's extra rules (FUN_0085a430): a body piece (slot 9)
// also hides the base chest 2 and legs 3, a face (1) hides 0 and 95, a slot-4 piece hides 0 and the eyes (90).
const HIDES = { 9: [2, 3, 9], 1: [0, 95, 1], 4: [0, 90, 4] };

// ---------- loading ----------
const loader = new GLTFLoader();
const texLoader = new THREE.TextureLoader();
const bufCache = new Map(), texCache = new Map();
async function loadGltf(url) {
  if (!bufCache.has(url)) bufCache.set(url, fetch(url).then((r) => { if (!r.ok) throw new Error(`${r.status} ${url}`); return r.arrayBuffer(); }));
  const buf = await bufCache.get(url);
  return loader.parseAsync(buf.slice(0), '');
}
function loadTex(rel) {
  const url = SHEETS + rel;
  if (!texCache.has(url)) texCache.set(url, texLoader.loadAsync(url).then((t) => { t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; }));
  return texCache.get(url);
}
// a mask sheet: raw values (no sRGB decode), its own texture object so a colour sheet sharing the file is unaffected
function loadMask(rel) {
  return loadTex(rel).then((t) => { const m = t.clone(); m.colorSpace = THREE.NoColorSpace; m.needsUpdate = true; return m; });
}
// item icon: icon id -> sheet order[id / 36], 6 x 6 cells of 40 px (cell 0 of every sheet is its label)
function iconHtml(it) {
  if (it.i == null) return '<span class="icon none"></span>';
  const sheet = icons.order[Math.floor(it.i / 36)], png = sheet && icons.png[String(sheet)];
  if (!png) return '<span class="icon none"></span>';
  const c = it.i % 36;
  return `<span class="icon" style="background-image:url('${SHEETS}${png}');background-position:${-(c % 6) * 40}px ${-Math.floor(c / 6) * 40}px"></span>`;
}

// ---------- effects: NTA texture-animation tracks = layers over the same geometry ----------
// chain 0: stepped keys [frame, flag, u, v] (flag 1 = additive glow); chain 1: interpolated keys [frame, du, dv]
function evalKeys(keys, frame, interpolate) {
  if (!keys || !keys.length) return [0, 0];
  const val = (k) => (k.length === 4 ? [k[2], k[3]] : k.length === 3 ? [k[1], k[2]] : [k[1], 0]);
  if (frame <= keys[0][0]) return val(keys[0]);
  for (let i = 1; i < keys.length; i++) {
    if (frame < keys[i][0]) {
      const a = keys[i - 1], b = keys[i];
      if (!interpolate) return val(a);
      const t = (frame - a[0]) / Math.max(b[0] - a[0], 1); const va = val(a), vb = val(b);
      return [va[0] + (vb[0] - va[0]) * t, va[1] + (vb[1] - va[1]) * t];
    }
  }
  return val(keys[keys.length - 1]);
}
function trackLayers(fx) {
  return (fx.tracks || []).map((t) => {
    const base = t.chains[0] || [], anim = t.chains[1] || [];
    const flag = base.length && base[0].keys.length && base[0].keys[0].length === 4 ? base[0].keys[0][1] : 0;
    return { frames: Math.max(t.frames, 1), fps: fx.fps || 60, additive: flag === 1, step: base.flatMap((n) => (n.kind === 0 ? n.keys : [])), lerp: anim.flatMap((n) => (n.kind === 1 ? n.keys : [])) };
  });
}
function layerOffset(layer, seconds) {
  const frame = (seconds * layer.fps) % layer.frames;
  const a = evalKeys(layer.step, frame, false), b = evalKeys(layer.lerp, frame, true);
  return [a[0] + b[0], a[1] + b[1]];
}
function firstSkinned(obj) { let found = null; obj.traverse((o) => { if (!found && o.isSkinnedMesh) found = o; }); return found; }
function makeMaterial(tex, tint, alphaTest = tex ? 0.5 : 0) {
  return new THREE.MeshStandardMaterial({ map: tex || null, color: tint ? new THREE.Color(tint) : (tex ? 0xffffff : 0xeec7b0), roughness: 0.9, metalness: 0, side: THREE.DoubleSide, alphaTest });
}
// hair, the client's way (PS_Low_Color_Mask, extracted/sdse/94305): colour = texture x (1 - mask x (1 - hair colour)),
// with the mask = the hair row's second sheet (+20), so the hair colour lands only where the mask is white and the ears
// / skin modelled into a hair piece keep the sheet's own colour
// The client works in gamma space (no sRGB decode), so the factor is built from the colour's sRGB numbers and applied
// to the linear texel as factor^2.2 (with mask 1 this equals the plain colour multiply used for unmasked hair).
function hairMaterial(tex, mask, color) {
  const m = makeMaterial(tex, null);
  m.userData.hairColor = { value: new THREE.Color().setStyle(color, THREE.LinearSRGBColorSpace) };   // raw sRGB numbers
  m.userData.hairMask = { value: mask };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uHairColor = m.userData.hairColor;
    sh.uniforms.uHairMask = m.userData.hairMask;
    sh.fragmentShader = 'uniform vec3 uHairColor;\nuniform sampler2D uHairMask;\n' + sh.fragmentShader.replace('#include <map_fragment>',
      '#include <map_fragment>\n  diffuseColor.rgb *= pow(vec3(1.0) - clamp(texture2D(uHairMask, vMapUv).rgb * (vec3(1.0) - uHairColor), 0.0, 1.0), vec3(2.2));');
  };
  m.customProgramCacheKey = () => 'hair-mask';
  return m;
}
function setHairColor(mat, color) {
  if (mat.userData.hairColor) mat.userData.hairColor.value.setStyle(color, THREE.LinearSRGBColorSpace); else mat.color.set(color);
}
// the eyes, the client's way: the base body's eye fans carry the 64x64 iris surface (opaque: iris on black) and sit just
// behind the face's eye quads; the face sheet's alpha is ~0.06 inside the eye almond and 1 elsewhere, so drawing the face
// alpha-blended over the eye fans shows the iris (with the dark corners) through the almond and keeps the lashes on top
function eyeMaterial(tex) {
  return new THREE.MeshStandardMaterial({ map: tex || null, roughness: 0.5, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
}
function faceMaterial(tex) {
  return new THREE.MeshStandardMaterial({ map: tex || null, color: tex ? 0xffffff : 0xeec7b0, roughness: 0.9, metalness: 0, side: THREE.DoubleSide, transparent: true, alphaTest: 0, depthWrite: true });
}
function boneMaps(skeleton) {
  const byName = new Map(skeleton.bones.map((b, i) => [b.name, i]));
  const byNum = new Map();
  skeleton.bones.forEach((b, i) => { const m = /^I(\d\d)/.exec(b.name); if (m && !byNum.has(m[1])) byNum.set(m[1], i); });
  return { byName, byNum };
}
function resolveBone(name, maps) {
  if (maps.byName.has(name)) return maps.byName.get(name);
  const m = /^I(\d\d)/.exec(name);
  return m && maps.byNum.has(m[1]) ? maps.byNum.get(m[1]) : undefined;
}
// Re-skin a piece from its own skeleton onto the master skeleton (same bone names across one race block), the way the
// client does it: a piece's vertices are offsets from its own bones, so they follow the master's bones through the
// piece's OWN inverse bind matrices. Binding with the master's inverses instead keeps the piece where its own rig put it,
// and some pieces are rigged elsewhere: 156 Cognite-female rows (the launch clothes, rows 19-~190) sit 2 cm behind the
// base body's rig and 168 Pandemos-female rows 1.5 cm in front of it, which opened a gap between the chin and the shirt's
// neck (the "missing neck").
function retarget(mesh, skeleton, maps) {
  const map = mesh.skeleton.bones.map((b) => { const i = resolveBone(b.name, maps); return i === undefined ? 0 : i; });
  const inverses = skeleton.bones.map((_, i) => skeleton.boneInverses[i].clone());
  mesh.skeleton.bones.forEach((b, k) => { if (resolveBone(b.name, maps) !== undefined) inverses[map[k]] = mesh.skeleton.boneInverses[k].clone(); });
  const attr = mesh.geometry.attributes.skinIndex;
  const arr = attr.array;
  for (let i = 0; i < arr.length; i++) arr[i] = map[arr[i]];
  attr.needsUpdate = true;
  mesh.bind(new THREE.Skeleton(skeleton.bones, inverses), new THREE.Matrix4());
}
// a rigid accessory (one bone of its own, modelled at the origin) is hung on one attachment dummy of the master skeleton:
// move it into the dummy's bind pose and skin it 100% to that bone
function mountRigid(mesh, skeleton, maps, prefix, scale = 1) {
  const i = maps.byNum.get(prefix.slice(1)) ?? maps.byName.get(prefix) ?? 0;
  const bind = new THREE.Matrix4().copy(skeleton.boneInverses[i]).invert();
  if (scale && scale !== 1) mesh.geometry.scale(scale, scale, scale);
  mesh.geometry.applyMatrix4(bind);
  const si = mesh.geometry.attributes.skinIndex, sw = mesh.geometry.attributes.skinWeight;
  for (let k = 0; k < si.array.length; k += 4) { si.array[k] = i; si.array[k + 1] = si.array[k + 2] = si.array[k + 3] = 0; sw.array[k] = 1; sw.array[k + 1] = sw.array[k + 2] = sw.array[k + 3] = 0; }
  si.needsUpdate = true; sw.needsUpdate = true;
  mesh.bind(skeleton, new THREE.Matrix4());
  return skeleton.bones[i].name;
}
function disposeGroup(root) { root.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.dispose) o.material.dispose(); }); }
// a prop exported without a skin: give it skin attributes so it can be hung on a bone like the others
function toSkinned(mesh) {
  const n = mesh.geometry.attributes.position.count;
  mesh.geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(n * 4), 4));
  mesh.geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(n * 4), 4));
  const sm = new THREE.SkinnedMesh(mesh.geometry, mesh.material);
  sm.name = mesh.name; sm.skeleton = new THREE.Skeleton([new THREE.Bone()]);
  mesh.parent.add(sm); mesh.removeFromParent();
  return sm;
}
// the dummy an item hangs on: the user's override, else the client's attach code, else the slot's usual dummy
function mountFor(p) { return state.mounts.get(p.kind) || CODE_BONE[p.held ? p.e.a : p.e.c] || MOUNT[p.kind] || 'I01'; }

// ---------- outfit ----------
// Why an item has no model for the current race/sex: its appearance row is empty in this block (the row's +8 mesh is -1).
// The item's sex mask (it.sx: 1 male, 2 female) explains most of them; the rest are NPC/GM costumes made for one race, or
// items with no model in the client at all. Even blocks are male, odd ones female.
function noModelNote(it) {
  const sexBit = Number(blockOf()) % 2 === 0 ? 1 : 2;
  if (it.sx && !(it.sx & sexBit)) return it.sx === 2 ? '女性専用' : '男性専用';
  const where = Object.keys(appearance).filter((b) => appearance[b][String(it.r)]);
  if (!where.length) return 'クライアントにモデルなし';
  return `モデルがあるのは ${where.map((b) => races[b].label).join('、')} のみ`;
}
function piecesForOutfit() {
  const app = appearance[blockOf()] || {}; const race = races[state.block]; const list = [], missing = [];
  const push = (row, kind, label, tint, it) => { const e = app[String(row)]; if (e) list.push({ row, kind, label, e, tint }); else missing.push(it ? `${label}（${noModelNote(it)}）` : label); };
  if (race.base) list.push({ row: null, kind: 'base', label: '素体', e: race.base, base: true });
  if (race.proto) list.push({ row: null, kind: 'base', label: race.label, e: race.proto, base: true, proto: true });   // its own face and hair
  else {
    push(state.face, 'face', `顔 ${state.face + 1}`);
    push(state.hair, 'hair', `髪型 ${state.hair - 7}`);
  }
  for (const [slot, it] of state.equipped) {
    if (it.h) list.push({ row: null, kind: slot, label: itemName(it), e: it.h, held: true, tint: it.tint });   // weapon/shield prop
    else push(it.r, slot, itemName(it), it.tint, it);   // the item's material (an NMT record) tints the piece: gold is golden
  }
  return { list, missing };
}
let character = null, building = 0;
async function rebuild() {
  const token = ++building;
  status('パーツ読み込み中…');
  const { list: wanted, missing } = piecesForOutfit();
  // Which meshes a worn piece removes (FUN_0085a430 -> FUN_008650e0): every mesh of its model's own slot byte (e.m; the
  // row's +4 code is a category) that is already on the model, the base body's and other worn pieces' alike; a body piece
  // (slot 9) also strips the chest 2 and legs 3, a face (1) 0 and 95, a slot-4 piece 0 and the eyes 90 (categories up to
  // 14 only). So a kimono takes the trousers with it, like in the game. Rows from 4654 up are accessories on dummies.
  const wearers = wanted.filter((p) => !p.base && !p.held && p.row != null && p.row < 4654 && (p.e.m ?? p.e.c) != null);
  const slotOf = (p) => p.e.m ?? p.e.c, extOf = (p) => ((p.e.c == null || p.e.c <= 14) && HIDES[slotOf(p)]) || [slotOf(p)];
  const hiddenBy = new Map();
  // the face and hair rows go on first (character creation), worn items after: an item also removes a face / hair row
  // of its own slot (a wig, slot 7, takes the chosen hairstyle off); two items never share a slot
  const isLook = (p) => p.kind === 'face' || p.kind === 'hair';
  for (const p of wearers) for (const q of wearers) if (q !== p && ((slotOf(q) !== slotOf(p) && extOf(q).includes(slotOf(p))) || (isLook(p) && !isLook(q) && slotOf(q) === slotOf(p)))) hiddenBy.set(p, q);
  const list = wanted.filter((p) => !hiddenBy.has(p));
  const covered = new Set(wearers.filter((p) => !hiddenBy.has(p)).flatMap(extOf));
  let loaded;
  try {
    loaded = await Promise.all(list.map(async (p) => ({
      p, gltf: await loadGltf(p.e.g.startsWith('/') ? p.e.g : MODELS + p.e.g), tex: p.e.t ? await loadTex(p.e.t).catch(() => null) : null,
      mask: p.kind === 'hair' && p.e.t2 ? await loadMask(p.e.t2).catch(() => null) : null,
      extra: p.e.x ? await loadGltf(MODELS + p.e.x.g).catch(() => null) : null, extraTex: p.e.x && p.e.x.t ? await loadTex(p.e.x.t).catch(() => null) : null,
      surf: p.base && p.e.s ? Object.fromEntries(await Promise.all(Object.entries(p.e.s).map(async ([k, v]) => [k, await loadTex(v).catch(() => null)]))) : null,
    })));
  } catch (err) { status('読み込みエラー: ' + err.message); return; }
  if (token !== building) return;
  if (character) { scene.remove(character.root); disposeGroup(character.root); character = null; }
  let master = null;
  for (const l of loaded) { const sm = firstSkinned(l.gltf.scene); if (sm && (!master || sm.skeleton.bones.length > master.sm.skeleton.bones.length)) master = { l, sm }; }
  if (!master) { status('表示するものがありません'); $('info').textContent = ''; return; }
  const root = new THREE.Group(); const skelRoot = master.l.gltf.scene; root.add(skelRoot);
  const skeleton = master.sm.skeleton; const maps = boneMaps(skeleton);
  const info = []; const animated = [];
  for (const l of loaded) {
    const sets = [[l.gltf.scene, l.tex, false]]; if (l.extra) sets.push([l.extra.scene, l.extraTex, true]);
    const fx = l.p.e.fx && effects[l.p.e.fx] ? trackLayers(effects[l.p.e.fx]) : [];
    const surfaces = l.p.e.ts ? await Promise.all(l.p.e.ts.map((s) => loadTex(s).catch(() => null))) : [];
    // the surface of a multi-surface sheet the model draws with: per primitive from the exported material name
    // ("...|surface<N>", models that mix surfaces), else the model's single surface (e.sf from tables/nmd-surfaces.csv;
    // Merchant Ware is surface 2 of its four, the others belong to other models sharing the sheet)
    const surfaceOf = (mesh) => { const m = /\|surface(\d+)$/.exec((mesh.material && mesh.material.name) || ''); return m ? Number(m[1]) : (l.p.e.sf || 0); };
    let mounted = ''; const baseShown = [], baseHidden = [];
    for (const [scn, tex, isExtra] of sets) {
      const meshes = []; scn.traverse((o) => { if (o.isSkinnedMesh) meshes.push(o); else if (o.isMesh && scn !== skelRoot) meshes.push(o); });
      const split = meshes.some((m) => /\|surface\d+$/.test((m.material && m.material.name) || ''));
      for (let mesh of meshes) {
        const foreign = scn !== skelRoot;
        let baseSlot = null, baseTex = tex, sf = 0;
        if (l.p.proto) {
          mesh.material.side = THREE.DoubleSide;
          mesh.frustumCulled = false;
          baseShown.push(mesh.material.name || mesh.name);
          continue;
        }
        if (l.p.base) {
          const m = /^slot(\d+)_surface(\d+)/.exec(mesh.name); baseSlot = m ? Number(m[1]) : 0; baseTex = m ? l.surf[m[2]] : null;
          if (covered.has(baseSlot)) { baseHidden.push(baseSlot); mesh.visible = false; continue; }
          baseShown.push(baseSlot);
        } else if (!isExtra) {
          sf = surfaceOf(mesh); if (sf && surfaces[sf]) baseTex = surfaces[sf];
        }
        if (foreign) {
          if (!mesh.isSkinnedMesh) mesh = toSkinned(mesh);
          const rigid = l.p.held || (mesh.skeleton.bones.length <= 2 && mesh.skeleton.bones.every((b) => resolveBone(b.name, maps) === undefined));
          if (rigid) mounted = mountRigid(mesh, skeleton, maps, mountFor(l.p), l.p.held ? l.p.e.s : 1);
          else retarget(mesh, skeleton, maps);
        }
        // the base body's own hair (slot 7) stays under hair rows whose model sits in another slot (row 15's back panel is slot 17)
        const hairLike = (l.p.kind === 'hair' && !isExtra) || baseSlot === 7;
        const tint = hairLike ? state.hairColor : (l.p.tint && !isExtra ? new THREE.Color(l.p.tint[0], l.p.tint[1], l.p.tint[2]) : null);
        if (baseSlot === 90) mesh.material = eyeMaterial(baseTex);
        else if (l.p.kind === 'face' || baseSlot === 1) { mesh.material = faceMaterial(baseTex); mesh.renderOrder = 1; }
        else if (hairLike && l.mask && !l.p.base) mesh.material = hairMaterial(baseTex, l.mask, state.hairColor);
        else mesh.material = makeMaterial(baseTex, tint);
        mesh.userData.hair = hairLike;
        mesh.frustumCulled = false;
        if (foreign) { mesh.removeFromParent(); root.add(mesh); }
        if (!isExtra && fx.length && tex) {
          const fxMaterial = (t, layer) => {
            const glow = layer.additive && state.additive;
            return new THREE.MeshStandardMaterial({ map: t, roughness: 0.9, metalness: 0, side: THREE.DoubleSide, alphaTest: glow ? 0 : 0.5,
              transparent: glow, opacity: glow ? state.glow : 1, blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: !glow });
          };
          if (split) {
            // the model's subsets name their surfaces (one primitive each): the glow runes are their own primitive on
            // surface 1, and the NTA track of the same index animates that surface
            const layer = fx[sf];
            if (layer) { const t = baseTex.clone(); t.needsUpdate = true; mesh.material = fxMaterial(t, layer); animated.push({ texture: t, layer, material: mesh.material }); }
          } else {
            // older single-primitive export: draw every surface as a layer over the same geometry
            fx.forEach((layer, li) => {
              const src = surfaces[sf + li] || baseTex; const t = src.clone(); t.needsUpdate = true;
              let target = mesh;
              if (li > 0) { target = mesh.clone(); target.frustumCulled = false; root.add(target); }
              target.material = fxMaterial(t, layer);
              animated.push({ texture: t, layer, material: target.material });
            });
          }
        }
      }
    }
    const fxText = fx.length ? `\n   ✦ エフェクト ${l.p.e.fx}: ${fx.map((f, i) => `層 ${i} ${f.frames} フレーム${f.additive ? ' 加算' : ''}${f.lerp.length ? ' スクロール' : ''}${f.step.length > 1 ? ' コマ送り' : ''}`).join('、')}` : '';
    if (l.p.proto) { info.push(`prototype ${l.p.e.g.split('/').pop()}: ${baseShown.join(', ')}\n   ${l.p.e.source || ''}\n   its own face and hair (the Face / Hair choices do not apply); clips and items of ${races[blockOf()].label}`); continue; }
    if (l.p.base) { info.push(`素体 ${l.p.e.g.split('/').pop()}（シート ${l.p.e.sheet}）\n   表示中の部位 ${baseShown.join('、') || 'なし'}${baseHidden.length ? `；装備で隠れた部位 ${baseHidden.join('、')}` : ''}\n   （1 顔、7 髪、2 胸、3 脚、6 手、8 足、90 目）`); continue; }
    const where = l.p.held ? `手持ち「${l.p.e.label}」、取付コード ${l.p.e.a}${l.p.e.s !== 1 ? `、拡大 ${l.p.e.s}` : ''}` : `行 ${l.p.row}${l.p.e.c != null && CODE_BONE[l.p.e.c] && mounted ? `、部位コード ${l.p.e.c}` : ''}`;
    const sheetText = l.p.e.t ? '\n   ' + l.p.e.t.split('/').pop() + (l.p.e.ts ? `（面 ${l.p.e.ts.length}${l.p.e.sf ? `、面 ${l.p.e.sf} で描画` : ''}）` : '') : '';
    const tintText = l.p.tint && !l.p.base ? `\n   素材の色 ${l.p.tint.map((v) => v.toFixed(2)).join(' / ')}` : '';
    info.push(`${l.p.label}（${where}）\n   ${l.p.e.g.split('/').pop()}${sheetText}${tintText}${mounted ? `\n   取付先 ${mounted}` : ''}${fxText}${l.p.e.x ? `\n   + 追加パーツ ${l.p.e.x.g.split('/').pop()}` : ''}`);
  }
  for (const [p, q] of hiddenBy) info.push(`${p.label}（行 ${p.row}、部位 ${slotOf(p)}）— 非表示：${q.label}（部位 ${slotOf(q)}）が外す（ゲーム通り）`);
  if (missing.length) info.push(`この種族・性別にはモデルなし（ゲーム通り）: ${missing.join('、')}`);
  scene.add(root);
  character = { root, skeleton, skelRoot, mixer: new THREE.AnimationMixer(skelRoot), animated, time: 0 };
  $('info').textContent = info.join('\n');
  status(`${loaded.length} パーツ · ${skeleton.bones.length} ボーン · ${races[state.block].label}`);
  if (state.clip) await playClip(state.clip);
}
async function playClip(rel) {
  if (!character) return;
  let gltf;
  try { gltf = await loadGltf(ANIMS + rel); } catch (err) { status('モーションエラー: ' + err.message); return; }
  const clip = gltf.animations[0]; if (!clip) return;
  const maps = boneMaps(character.skeleton); const tracks = [];
  for (const t of clip.tracks) {
    const dot = t.name.lastIndexOf('.'); const node = t.name.slice(0, dot), prop = t.name.slice(dot);
    const i = resolveBone(node, maps); if (i === undefined) continue;
    const nt = t.clone(); nt.name = character.skeleton.bones[i].name + prop; tracks.push(nt);
  }
  character.mixer.stopAllAction();
  const action = character.mixer.clipAction(new THREE.AnimationClip(clip.name, clip.duration, tracks));
  // the NMA file's frame count: the glTF stores one key per frame, so the longest track's key count is the frame total
  const frames = Math.max(0, ...clip.tracks.map((t) => t.times.length));
  const sel = selectedAction();
  const w = sel && sel.g === rel ? actionWindow(sel, clip.duration, frames) : null;
  character.window = w ? { action, ...w } : null;
  action.play();
  if (w) action.time = w.start;
  status(`${clip.name} · ${clip.duration.toFixed(2)} 秒（${frames} フレーム${w ? `、再生 ${(w.start / clip.duration * frames).toFixed(0)}→${(w.end / clip.duration * frames).toFixed(0)}、ループ開始 ${(w.loop / clip.duration * frames).toFixed(0)}` : ''}）· トラック ${tracks.length}/${clip.tracks.length}`);
}

// ---------- UI ----------
function fillSelect(sel, options, value) { sel.innerHTML = options.map(([v, l]) => `<option value="${v}">${l}</option>`).join(''); sel.value = value; }
fillSelect($('race'), Object.entries(races).map(([b, r]) => [b, r.label]), state.block);
// faces: rows 0..4 (the client offers five; rows 5..7 hold other slot-1 models). Hairs: rows 8..17 = the character
// record's hair number 1..10 (FUN_00813730: row = 7 + number), the order the creation screen most likely uses too.
fillSelect($('face'), [...Array(5).keys()].map((i) => [i, `顔 ${i + 1}`]), state.face);
fillSelect($('hair'), [...Array(10).keys()].map((i) => [i + 8, `髪型 ${i + 1}${i === 8 ? '（ボサ）' : ''}`]), state.hair);
const slotNames = [...new Set([...SLOTS, ...items.map((it) => it.s)])];
fillSelect($('filter'), [['', 'すべての部位'], ...slotNames.map((s) => [s, slotJa(s)])], '');
function fillClips() { fillSelect($('clip'), [['', '基本姿勢'], ...(races[state.block].clips || []).map((c) => [c.g, c.label])], state.clip); }
fillClips();
// the race's motion set (the client's action id -> clip table), grouped by what names the id (tables/action-names.csv):
// basic = the client's own states (idle, walk, run, swim, sit, die ...), emote, attack (weapon class), music (instrument
// play / hold), technique (the techniques that play it), visual (classified by eye on viewer/clips.html)
const KIND_LABEL = { basic: '基本動作', emote: 'エモート', attack: '通常攻撃（武器種）', music: '楽器', technique: 'テクニック', visual: 'ポーズ・その他', unnamed: '名前なし' };
const KIND_ORDER = ['basic', 'emote', 'attack', 'music', 'technique', 'visual', 'unnamed'];
function fillActions() {
  const r = races[state.block]; const list = r.actions || [];
  const kinds = [...new Set(list.map((a) => a.r))].sort((a, b) => (KIND_ORDER.indexOf(a) + 99) % 99 - (KIND_ORDER.indexOf(b) + 99) % 99);
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  // the frame window the client plays (motion-sets record: start, end; a lead-in motion starts at 0 and loops start..end)
  const win = (a) => (a.z ? `0→${a.f}、ループ ${a.l}` : a.l ? `${a.l}–${a.f}` : `${a.f}`) + ' フレーム';
  // option value = the action id (several ids share one clip file with different windows, e.g. sit down 15 / stand up 16)
  $('action').innerHTML = `<option value="">— モーションセット ${r.set || '?'}（${list.length} アクション）—</option>` + kinds.map((k) => `<optgroup label="${KIND_LABEL[k] || k}">${list.filter((a) => a.r === k).map((a) => `<option value="${a.a}">${a.a} · ${esc(a.j || a.n || '（名前なし）')}${a.j && !a.n.includes(a.j) ? ' · ' + esc(a.j) : ''} · ${win(a)}</option>`).join('')}</optgroup>`).join('');
}
function selectedAction() { const v = $('action').value; return v === '' ? null : (races[state.block].actions || []).find((x) => String(x.a) === v) || null; }
// the window of the chosen action (null for the race's own clips): seconds, from the clip's own frame rate
function actionWindow(a, clipDuration, totalFrames) {
  if (!a || !a.f || !totalFrames) return null;
  const spf = clipDuration / totalFrames;
  return { start: a.z ? 0 : a.l * spf, loop: a.l * spf, end: Math.min(a.f, totalFrames) * spf };
}
fillActions();
// the status panels (status.js) follow the race and the worn items
function outfitChanged() {
  document.dispatchEvent(new CustomEvent('outfit', { detail: { block: blockOf(), worn: [...state.equipped.values()].map((it) => it.id) } }));
}
function renderSlots() {
  outfitChanged();
  const keys = [...new Set([...SLOTS, ...state.equipped.keys()])];
  $('slots').innerHTML = keys.map((k) => {
    const it = state.equipped.get(k);
    const e = it && (it.h || (appearance[blockOf()] || {})[String(it.r)]);
    const def = it && (state.mounts.get(k) || (e && CODE_BONE[it.h ? e.a : e.c]) || MOUNT[k]);
    const mount = it && def && (it.h || MOUNT[k] || (e && CODE_BONE[e.c] && it.r >= 4654)) ? `<select data-mount="${k}" title="取付ボーン">${MOUNT_CHOICES.map((m) => `<option value="${m}"${def === m ? ' selected' : ''}>${m}</option>`).join('')}</select>` : '';
    return `<div><span>${slotJa(k)}</span><span class="${it ? 'name' : 'empty'}">${it ? iconHtml(it) + itemName(it) : '—'}</span>${mount}${it ? `<button data-slot="${k}">×</button>` : ''}</div>`;
  }).join('');
  $('slots').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { state.equipped.delete(b.dataset.slot); renderSlots(); rebuild(); }));
  $('slots').querySelectorAll('select[data-mount]').forEach((s) => s.addEventListener('change', () => { state.mounts.set(s.dataset.mount, s.value); rebuild(); }));
}
function equip(it) { state.equipped.set(it.s, it); renderSlots(); rebuild(); }
function search() {
  const q = $('q').value.trim().toLowerCase(); const f = $('filter').value; const app = appearance[blockOf()] || {};
  const hits = [];
  for (const it of items) {
    if (f && it.s !== f) continue;
    if (q && !(it.n.toLowerCase().includes(q) || it.e.toLowerCase().includes(q))) continue;
    hits.push(it); if (hits.length >= 300) break;
  }
  $('results').innerHTML = hits.map((it) => { const e = it.h || app[String(it.r)]; return `<div data-id="${it.id}">${iconHtml(it)}${itemName(it)}<span class="meta">${slotJa(it.s)} · ${it.h ? '手持ち' : '行 ' + it.r}${e && e.fx ? ' <span class="fx">✦ エフェクト</span>' : ''}${e ? '' : ' · この種族・性別にはモデルなし: ' + noModelNote(it)}</span></div>`; }).join('');
  $('results').querySelectorAll('div[data-id]').forEach((d) => d.addEventListener('click', () => equip(itemById.get(Number(d.dataset.id)))));
}
$('q').addEventListener('input', search);
$('filter').addEventListener('change', search);
$('race').addEventListener('change', () => { state.block = $('race').value; const r = races[state.block]; state.face = r.face; state.hair = r.hair; $('face').value = state.face; $('hair').value = state.hair; state.clip = ''; fillClips(); fillActions(); search(); outfitChanged(); rebuild(); });
$('face').addEventListener('change', () => { state.face = Number($('face').value); rebuild(); });
$('hair').addEventListener('change', () => { state.hair = Number($('hair').value); rebuild(); });
$('hairColor').addEventListener('input', () => { state.hairColor = $('hairColor').value; if (character) character.root.traverse((o) => { if (o.userData.hair) setHairColor(o.material, state.hairColor); }); });
$('starter').addEventListener('click', () => { for (const id of Object.values(starter)) { const it = itemById.get(id); if (it) state.equipped.set(it.s, it); } renderSlots(); rebuild(); });
$('clear').addEventListener('click', () => { state.equipped.clear(); renderSlots(); rebuild(); });
$('clip').addEventListener('change', () => { state.clip = $('clip').value; $('action').value = ''; if (state.clip) playClip(state.clip); else rebuild(); });
$('action').addEventListener('change', () => { const a = selectedAction(); state.clip = a ? a.g : ''; $('clip').value = ''; if (state.clip) playClip(state.clip); else rebuild(); });
$('play').addEventListener('click', () => { state.playing = !state.playing; $('play').textContent = state.playing ? '一時停止' : '再生'; });
$('glow').addEventListener('input', () => { state.glow = Number($('glow').value); if (character) for (const a of character.animated) if (a.layer.additive && state.additive) a.material.opacity = state.glow; });
$('additive').addEventListener('change', () => { state.additive = $('additive').checked; rebuild(); });
$('shot').addEventListener('click', () => { renderer.render(scene, camera); const a = document.createElement('a'); a.href = canvas.toDataURL('image/png'); a.download = `moe-${races[state.block].label.replace(/\s+/g, '-')}-${Date.now()}.png`; a.click(); });

// ---------- start ----------
for (const id of Object.values(starter)) { const it = itemById.get(id); if (it) state.equipped.set(it.s, it); }
renderSlots(); search();
await rebuild();
const clock = new THREE.Clock();
(function frame() {
  requestAnimationFrame(frame);
  const dt = clock.getDelta();
  if (character && state.playing) {
    character.mixer.update(dt); character.time += dt;
    // keep the client's window: after the end, back to the loop start (a lead-in motion's first pass began at 0)
    const w = character.window;
    if (w && w.end > w.loop && w.action.time >= w.end) w.action.time = w.loop + ((w.action.time - w.end) % (w.end - w.loop));
    for (const a of character.animated) { const [u, v] = layerOffset(a.layer, character.time); a.texture.offset.set(u, v); }
  }
  controls.update(); renderer.render(scene, camera);
})();
// for debugging from the console: window.__dr.scene / camera / controls / renderer / state / THREE / character()
window.__dr = { scene, camera, controls, renderer, state, THREE, character: () => character };
