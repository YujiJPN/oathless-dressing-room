// ステータス・スキルシミュレーター・強化（バフ）. Every number comes from the game server's own stat code
// (viewer/status-engine.cjs through /api/status): the base pass from the skills and race, the gear pass from the worn
// items, the buffs and worn-item techniques through the effect-step interpreter. This page only shows them.
// Shown text is Japanese, names from the game's own tables (stats, skills, races, items, techniques).
import { OP_JA, stepValue, PARAM_IN_VALUE } from './op-ja.js';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
const num = (v) => (v == null || !Number.isFinite(+v) ? '—' : (Math.round(+v * 100) / 100).toString());
const signed = (v) => (Math.abs(v) < 1e-6 ? '<span class="dim">·</span>' : `<span class="${v > 0 ? 'up' : 'down'}">${v > 0 ? '+' : ''}${num(v)}</span>`);

const store = {
  get(k, d) { try { const v = localStorage.getItem('dr.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('dr.' + k, JSON.stringify(v)); } catch { /* private window */ } },
};
const st = { block: '1', worn: [], skills: store.get('skills', {}), buffs: store.get('buffs', []), buffQ: '', buffMine: false, sheet: null };

// the dressing room (app.js) tells the race and the worn items; listened for before the first await so none is missed
document.addEventListener('outfit', (e) => { st.block = e.detail.block; st.worn = e.detail.worn; refresh(); });

// tabs
document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelectorAll('aside.right .tab').forEach((s) => { s.hidden = s.id !== 'tab-' + b.dataset.tab; });
}));

const meta = await fetch('/api/status-meta').then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status)))).catch((e) => { $('sheet').textContent = 'ステータス計算を読み込めません: ' + e.message; return null; });
const skillName = (ref) => { const s = meta && meta.skills.find((x) => x.ref === ref); return s ? s.name_ja || s.name : '#' + ref; };
const statName = (id) => { const s = meta && meta.stats[id]; return s ? s.name_ja || s.name : 'ステータス ' + id; };
const raceName = (key) => (meta && meta.races[key] ? meta.races[key].name_ja : key);
// the stat a step names: 0x62 all of stats 0-11 and 21, 0x61 / 97 all resists (opcode notes)
const stepStat = (op, p) => (p === 0x62 ? '全ステータス' : p === 0x61 || (op === 0x93 && p === 97) ? '全属性耐性' : statName(p));
const STAT_OPS = new Set([0x29, 0x93, 0x97]);
// one effect step in words: the step's Japanese name (op-ja.js), what its param names, its number in its unit, and
// for a step that runs another technique (chains, procs, auto-revive ...) that technique's own steps in brackets
function stepText([op, p, v, sub]) {
  if (STAT_OPS.has(op)) return `${stepStat(op, p)} ${v > 0 ? '+' : ''}${num(v)}${op === 0x93 ? '%' : ''}`;
  const [name, kind] = OP_JA[op] || [`効果 ${op}`, ''];
  let target = '';
  if (kind === 'skill') target = skillName(p);
  else if (kind === 'tech') target = sub ? sub.name : (meta && meta.names[p]) || (p > 0 ? '#' + p : '');
  else if (!PARAM_IN_VALUE.has(op) && p && p !== -1) target = (kind === 'element' ? '属性 ' : kind === 'race' ? '種族 ' : '') + p;
  const val = kind === 'tech' && !sub ? '' : stepValue(op, p, v);
  let text = `${name}${target ? '（' + esc(target) + '）' : ''}${val ? ' ' + val : ''}`;
  if (sub) text += ` → [${sub.steps.map(stepText).join('、') || '—'}${durText(sub.dur) ? ' ・ ' + durText(sub.dur) : ''}]`;
  return text;
}
const durText = (d) => (d === -1 ? '常時' : d == null ? '' : d >= 60 ? `効果時間 ${num(d / 60)}分` : `効果時間 ${num(d)}秒`);
// a technique's details: its steps, how long it lasts and its own description
const details = (x) => `<div class="tag">${x.steps.map(stepText).join('、') || '—'}${durText(x.dur) ? ' ・ ' + durText(x.dur) : ''}</div>`
  + (x.desc ? `<div class="desc">${esc(x.desc).replace(/\n/g, '<br>')}</div>` : '');
