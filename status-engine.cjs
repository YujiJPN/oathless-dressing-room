// The dressing room's status sheet: the game server's own stat code run on what the dressing room shows, so every
// number is the one the game shows. Nothing here computes a stat itself; it loads, in the same way as the server
// (C:\Claude Docs\our-game\server\oathless-server.cjs refreshStats), the rules engine with the reference profile and
// the race / skill / stat tables, then
//   rules.characterStats  base pass (FUN_0060a170: start + skill x coefficient x race multiplier)
//   gear.pass             gear pass (FUN_00605390: bonus pairs, armour x need, weapon term in attack and hit)
//   active-effects        worn-item techniques and buffs through the effect-step interpreter (ops 0x29 / 0x93 / 0x97 ...)
// and the weapon's skill from the client's weapon-class table (UE/DemoData/technic.json hand_rule.classes, FUN_006260a0).
//
//   const S = require('./status-engine.cjs');
//   S.compute({ block, skills: {refId: value}, worn: [itemIndex, ...], buffs: [techniqueId, ...] }) -> sheet
//   S.meta()  -> skills (ref id, names, group, start cap), stat names, buff list, learnable techniques
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// the game server's code: a shared copy keeps it next to the viewer (our-game/, viewer/pack_share.cjs), else this PC's repo
const GAME = fs.existsSync(path.join(ROOT, 'our-game', 'rules', 'rules.cjs')) ? path.join(ROOT, 'our-game') : 'C:\\Claude Docs\\our-game';
const DATA = path.join(ROOT, 'UE', 'ServerData');
const PROFILE = path.join(ROOT, 'rules-profile', 'reference.cjs');

let S = null;   // loaded once, on the first request (the item and technique files are large)
function load() {
  if (S) return S;
  const rules = require(path.join(GAME, 'rules', 'rules.cjs'));
  if (fs.existsSync(PROFILE)) require(PROFILE).apply(rules);
  const gameData = JSON.parse(fs.readFileSync(path.join(GAME, 'game-data.json'), 'utf8'));
  rules.loadSkillTable(gameData.skill_table);
  rules.loadRaceTable(gameData.race_table, gameData.stat_table);
  const gear = require(path.join(GAME, 'rules', 'gear.cjs'));
  const { createActiveEffects } = require(path.join(GAME, 'server', 'active-effects.cjs'));
  const techniques = rules.loadTechniques(path.join(DATA, 'techniques.json'));
  const items = rules.loadItems(path.join(DATA, 'items.json'));
  const itemsRaw = JSON.parse(fs.readFileSync(path.join(DATA, 'items.json'), 'utf8')).items;
  const techRaw = JSON.parse(fs.readFileSync(path.join(DATA, 'techniques.json'), 'utf8')).techniques;
  const opcodes = JSON.parse(fs.readFileSync(path.join(DATA, 'technique-opcodes.json'), 'utf8')).opcodes;
  const hand = JSON.parse(fs.readFileSync(path.join(ROOT, 'UE', 'DemoData', 'technic.json'), 'utf8')).hand_rule;
  const statTable = gameData.stat_table && gameData.stat_table.stats || {};
  const gearStatOk = (id) => { const st = statTable[id]; return !st || !!(st.flags & 0x10); };
  // the dressing room lists items by their record index; the server's item map is keyed by item id
  const idOfIndex = new Map(itemsRaw.map((it) => [it.index, it.id]));
  TECHS = techniques;
  S = { rules, gear, createActiveEffects, techniques, items, itemsRaw, techRaw, opcodes, hand, statTable, gearStatOk, idOfIndex, gameData };
  return S;
}

// block (dressing room race / sex entry): even male, odd female; 0-1 Newter, 2-3 Cognite, 4-5 Pandemos, 6-7 Elmony
const BLOCK_RACE = ['newter', 'newter', 'cognite', 'cognite', 'pandemos', 'pandemos', 'elmony', 'elmony'];
const KIND = { weapon: 0xf0001, shield: 0xd0002, clothing: 0xc0004, ammo: 0xc0040 };
const RIGHT = 11, LEFT = 12, AMMO = 13;
const STAT_OPS = new Set([0x29, 0x93, 0x97]);   // stat modifier, lasting percent modifier, flat add

// the equipment slot (0-17, tables/client/equip-slots.csv) a piece goes to: the lowest bit of its slot bits; a weapon
// goes to the right hand, a shield to the left hand, ammunition to slot 13
function slotOf(def) {
  if (def.kind === KIND.weapon) return RIGHT;
  if (def.kind === KIND.shield) return LEFT;
  if (def.kind === KIND.ammo) return AMMO;
  const bits = (def.cls && def.cls.slot_bits) >>> 0;
  for (let i = 0; i < 18; i++) if (bits & (1 << i)) return i;
  return -1;
}
function weaponSkillRef(def, hand) {
  const c = def.cls || {};
  if (c.second_skill) return c.second_skill;
  const row = hand.classes[c.weapon_class];
  return row ? row[0] : 0;
}

