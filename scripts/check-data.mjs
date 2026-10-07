// 用法：node scripts/check-data.mjs  —— 校验 data/exercises.json 和 data/sessions.json
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MUSCLES = ['chest','front-delt','side-delt','rear-delt','biceps','triceps','forearms','abs','obliques','hip-flexors','quads','adductors','calves','traps','upper-back','lats','lower-back','glutes','glute-med','hamstrings'];
const BLOCKS = ['热身','第一组','第二组','第三组','放松'];
const KNOWN_IDS = ['step-up','bodyweight-squat','glute-bridge','band-pull-apart','goblet-squat','push-up','trx-row','db-rdl','cable-crossover','cable-fly','half-kneeling-press','farmer-carry','worlds-greatest-stretch','dead-bug','db-reverse-lunge','db-bench-press','pallof-press','tricep-pushdown','bicep-curl','physio-ball','standing-press','plank','weighted-step-up','band-walk',
  'incline-db-press','lat-pulldown',
  'childs-pose','triceps-stretch','open-book','doorway-pec-stretch'];   // 第 3 节 + 第 12 节 + 第 13 节
const errors = [];
const load = f => { try { return JSON.parse(readFileSync(join(root, 'data', f), 'utf8')); } catch (e) { errors.push(`${f}: 不是合法 JSON：${e.message}`); return []; } };

const exercises = load('exercises.json');
const sessions = load('sessions.json');
const ids = new Set();
for (const e of exercises) {
  if (ids.has(e.id)) errors.push(`动作 id 重复：${e.id}`);
  ids.add(e.id);
  for (const k of ['zh','en','equipment','equipment_en','cue','cue_en','anim']) if (typeof e[k] !== 'string' || !e[k]) errors.push(`${e.id}: 缺少 ${k}`);
  if (!KNOWN_IDS.includes(e.id)) errors.push(`${e.id}: 不在 SPEC 第 3 / 12 节的动作清单里`);
  if (e.type !== undefined && e.type !== 'stretch') errors.push(`${e.id}: type 只能是 stretch 或省略：${e.type}`);
  if (e.anim !== `anim/${e.id}.svg`) errors.push(`${e.id}: anim 应为 anim/${e.id}.svg`);
  for (const m of [...(e.muscles?.primary ?? []), ...(e.muscles?.secondary ?? [])])
    if (!MUSCLES.includes(m)) errors.push(`${e.id}: 未知肌肉 id ${m}`);
  if (!e.muscles?.primary?.length) errors.push(`${e.id}: 没有主要肌群`);
}
const seenByKind = { trainer: 0, self: 0 };   // n 按 kind 分组，各自从 1 连续编号
sessions.forEach((s, i) => {
  const kind = s.kind === 'self' ? 'self' : 'trainer';
  seenByKind[kind]++;
  if (s.n !== seenByKind[kind]) errors.push(`第 ${i + 1} 条（${kind}）的 n=${s.n}，应为 ${seenByKind[kind]}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.date)) errors.push(`第 ${s.n} 节日期格式错：${s.date}`);
  const wd = ['周日','周一','周二','周三','周四','周五','周六'][new Date(s.date + 'T12:00:00').getDay()];
  if (wd !== s.weekday) errors.push(`第 ${s.n} 节 ${s.date} 实为 ${wd}，写的是 ${s.weekday}`);
  if (s.status === 'planned' && (s.title || s.blocks)) errors.push(`第 ${s.n} 节 planned 不应有 title/blocks`);
  if (s.status === 'done' && !(s.title && s.blocks)) errors.push(`第 ${s.n} 节 done 缺 title/blocks`);
  if (s.kind !== undefined && !['trainer','self'].includes(s.kind)) errors.push(`第 ${s.n} 节 kind 只能是 trainer/self：${s.kind}`);
  if (s.title && !s.title_en) errors.push(`第 ${s.n} 节有 title 缺 title_en`);
  for (const b of s.blocks ?? []) {
    if (!BLOCKS.includes(b.name)) errors.push(`第 ${s.n} 节 block 名不在约定内：${b.name}`);
    for (const it of b.items) {
      if (!ids.has(it.ex)) errors.push(`第 ${s.n} 节 ${b.name}: 找不到动作 ${it.ex}`);
      if (it.note && !it.note_en) errors.push(`第 ${s.n} 节 ${it.ex}: 有 note 缺 note_en`);
      if (typeof it.sets !== 'string' || typeof it.reps !== 'string') errors.push(`第 ${s.n} 节 ${it.ex}: sets/reps 应为字符串`);
    }
  }
});
if (seenByKind.trainer !== 12) errors.push(`教练课（trainer）应有 12 节，实际 ${seenByKind.trainer}`);

const used = new Set(sessions.flatMap(s => (s.blocks ?? []).flatMap(b => b.items.map(i => i.ex))));
const unused = [...ids].filter(id => !used.has(id));
console.log(`动作 ${exercises.length} 个，课程 ${sessions.length} 节，课程中用到 ${used.size} 个动作${unused.length ? `，未用到：${unused.join(', ')}` : ''}`);
if (errors.length) { console.error('错误：\n- ' + errors.join('\n- ')); process.exit(1); }
console.log('检查通过');