const have = (ref) => Number(st.skills[ref]) || 0;
const needsMet = (need) => need.every(([s, lv]) => have(s) >= lv);
const GROUP_JA = { Base: '基本', Expertise: '専門', Field: 'フィールド', Life: '生活' };

// ---------- compute ----------
let timer = 0, seq = 0;
function refresh() { clearTimeout(timer); timer = setTimeout(compute, 120); }
async function compute() {
  if (!meta) return;
  const my = ++seq;
  const r = await fetch('/api/status', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ block: Number(st.block), skills: st.skills, worn: st.worn, buffs: st.buffs }) });
  if (my !== seq) return;
  if (!r.ok) { $('sheet').textContent = 'エラー: ' + (await r.text()).split('\n')[0]; return; }
  st.sheet = await r.json();
  renderSheet(); renderBuffs();
}

// ---------- status ----------
// rows in the status window's order (FUN_0047fc70): HP / MP / ST, then the combat stats; names from the stat table
const ROWS = [['maxHp', 0], ['maxMana', 1], ['maxStamina', 21], ['attack', 2], ['hit', 3], ['defence', 4], ['evasion', 5], ['spellPower', 6]];
const RES = [['neutral', 7], ['fire', 8], ['water', 9], ['wind', 10], ['earth', 11]];
function renderSheet() {
  const s = st.sheet; if (!s) return;
  const { base, geared, final } = s;
  const row = (label, b, g, f) => `<tr><td>${esc(label)}</td><td>${num(b)}</td><td>${signed(g - b)}</td><td>${signed(f - g)}</td><td class="fin">${num(f)}</td></tr>`;
  let h = `<div class="tag">${esc(raceName(s.race))} ${s.sex === 1 ? '男' : '女'} ・ 武器スキル ${esc(skillName(s.weaponSkill.ref))} ${num(s.weaponSkill.value)}</div>`;
  h += '<h2>最終ステータス</h2><table class="st"><tr><th>項目</th><th>スキル</th><th>装備</th><th>強化</th><th>最終</th></tr>';
  for (const [k, id] of ROWS) h += row(statName(id), base[k], geared[k], final[k]);
  for (const [el, id] of RES) h += row(statName(id), base.resists[el], geared.resists[el], final.resists[el]);
  h += row(statName(13), base.carry, geared.carry, final.carry);
  h += `</table><div class="tag">装備重量 ${num(s.carried)} / ${num(final.carry)}</div>`;
  const other = Object.entries(final.ids || {}).filter(([, v]) => Math.abs(v) > 1e-6);
  if (other.length) {
    h += '<h2>その他の変化</h2><table class="st"><tr><th>項目</th><th>装備</th><th>強化</th><th>合計</th></tr>';
    for (const [id, v] of other) { const g = (geared.gear || {})[id] || 0; h += `<tr><td>${esc(statName(+id))}</td><td>${signed(g)}</td><td>${signed(v - g)}</td><td class="fin">${signed(v)}</td></tr>`; }
    h += '</table>';
  }
  h += '<h2>装備</h2>';
  if (!s.pieces.length) h += '<div class="dim">装備なし</div>';
  for (const p of s.pieces) {
    const lines = [];
    if (p.damage) lines.push(`ダメージ ${num(p.damage)}`);
    if (p.armour) lines.push(`AC ${num(p.armour)}`);
    for (const [id, v] of p.bonuses) if (id >= 0 && v) lines.push(`${esc(statName(id))} ${v > 0 ? '+' : ''}${num(v)}`);
    const req = [];
    if (p.dressing) req.push(`${esc(skillName(18))} ${num(p.dressing)}`);
    if (p.required) req.push(`${p.slot === 11 ? esc(skillName(s.weaponSkill.ref)) : 'スキル'} ${num(p.required)}`);
    for (const [ref, lv] of p.requirements) if (ref >= 0 && lv > 0) req.push(`${esc(skillName(ref))} ${num(lv)}`);
    const need = p.need == null ? '' : p.need >= 1 ? '<span class="up">条件を満たしている</span>' : p.need <= 0 ? '<span class="down">条件不足：効果なし</span>' : `<span class="warn">条件 ${Math.round(p.need * 100)}%</span>`;
    h += `<div class="piece"><b>${esc(p.name)}</b> <span class="tag">重さ ${num(p.weight)}</span><br>${lines.join(' ・ ') || '<span class="dim">能力なし</span>'}`
      + `${req.length ? `<br><span class="tag">必要 ${req.join('、')}</span> ${need}` : ''}`
      + `${p.technique ? `<div class="fx">✦ ${esc(p.technique.name)}</div>${details(p.technique)}` : ''}</div>`;
  }
  if (s.active.length) h += '<h2>効果中</h2>' + s.active.map((a) => `<div class="piece"><b>${esc(a.name)}</b>${details(a)}</div>`).join('');
  if (s.refused.length) h += '<h2>かからなかった強化</h2>' + s.refused.map((r) => `<div class="piece warn">${r.id}: ${esc(r.why)}</div>`).join('');
  $('sheet').innerHTML = h;
}