function compute(req) {
  const L = load();
  const { rules, gear } = L;
  const block = Math.max(0, Math.min(7, Number(req.block) || 0));
  const race = BLOCK_RACE[block], sex = block % 2 === 0 ? 1 : 2;
  // skills arrive by reference id; the engine keys them by its own ids (skill table)
  const skills = {};
  for (const [ref, v] of Object.entries(req.skills || {})) {
    const key = rules.skillOfRef(Number(ref));
    const n = Number(v);
    if (key && Number.isFinite(n)) skills[key] = Math.max(0, Math.min(100, n));
  }
  const slots = new Array(18).fill(null);
  const pieces = [];
  for (const idx of req.worn || []) {
    const id = L.idOfIndex.get(Number(idx));
    const def = id != null ? L.items.get(id) : null;
    if (!def) continue;
    const s = slotOf(def);
    if (s < 0) continue;
    slots[s] = { id };
    pieces.push({ index: Number(idx), id, slot: s, def });
  }
  const right = slots[RIGHT] ? L.items.get(slots[RIGHT].id) : null;
  const wRef = right && right.kind === KIND.weapon ? weaponSkillRef(right, L.hand) : 26;   // bare hands: Fist
  const wKey = rules.skillOfRef(wRef) || 'martial';
  const char = { name: 'dressingroom', race, sex, skills, inv: { gear: slots }, zone: 0, pos: [0, 0, 0] };
  const p = { id: 1, char, hp: 1 };

  // the server's refreshStats, step by step
  const passes = () => {
    let st = rules.characterStats(skills, race, { weaponSkill: skills[wKey] || 0, weaponDamage: wKey === 'martial' ? null : 0 });
    const base = st;
    st = gear.pass(st, { worn: gear.worn(char, L.items), skills, map: null, weaponSkill: skills[wKey] || 0,
      skillOfRef: rules.skillOfRef, statClamp: rules.statClamp, raceRow: rules.raceRow, STAT_PASS: rules.STAT_PASS, statOk: L.gearStatOk });
    return { base, geared: st };
  };
  const fx = L.createActiveEffects({ rules, techniques: L.techniques, items: L.items, maps: null, world: null, epochMs: 0, gameNow: () => 0, rand: () => 0.5 });
  fx.ready(p);
  let { base, geared } = passes();
  fx.sheet(p, geared);              // the unbuffed numbers become the effects' base
  p.hp = geared.maxHp;
  // worn-item techniques light after their warm-up: run the server's 16 ms frames for a while
  let t = 0;
  fx.tick(t);
  for (let i = 0; i < 40; i++) { t += 500; fx.tick(t); }
  const refused = [];
  for (const id of req.buffs || []) {
    const tech = L.techniques.get(Number(id));
    if (!tech) { refused.push({ id, why: 'unknown technique' }); continue; }
    const r = fx.apply(p, p, tech, { m: 1 });   // as the server's technique use (technique-use.cjs resolve)
    if (!r.ok) refused.push({ id, why: r.why });
    else if (r.out && r.out.refused && r.out.refused.length) refused.push({ id, why: r.out.refused.map((x) => x.why || x).join(', ') });
  }
  for (let i = 0; i < 4; i++) { t += 100; fx.tick(t); }
  ({ base, geared } = passes());
  const final = fx.sheet(p, geared);
  const active = fx.list(p).map((s) => s.id);

  return {
    race, sex, weaponSkill: { ref: wRef, key: wKey, value: skills[wKey] || 0 },
    base, geared, final,
    pieces: pieces.map((x) => ({
      index: x.index, id: x.id, slot: x.slot, kind: x.def.kind, name: x.def.name, name_en: x.def.name_en,
      need: geared.needs ? geared.needs[x.slot] : null,
      bonuses: (x.def.cls && x.def.cls.bonuses) || [],
      armour: (x.def.cls && x.def.cls.derived && x.def.cls.derived.armour_class) || 0,
      damage: (x.def.cls && x.def.cls.derived && x.def.cls.derived.damage_used) || 0,
      dressing: x.def.cls && x.def.cls.dressing_level, required: x.def.cls && x.def.cls.required_level,
      requirements: (x.def.cls && x.def.cls.requirements) || [],
      technique: x.def.cls && x.def.cls.technique ? techLabel(L, x.def.cls.technique) : null,
      weight: x.def.weight,
    })),
    active: active.map((id) => techLabel(L, id)),
    refused,
    carried: pieces.reduce((s, x) => s + (x.def.weight || 0), 0),
  };
}