// ---------- skill simulator ----------
function renderSkills() {
  if (!meta) return;
  const total = meta.skills.reduce((a, s) => a + have(s.ref), 0);
  const groups = [...new Set(meta.skills.map((s) => s.group))];
  let h = `<div class="total">合計 <b class="${total > meta.total ? 'down' : 'up'}">${num(total)}</b> / ${meta.total}`
    + `${total > meta.total ? ' <span class="down">上限超え</span>' : ''} ・ <button id="skzero">すべて0</button></div>`
    + `<div class="tag">各スキルの上限は最初 ${meta.startCap}。それ以上は石が必要（100まで）</div>`;
  for (const g of groups) {
    h += `<h2>${esc(GROUP_JA[g] || g)}</h2>`;
    for (const s of meta.skills.filter((x) => x.group === g)) {
      const v = have(s.ref);
      h += `<div class="sk${v > meta.startCap ? ' over' : ''}"><span>${esc(s.name_ja || s.name)}</span>`
        + `<input type="number" min="0" max="100" step="0.1" value="${v}" data-ref="${s.ref}"><input type="range" min="0" max="100" step="1" value="${v}" data-ref="${s.ref}"></div>`;
    }
  }
  h += '<h2>使えるテクニック</h2><div id="usable"></div>';
  $('skillsim').innerHTML = h;
  $('skillsim').querySelectorAll('input[data-ref]').forEach((inp) => inp.addEventListener('input', () => {
    const v = Math.max(0, Math.min(100, Number(inp.value) || 0));
    st.skills[inp.dataset.ref] = v; if (!v) delete st.skills[inp.dataset.ref];
    $('skillsim').querySelectorAll(`input[data-ref="${inp.dataset.ref}"]`).forEach((o) => { if (o !== inp) o.value = v; });
    inp.closest('.sk').classList.toggle('over', v > meta.startCap);
    const t = meta.skills.reduce((a, s) => a + have(s.ref), 0);
    const tb = $('skillsim').querySelector('.total b'); tb.textContent = num(t); tb.className = t > meta.total ? 'down' : 'up';
    store.set('skills', st.skills); renderUsable(); refresh();
  }));
  $('skzero').addEventListener('click', () => { st.skills = {}; store.set('skills', st.skills); renderSkills(); refresh(); });
  renderUsable();
}
// techniques whose every requirement is met, by their first required skill; cost cut = average over the required
// skills of clamp((skill - need) x 0.02, 0, 0.2) (FUN_006095b0, combat-code 2.13)
function renderUsable() {
  const ranked = meta.techs.filter((t) => t.need.some(([, lv]) => lv > 0));   // with a real skill requirement
  const usable = ranked.filter((t) => needsMet(t.need));
  const by = new Map();
  for (const t of usable) { const k = t.need[0][0]; if (!by.has(k)) by.set(k, []); by.get(k).push(t); }
  const cut = (t) => t.need.reduce((a, [s, lv]) => a + Math.min(0.2, Math.max(0, (have(s) - lv) * 0.02)), 0) / t.need.length;
  let h = `<div class="tag">スキル条件のあるテクニック ${ranked.length} 中 ${usable.length} が使用可能</div>`;
  for (const [k, list] of [...by].sort((a, b) => a[0] - b[0])) {
    list.sort((a, b) => b.need[0][1] - a.need[0][1]);
    h += `<details><summary>${esc(skillName(k))} <span class="tag">${list.length}</span></summary><div class="list">`
      + list.map((t) => `<div>${esc(t.n)} <span class="tag">必要 ${t.need.map(([s, lv]) => esc(skillName(s)) + ' ' + num(lv)).join('、')}`
        + `${cut(t) > 0 ? ` ・ 消費 −${Math.round(cut(t) * 100)}%` : ''}${t.buff ? ' ・ <span class="fx">強化</span>' : ''}</span></div>`).join('') + '</div></details>';
  }
  $('usable').innerHTML = h;
}