function techLabel(L, id) {
  const t = L.techniques.get(id);
  if (!t) return { id, name: '?', steps: [], stats: [] };
  return { id, name: t.name, name_en: t.name_en || '', desc: descOf(t), dur: durationOf(t), steps: allSteps(t), stats: statSteps(L, t) };
}
const stepsOf = (t) => (t.steps || []).slice(0, Math.max(0, t.step_count | 0));
// every effect step: [op, param, value]
// steps whose param is a technique id (technique-opcodes.json): the technique they run is expanded under them
const TECH_PARAM = new Set([22, 79, 86, 133, 136, 165, 224, 241, 261, 286]);
let TECHS = null;   // the loaded technique map, for the expansion
function allSteps(t, depth = 0, seen = new Set([t.id])) {
  return stepsOf(t).map((s) => {
    const row = [s.op, s.param, s.value];
    if (TECH_PARAM.has(s.op) && depth < 3 && TECHS && !seen.has(s.param)) {
      const sub = TECHS.get(s.param);
      if (sub) row.push({ id: sub.id, name: sub.name, dur: durationOf(sub), steps: allSteps(sub, depth + 1, new Set([...seen, sub.id])) });
    }
    return row;
  });
}
// the lasting stat steps of a technique: [op, stat id, value] (value = the step's number; the engine scales it)
function statSteps(L, t) { return stepsOf(t).filter((s) => STAT_OPS.has(s.op)).map((s) => [s.op, s.param, s.value]); }
const descOf = (t) => String(t.description || '').replace(/\\n/g, '\n').trim();   // some texts keep a written "\n"
// how long a slot lasts, seconds (active-effects framesTotal: period 1 -> count frames, period > 1 -> count x period;
// type 5 masteries and gear effects never run out: -1; period 0 is an amount, not a time: null)
function durationOf(t) {
  if ((t.type & 0xffff) === 5) return -1;
  const d = t.derived || {}, n = (d.effect_count ?? t.effect_count) | 0, per = (d.effect_period_ticks ?? t.effect_period_ticks) | 0;
  if (n < 1) return null;
  if (per === 1) return Math.round(n * 0.016 * 10) / 10;
  if (per > 1) return Math.round(n * per * 0.016 * 10) / 10;
  return null;
}

let META = null;
function meta() {
  if (META) return META;
  const L = load();
  const sk = L.gameData.skill_table.skills;
  const skills = Object.entries(sk).filter(([, r]) => r.ref > 0 && !(r.flags & 64))
    .map(([key, r]) => ({ ref: r.ref, key, name: r.name, name_ja: r.name_ja, group: r.group, cap: r.cap }))
    .sort((a, b) => a.ref - b.ref);
  const stats = {};
  for (const [id, s] of Object.entries(L.statTable)) stats[id] = { name: s.name || '', name_ja: s.name_ja || s.name || '', short: s.short || '', min: s.min, max: s.max };
  const races = {};
  for (const [key, r] of Object.entries(L.gameData.race_table.races || {})) races[key] = { name: r.name, name_ja: r.name_ja || r.name };
  // buffs: techniques with a lasting stat step that a player can learn (a learn list names them) and the item
  // techniques (foods, potions); each with its first required skill and level
  const learnable = (t) => t.derived && t.derived.learn_list != null;
  // the item each technique comes from (a food, potion, scroll or a worn piece: item class record +technique)
  const fromItem = new Map();
  for (const it of L.itemsRaw) {
    const tid = it.cls && it.cls.technique;
    if (!tid) continue;
    if (!fromItem.has(tid)) fromItem.set(tid, []);
    const l = fromItem.get(tid);
    if (l.length < 3) l.push(it.name);
  }
  const buffs = [], techs = [], seen = new Set(), names = {};
  for (const t of L.techRaw) {
    if (!t.name || t.name.startsWith('*')) continue;
    const steps = allSteps(t);
    const need = (t.needs || []).filter((n) => n.skill > 0 && n.level >= 0).map((n) => [n.skill, n.level]);
    const key = t.name + JSON.stringify(need) + JSON.stringify(steps);   // age / event copies of the same technique once
    if (seen.has(key)) continue;
    seen.add(key);
    names[t.id] = t.name;
    const lasting = durationOf(t) !== null && steps.length > 0;
    if (learnable(t)) techs.push({ id: t.id, n: t.name, e: t.name_en || '', t: t.type, need, cost: t.derived && t.derived.cost || 0, buff: lasting });
    if (lasting && (learnable(t) || fromItem.has(t.id) || t.type === 1)) buffs.push({ id: t.id, n: t.name, e: t.name_en || '', need, steps, desc: descOf(t), dur: durationOf(t), learn: learnable(t), items: fromItem.get(t.id) || [] });
  }
  META = { skills, stats, races, names, buffs, techs, total: L.rules.C.SKILL_CAP || 850, startCap: L.rules.C.SKILL_LIMIT_BASE || 70 };
  return META;
}

module.exports = { compute, meta, load };