// ---------- buffs ----------
function renderBuffs() {
  if (!meta) return;
  const on = new Set(st.buffs);
  const q = st.buffQ.trim().toLowerCase();
  const hits = [];
  for (const b of meta.buffs) {
    if (on.has(b.id)) continue;
    if (st.buffMine && !needsMet(b.need)) continue;
    if (q && !(b.n.toLowerCase().includes(q) || b.e.toLowerCase().includes(q) || b.items.some((n) => n.toLowerCase().includes(q)) || b.steps.some((x) => stepText(x).toLowerCase().includes(q)))) continue;
    hits.push(b);
  }
  const shown = hits.slice(0, 200);
  const line = (b) => `<b>${esc(b.n)}</b> <span class="tag">${b.need.some(([, lv]) => lv > 0) ? '必要 ' + b.need.filter(([, lv]) => lv > 0).map(([s, lv]) => esc(skillName(s)) + ' ' + num(lv)).join('、') : ''}${b.items.length ? ' ・ アイテム：' + b.items.map(esc).join('、') : ''}</span>${details(b)}`;
  let h = '<h2>かかっている強化</h2>';
  h += st.buffs.length ? '<div class="list">' + st.buffs.map((id) => { const b = meta.buffs.find((x) => x.id === id); return `<div>${b ? line(b) : id} <button data-off="${id}">×</button></div>`; }).join('') + '</div>' : '<div class="dim">なし</div>';
  h += `<div class="row"><button id="buffclear">すべて外す</button></div><h2>強化を追加</h2>`
    + `<input id="buffq" type="text" placeholder="名前またはステータス（例：攻撃力、防御）…" value="${esc(st.buffQ)}">`
    + `<label><input id="buffmine" type="checkbox"${st.buffMine ? ' checked' : ''}> 今のスキルで使えるものだけ</label>`
    + `<div class="tag">${hits.length} 件${hits.length > shown.length ? `（${shown.length} 件まで表示。検索で絞り込めます）` : ''}</div><div class="list">${shown.map((b) => `<div data-id="${b.id}">${line(b)}</div>`).join('') || '<div class="dim">該当なし</div>'}</div>`
    + '<div class="tag">ゲームの効果処理でサーバーと同じようにかけています。同系統の強化はゲーム同様に上書きされます</div>';
  const focus = document.activeElement && document.activeElement.id === 'buffq';
  $('buffs').innerHTML = h;
  if (focus) { const i = $('buffq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  $('buffq').addEventListener('input', () => { st.buffQ = $('buffq').value; renderBuffs(); });
  $('buffmine').addEventListener('change', () => { st.buffMine = $('buffmine').checked; renderBuffs(); });
  $('buffclear').addEventListener('click', () => { st.buffs = []; store.set('buffs', st.buffs); renderBuffs(); refresh(); });
  $('buffs').querySelectorAll('[data-off]').forEach((b) => b.addEventListener('click', () => { st.buffs = st.buffs.filter((x) => x !== Number(b.dataset.off)); store.set('buffs', st.buffs); renderBuffs(); refresh(); }));
  $('buffs').querySelectorAll('.list div[data-id]').forEach((d) => d.addEventListener('click', () => { if (st.buffs.length < 24) st.buffs.push(Number(d.dataset.id)); store.set('buffs', st.buffs); renderBuffs(); refresh(); }));
}

renderSkills(); renderBuffs(); refresh();
