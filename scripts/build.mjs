#!/usr/bin/env node
// Fit101 build: data/*.json (+ content/*.md) → docs/*.md (English foo.md + Chinese foo.zh-CN.md) → html-author → site/
//
//   node scripts/build.mjs            # real data: data/exercises.json, sessions.json, next.json, assets/body-map.svg, assets/anim/
//   node scripts/build.mjs --sample   # temporary data under data/_sample/ (exercises, sessions, body-map.svg, anim/)
//
// docs/ and site/ are generated and wiped on every run; do not edit them by hand.
import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE = process.argv.includes('--sample');
const DATA = SAMPLE ? path.join(ROOT, 'data', '_sample') : path.join(ROOT, 'data');
const ASSETS = path.join(ROOT, 'assets');
const CONTENT = path.join(ROOT, 'content');
const BODY_MAP = SAMPLE ? path.join(DATA, 'body-map.svg') : path.join(ASSETS, 'body-map.svg');
const PLACEHOLDER_ANIM = path.join(ROOT, 'data', '_sample', 'anim', 'goblet-squat.svg');
const DOCS = path.join(ROOT, 'docs');
const SITE = path.join(ROOT, 'site');
const HTML_AUTHOR = path.join(os.homedir(), '.claude', 'skills', 'html-author', 'scripts', 'build_pages.mjs');

const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
const exercises = readJson(path.join(DATA, 'exercises.json'));
const sessions = readJson(path.join(DATA, 'sessions.json')).map((s) => ({ ...s, kind: s.kind === 'self' ? 'self' : 'trainer' }))
  .sort((a, b) => (a.kind === b.kind ? a.n - b.n : a.kind === 'trainer' ? -1 : 1));
const NEXT_FILE = path.join(DATA, 'next.json');
const next = existsSync(NEXT_FILE) ? readJson(NEXT_FILE) : null;
const exById = new Map(exercises.map((e) => [e.id, e]));

// Missing data is reported at the end instead of failing the build.
const missing = new Map(); // what → Set(ids)
const miss = (what, id) => { if (!missing.has(what)) missing.set(what, new Set()); missing.get(what).add(id); };

// Exercises from SPEC §12 that may not be in exercises.json yet: enough to draw a card.
const FALLBACK_EX = {
  'incline-db-press': { zh: '上斜哑铃卧推', en: 'Incline Dumbbell Press', equipment: '哑铃 ×2 + 上斜凳（30°）', equipment_en: '2 dumbbells + incline bench (30°)',
    muscles: { primary: ['chest', 'front-delt'], secondary: ['triceps'] } },
  'lat-pulldown': { zh: '高位下拉', en: 'Lat Pulldown', equipment: '高位下拉机', equipment_en: 'lat pulldown machine',
    muscles: { primary: ['lats'], secondary: ['biceps', 'rear-delt', 'upper-back'] } },
  // SPEC §13 stretches
  'childs-pose': { type: 'stretch', zh: '婴儿式', en: "Child's Pose", equipment: '自重，跪姿', equipment_en: 'bodyweight, kneeling',
    muscles: { primary: ['lats', 'lower-back'], secondary: ['glutes'] } },
  'triceps-stretch': { type: 'stretch', zh: '过头肱三头拉伸', en: 'Overhead Triceps Stretch', equipment: '自重，站姿', equipment_en: 'bodyweight, standing',
    muscles: { primary: ['triceps'], secondary: ['lats'] } },
  'open-book': { type: 'stretch', zh: '开书式', en: 'Open Book', equipment: '自重，侧卧', equipment_en: 'bodyweight, lying on your side',
    muscles: { primary: ['chest', 'obliques'], secondary: ['front-delt', 'upper-back'] } },
  'doorway-pec-stretch': { type: 'stretch', zh: '门框胸部拉伸', en: 'Doorway Pec Stretch', equipment: '门框或深蹲架立柱', equipment_en: 'door frame or squat-rack upright',
    muscles: { primary: ['chest', 'front-delt'], secondary: ['biceps'] } },
};
function exercise(id) {
  if (exById.has(id)) return exById.get(id);
  miss('exercises.json entry', id);
  const f = FALLBACK_EX[id] || { zh: id, en: id, equipment: '', muscles: { primary: [], secondary: [] } };
  const ex = { id, cue: '', cue_en: '', anim: `anim/${id}.svg`, ...f };
  exById.set(id, ex);
  return ex;
}

// ── labels: every piece of UI text, both languages ──────────────────────────
const labels = {
  zh: {
    equipment: '器械', setsReps: '组 × 次', rest: '休息', weight: '重量', history: '历次记录', note: '备注', target: '目标重量', how: '怎么选',
    cue: '要点', muscles: '练到的肌肉', primary: '主要', secondary: '辅助', none: '无', appears: '出现在', best: '最好成绩',
    notRecorded: '未记录', notYet: '尚未出现', noBest: '暂无记录', unitTbc: '重量单位待确认', noDetail: '无具体记录。', anim: '动画',
    planned: '待上课', done: '已上', trainer: '教练课', self: '自练', restIn: (r) => `组间休息 ${r}`, exCount: (n) => `${n} 个动作`,
    sessionNo: (n) => `第 ${n} 节`, selfNo: (n) => `自练 ${n}`, sessionTitle: (n, t) => `第 ${n} 节 · ${t}`, selfTitle: (n, t) => `自练 ${n} · ${t}`,
    plannedTitle: (n) => `第 ${n} 节 · 待上课`, plannedText: '上完课后告诉 Claude 这节课的动作和重量，这一页会自动更新。', workout: '训练',
    weekday: { 周一: '周一', 周二: '周二', 周三: '周三', 周四: '周四', 周五: '周五', 周六: '周六', 周日: '周日' },
    block: (name) => name,
    libraryTitle: '动作库', libraryDek: (n) => `${n} 个动作 · 动画、要点和练到的肌肉 · “出现在”和“最好成绩”从已上的课汇总。`,
    nextTitle: '下次训练', goal: '目标', why: '为什么这样安排', cooldown: '放松', after: '练完之后',
    homeDek: (done, total) => `12 节私教课和自练的记录：每节课做了哪些动作、几组几次、用了多重，每个动作配一段动画、一句要点和练到的肌肉图。教练课已上 ${done} 节，共 ${total} 节。重量以 lb 记，括号里是 kg。`,
    trainerSessions: '教练课', selfSessions: '自练', noSelf: '还没有自练记录。练完一次自练后告诉 Claude，这里会出现记录。',
    th: ['节', '日期', '状态', '动作数', '链接'], nextLink: (n) => `[下次训练](next-session.zh-CN.md)：${n.date} ${n.weekday} ${n.time} · ${n.title}`,
    noNext: '还没有安排下次训练。', libraryLink: (n) => `[动作库](library.zh-CN.md)：全部 ${n} 个动作，带“出现在哪几节课”和“最好成绩”。`,
    knowledgeHead: '饮食与知识', knowledgeLink: '[饮食与知识](knowledge.zh-CN.md)：热量、三大营养素、餐序、吃什么、有氧和力训原则。',
    knowledgeSoon: '饮食与知识页还在整理中。', strength: '力量动作', stretches: '拉伸与放松',
  },
  en: {
    equipment: 'Equipment', setsReps: 'Sets × reps', rest: 'Rest', weight: 'Weight', history: 'History', note: 'Note', target: 'Target', how: 'How to choose',
    cue: 'Key cue', muscles: 'Muscles worked', primary: 'Primary', secondary: 'Secondary', none: 'none', appears: 'Appears in', best: 'Best',
    notRecorded: 'not recorded', notYet: 'not yet', noBest: 'no record yet', unitTbc: 'weight unit to be confirmed', noDetail: 'Nothing specific recorded.', anim: 'animation',
    planned: 'Planned', done: 'Done', trainer: 'Trainer session', self: 'Self session', restIn: (r) => `rest ${r} between sets`, exCount: (n) => `${n} exercises`,
    sessionNo: (n) => `Session ${n}`, selfNo: (n) => `Self ${n}`, sessionTitle: (n, t) => `Session ${n} · ${t}`, selfTitle: (n, t) => `Self Session ${n} · ${t}`,
    plannedTitle: (n) => `Session ${n} · Planned`, plannedText: 'After the session, tell Claude the exercises and weights and this page will update.', workout: 'Workout',
    weekday: { 周一: 'Monday', 周二: 'Tuesday', 周三: 'Wednesday', 周四: 'Thursday', 周五: 'Friday', 周六: 'Saturday', 周日: 'Sunday' },
    block: (name) => name.replace(/^热身/, 'Warm-up').replace(/^第一组/, 'Block 1').replace(/^第二组/, 'Block 2').replace(/^第三组/, 'Block 3')
      .replace(/^第四组/, 'Block 4').replace(/^放松/, 'Cool-down').replace(/^收尾/, 'Finisher'),
    libraryTitle: 'Exercise Library', libraryDek: (n) => `${n} exercises · animation, key cue and muscles worked · “Appears in” and “Best” are collected from the sessions so far.`,
    nextTitle: 'Next Session', goal: 'Goal', why: 'Why this plan', cooldown: 'Cool-down', after: 'After the session',
    homeDek: (done, total) => `A log of 12 personal-training sessions and the workouts in between: the exercises, sets, reps and weights of each, with an animation, a key cue and a muscle map for every exercise. ${done} of ${total} trainer sessions done. Weights are in lb with kg in brackets.`,
    trainerSessions: 'Trainer sessions', selfSessions: 'Self sessions', noSelf: 'No self sessions logged yet. After one, tell Claude and it will show up here.',
    th: ['#', 'Date', 'Status', 'Exercises', 'Link'], nextLink: (n) => `[Next session](next-session.md): ${n.date} ${n.weekday_en || n.weekday} ${n.time} · ${n.title_en || n.title}`,
    noNext: 'No next session planned yet.', libraryLink: (n) => `[Exercise library](library.md): all ${n} exercises, with where each appears and your best.`,
    knowledgeHead: 'Nutrition & knowledge', knowledgeLink: '[Nutrition & knowledge](knowledge.md): calories, macros, meal order, what to eat, cardio and strength principles.',
    knowledgeSoon: 'The nutrition and knowledge page is still being written.', strength: 'Strength', stretches: 'Stretches & Cool-down',
  },
};
const MUSCLES = {
  chest: ['胸大肌', 'Chest'], 'front-delt': ['肩前束', 'Front delt'], 'side-delt': ['肩中束', 'Side delt'], 'rear-delt': ['肩后束', 'Rear delt'],
  biceps: ['肱二头肌', 'Biceps'], triceps: ['肱三头肌', 'Triceps'], forearms: ['前臂', 'Forearms'], abs: ['腹直肌', 'Abs'], obliques: ['腹斜肌', 'Obliques'],
  'hip-flexors': ['髋屈肌', 'Hip flexors'], quads: ['股四头肌', 'Quads'], adductors: ['内收肌', 'Adductors'], calves: ['小腿', 'Calves'], traps: ['斜方肌', 'Traps'],
  'upper-back': ['上背', 'Upper back'], lats: ['背阔肌', 'Lats'], 'lower-back': ['下背', 'Lower back'], glutes: ['臀大肌', 'Glutes'],
  'glute-med': ['臀中肌', 'Glute med'], hamstrings: ['腘绳肌', 'Hamstrings'],
};
const muscleName = (id, lang) => (MUSCLES[id] ? MUSCLES[id][lang === 'zh' ? 0 : 1] : id);
// Chinese fragments inside reps / weight / rest strings
const FRAGMENTS = [[/每侧/g, 'each side'], [/秒/g, 's'], [/未记录/g, 'not recorded'], [/自重/g, 'bodyweight'], [/分钟/g, 'min'], [/力竭/g, 'to failure'], [/(\d)\s*次/g, '$1 reps'], [/次/g, 'reps']];
const frag = (text, lang) => (lang === 'zh' ? String(text ?? '') : FRAGMENTS.reduce((t, [re, en]) => t.replace(re, en), String(text ?? '')).replace(/(\d)(s)\b/g, '$1 $2').replace(/\s+/g, ' ').trim());
// English field with a Chinese fallback; a missing English value is reported.
function en(obj, key, lang, what, id) {
  if (lang === 'zh') return obj[key];
  if (obj[`${key}_en`]) return obj[`${key}_en`];
  if (obj[key]) miss(what, id);
  return obj[key];
}

// ── helpers ─────────────────────────────────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pad = (n) => String(n).padStart(2, '0');
const kg = (lb) => (Math.round(lb * 0.4536 * 10) / 10).toFixed(1);
const SUFFIX = { en: '', zh: '.zh-CN' };
// every "N lb" / "N-M lb" gets its kg value; anything without "lb" (2.5, 自重, a pin setting) stays as written
const addKg = (text) => String(text ?? '').replace(/(\d+(?:\.\d+)?)(?:\s*[-–~]\s*(\d+(?:\.\d+)?))?\s*lbs?\b(?!\s*\()/gi,
  (all, a, b) => (b ? `${a}-${b} lb (${kg(Number(a))}-${kg(Number(b))} kg)` : `${a} lb (${kg(Number(a))} kg)`));
function weightLb(w) {
  const m = /^\s*([\d.]+)(?:\s*[-–~]\s*([\d.]+))?\s*lbs?\s*$/i.exec(w || '');
  return m ? Number(m[2] || m[1]) : null;
}
function repsBest(r) {
  const nums = (String(r).match(/\d+(?:\.\d+)?/g) || []).map(Number);
  if (!nums.length) return null;
  return { v: Math.max(...nums), unit: /秒/.test(r) ? 's' : /分钟/.test(r) ? 'min' : 'reps', side: /每侧/.test(r) };
}
const pagePath = (s) => `${s.kind === 'self' ? 'self' : 'sessions'}/${pad(s.n)}`;

// Every time an exercise was done, in session order (trainer sessions first, then self sessions).
const history = new Map();
for (const s of sessions) {
  if (s.status !== 'done') continue;
  for (const b of s.blocks || []) for (const it of b.items || []) {
    if (!history.has(it.ex)) history.set(it.ex, []);
    history.get(it.ex).push({ s, block: b.name, ...it });
  }
}
// One entry per session (the working set wins over a warm-up use).
function perSession(id) {
  const out = new Map();
  for (const h of history.get(id) || []) {
    const key = `${h.s.kind}${h.s.n}`, prev = out.get(key);
    if (!prev || (!prev.weight && h.weight) || prev.block === '热身') out.set(key, h);
  }
  return [...out.values()];
}
const sessionNo = (s, lang) => (s.kind === 'self' ? labels[lang].selfNo(s.n) : labels[lang].sessionNo(s.n));
// a weight in lb (or an unknown unit) says more than the reps; bodyweight / no weight shows sets × reps
const recordText = (h, lang) => `${sessionNo(h.s, lang)} ${h.weight && h.weight !== '自重' ? frag(h.weight, lang) : frag(`${h.sets} × ${h.reps}`, lang)}`;
function bestText(id, lang) {
  const t = labels[lang], hs = history.get(id) || [];
  if (!hs.length) return t.noBest;
  let best = null;
  for (const h of hs) { const lb = weightLb(h.weight); if (lb != null && (!best || lb > best.lb)) best = { lb, h }; }
  if (best) return `${addKg(best.h.weight)} × ${frag(best.h.reps, lang)} · ${sessionNo(best.h.s, lang)}`;
  if (hs.some((h) => h.weight && h.weight !== '自重')) return t.unitTbc;
  let top = null;
  for (const h of hs) { const r = repsBest(h.reps); if (r && (!top || r.v > top.r.v)) top = { r, h }; }
  if (!top) return t.noBest;
  const bw = hs.some((h) => h.weight === '自重') ? (lang === 'zh' ? '自重 ' : 'bodyweight, ') : '';
  const unit = lang === 'zh' ? { reps: '次', s: '秒', min: '分钟' }[top.r.unit] : top.r.unit;
  const side = top.r.side ? (lang === 'zh' ? '每侧 ' : '') : '';
  return `${bw}${side}${top.r.v} ${unit}${top.r.side && lang === 'en' ? ' each side' : ''} · ${sessionNo(top.h.s, lang)}`;
}

// ── body map ────────────────────────────────────────────────────────────────
const bodyMapSrc = existsSync(BODY_MAP) ? readFileSync(BODY_MAP, 'utf8') : null;
if (!bodyMapSrc) console.warn(`(no body map at ${path.relative(ROOT, BODY_MAP)}: cards get no muscle figure)`);
let mapCount = 0;
const legend = (ex, lang) => {
  const t = labels[lang], names = (ids) => (ids || []).map((m) => muscleName(m, lang)).join(lang === 'zh' ? '、' : ', ') || t.none;
  return `${t.primary}${lang === 'zh' ? '：' : ': '}${names(ex.muscles?.primary)} · ${t.secondary}${lang === 'zh' ? '：' : ': '}${names(ex.muscles?.secondary)}`;
};
function bodyMap(ex, lang) {
  const p = new Set(ex.muscles?.primary || []), s = new Set(ex.muscles?.secondary || []);
  const k = `bm${++mapCount}-`;
  const svg = bodyMapSrc
    .replace(/<\?xml[\s\S]*?\?>/g, '').replace(/<!DOCTYPE[\s\S]*?>/gi, '').replace(/<!--[\s\S]*?-->/g, '')
    // one card's ids must not collide with another card's on the same page
    .replace(/\bid="([^"]+)"/g, `id="${k}$1"`).replace(/url\(#([^)]+)\)/g, `url(#${k}$1)`).replace(/(xlink:)?href="#([^"]+)"/g, `$1href="#${k}$2"`)
    .replace(/<([a-zA-Z][\w:-]*)(\s[^>]*?)?\bdata-m="([^"]+)"([^>]*)>/g, (all, tag, before = '', m, after) => {
      const add = p.has(m) ? 'p' : s.has(m) ? 's' : '';
      let attrs = `${before}data-m="${m}"${after}`;
      if (!add) return `<${tag}${attrs}>`;
      if (/\bclass="/.test(attrs)) attrs = attrs.replace(/\bclass="([^"]*)"/, (c, v) => `class="${v.split(/\s+/).filter((x) => x && x !== 'p' && x !== 's').concat(add).join(' ')}"`);
      else attrs = ` class="m ${add}"` + attrs;
      return `<${tag}${attrs}>`;
    })
    .replace(/<svg\b([^>]*)>/, (all, a) => {
      const cls = (/\sclass="([^"]*)"/.exec(a)?.[1] || '').split(/\s+/).filter(Boolean).concat('bm').join(' ');
      const rest = a.replace(/\s(width|height|class|role|aria-label)="[^"]*"/g, '');
      return `<svg${rest} class="${cls}" role="img" aria-label="${esc(`${exName(ex, lang)} · ${labels[lang].muscles} · ${legend(ex, lang)}`)}">`;
    });
  // a blank line would end marked's raw-HTML block: keep the SVG on non-empty lines
  return svg.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
}

// ── card ────────────────────────────────────────────────────────────────────
const exName = (ex, lang) => (lang === 'zh' ? ex.zh : ex.en);
const exHeading = (ex, lang) => (lang === 'zh' ? `${ex.zh} · ${ex.en}` : `${ex.en} · ${ex.zh}`);
// up: '../' for pages in a subfolder, '' for root pages. rows: [label, html] (empty html rows are dropped).
// Animation <img>: starts on the static first frame (assets/anim/<id>.poster.svg); ANIM_SCRIPT swaps in the
// animation while the card is within one screen of the viewport. No poster yet → the animation is both.
const ANIM_ROOT = SAMPLE ? DATA : ASSETS;
function animImg(ex, up, alt) {
  const anim = ex.anim || `anim/${ex.id}.svg`, poster = anim.replace(/\.svg$/, '.poster.svg');
  const hasPoster = poster !== anim && existsSync(path.join(ANIM_ROOT, poster));
  if (!hasPoster) miss('animation poster (animation used as poster)', ex.id);
  const a = `${up}assets/${esc(anim)}`, p = hasPoster ? `${up}assets/${esc(poster)}` : a;
  return `<div class="ex-anim"><img src="${p}" data-anim="${a}" data-poster="${p}" alt="${esc(alt)}" width="400" height="300" loading="lazy" decoding="async"></div>`;
}
// Play animations only near the viewport (rootMargin = one screen); without IntersectionObserver, animate all.
const ANIM_SCRIPT = `<script>(function(){var m=document.querySelectorAll('.ex-anim img[data-anim]');if(!m.length)return;`
  + `function set(i,u){if(u&&i.getAttribute('src')!==u)i.setAttribute('src',u)}`
  + `if(!('IntersectionObserver' in window)){for(var j=0;j<m.length;j++)set(m[j],m[j].getAttribute('data-anim'));return}`
  + `var h=Math.max(window.innerHeight||0,document.documentElement.clientHeight||0,600);`
  + `var o=new IntersectionObserver(function(es){es.forEach(function(e){set(e.target,e.target.getAttribute(e.isIntersecting?'data-anim':'data-poster'))})},{rootMargin:h+'px 0px'});`
  + `for(var k=0;k<m.length;k++)o.observe(m[k])})();</script>`;
function card(ex, lang, up, rows) {
  const t = labels[lang];
  const dl = rows.filter(([, v]) => v).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('\n');
  const cue = en(ex, 'cue', lang, 'Exercise.cue_en', ex.id);
  return [
    '<div class="ex">',
    animImg(ex, up, `${exName(ex, lang)} ${t.anim}`),
    '<div class="ex-body">',
    `<dl class="ex-meta">\n${dl}\n</dl>`,
    cue ? `<p class="ex-cue"><b>${esc(t.cue)}</b> ${esc(cue)}</p>` : '',
    `<details class="ex-muscles"><summary>${esc(t.muscles)}</summary>`,
    bodyMapSrc ? `<div class="ex-map">\n${bodyMap(ex, lang)}\n</div>` : '',
    `<p class="ex-legend">${esc(legend(ex, lang))}</p>`,
    '</details>',
    '</div>',
    '</div>',
  ].filter(Boolean).join('\n');
}
const equipment = (ex, lang) => esc(en(ex, 'equipment', lang, 'Exercise.equipment_en', ex.id));
const cssLink = (up) => `<link rel="stylesheet" href="${up}assets/fit.css">`;
// Remember the language picked in the rail: store it on click, follow it on load (only when a twin exists).
const LANG_SCRIPT = `<script>(function(){var K='fit-lang';try{var a=document.querySelector('[data-lang-switch]');`
  + `document.addEventListener('click',function(e){var t=e.target.closest?e.target.closest('[data-lang-switch]'):null;if(t){try{localStorage.setItem(K,t.getAttribute('hreflang')||t.getAttribute('lang'))}catch(x){}}},true);`
  + `var s=localStorage.getItem(K);if(s&&a&&s!==document.documentElement.lang)location.replace(a.href)}catch(e){}})();</script>`;
// English home only: with no stored choice, a zh-* browser goes to the Chinese home (relative URL, works under a subpath).
const HOME_EN_SCRIPT = LANG_SCRIPT.replace(`if(s&&a&&s!==document.documentElement.lang)location.replace(a.href)`,
  `if(s&&a&&s!==document.documentElement.lang)location.replace(a.href);else if(!s&&/^zh/i.test(navigator.language||''))location.replace('index.zh-CN.html')`);
const page = (parts, script = LANG_SCRIPT) => parts.filter((x) => x !== '' && x != null).join('\n\n') + '\n\n' + script + '\n' + (parts.some((x) => typeof x === 'string' && x.includes('class="ex-anim"')) ? ANIM_SCRIPT + '\n' : '');

// ── session pages ───────────────────────────────────────────────────────────
const uniqueCount = (blocks) => new Set((blocks || []).flatMap((b) => (b.items || []).map((it) => it.ex))).size;
const sessionTitle = (s, lang) => {
  const t = labels[lang];
  if (s.status !== 'done') return s.kind === 'self' ? t.selfTitle(s.n, t.planned) : t.plannedTitle(s.n);
  const title = en(s, 'title', lang, 'Session.title_en', pagePath(s)) || t.workout;
  return s.kind === 'self' ? t.selfTitle(s.n, title) : t.sessionTitle(s.n, title);
};
function sessionPage(s, lang) {
  const t = labels[lang], up = '../';
  const kindLabel = s.kind === 'self' ? t.self : t.trainer;
  if (s.status !== 'done') {
    return page([`# ${sessionTitle(s, lang)}`, cssLink(up), `${s.date} · ${t.weekday[s.weekday] || s.weekday} · ${kindLabel} · ${t.planned}`, t.plannedText]);
  }
  const out = [`# ${sessionTitle(s, lang)}`, cssLink(up), `${s.date} · ${t.weekday[s.weekday] || s.weekday} · ${kindLabel} · ${t.exCount(uniqueCount(s.blocks))}`];
  for (const b of s.blocks || []) {
    out.push(`## ${t.block(b.name)}${b.rest ? ` · ${t.restIn(frag(b.rest, lang))}` : ''}`);
    if (!(b.items || []).length) { out.push(t.noDetail); continue; }
    for (const it of b.items) {
      const ex = exercise(it.ex);
      const records = perSession(it.ex);
      out.push(`### ${exHeading(ex, lang)}`);
      out.push(card(ex, lang, up, [
        [t.equipment, equipment(ex, lang)],
        [t.setsReps, esc(frag(`${it.sets} × ${it.reps}`, lang))],
        [t.rest, esc(frag(b.rest || '', lang))],
        [t.weight, esc(it.weight ? frag(addKg(it.weight), lang) : t.notRecorded)],
        [t.history, records.length > 1 ? records.map((h) => (h.s === s ? `<b>${esc(recordText(h, lang))}</b>` : esc(recordText(h, lang)))).join(' · ') : ''],
        [t.note, esc(it.note ? en(it, 'note', lang, 'item.note_en', `${pagePath(s)} ${it.ex}`) : '')],
      ]));
    }
  }
  return page(out);
}

// ── next session ────────────────────────────────────────────────────────────
function nextPage(lang) {
  const t = labels[lang], up = '', n = next, f = (o, k) => (lang === 'zh' ? o[k] : o[`${k}_en`] ?? o[k]);
  const out = [`# ${t.nextTitle}`, cssLink(up),
    `${n.date} · ${lang === 'zh' ? n.weekday : n.weekday_en || n.weekday} · ${n.time} · ${f(n, 'duration')} · ${t.self} · ${f(n, 'title')}`,
    `## ${t.goal}`, f(n, 'goal'),
    `## ${t.why}`, (f(n, 'rationale') || []).map((x) => `- ${x}`).join('\n')];
  const cards = (b) => {
    for (const it of b.items || []) {
      const ex = exercise(it.ex);
      out.push(`### ${exHeading(ex, lang)}`);
      out.push(card(ex, lang, up, [
        [t.equipment, equipment(ex, lang)],
        [t.setsReps, esc(frag(`${it.sets} × ${it.reps}`, lang))],
        [t.rest, esc(f(b, 'rest') || '')],
        [t.target, esc(addKg(f(it, 'target') || ''))],
        [t.how, esc(f(it, 'how') || '')],
        [t.history, perSession(it.ex).map((h) => esc(recordText(h, lang))).join(' · ')],
      ]));
    }
  };
  for (const b of n.blocks || []) { out.push(`## ${f(b, 'name')}`); cards(b); }
  // cool-down: a sentence, then cards like any block when it lists exercises (older next.json: text only)
  if (n.cooldown) { out.push(`## ${t.cooldown}`, f(n.cooldown, 'text')); if ((n.cooldown.items || []).length) cards(n.cooldown); }
  if (n.after) out.push(`## ${t.after}`, (f(n.after, 'items') || []).map((x) => `- [ ] ${x}`).join('\n'));
  return page(out);
}

// ── library ─────────────────────────────────────────────────────────────────
function libraryPage(lang) {
  const t = labels[lang], all = [...exById.values()];
  const out = [`# ${t.libraryTitle}`, cssLink(''), t.libraryDek(all.length)];
  const strength = all.filter((ex) => ex.type !== 'stretch'), stretches = all.filter((ex) => ex.type === 'stretch');
  for (const ex of [...strength, ...stretches]) {
    if (ex === strength[0]) out.push(`## ${t.strength}`);
    if (ex === stretches[0]) out.push(`## ${t.stretches}`);
    const recs = perSession(ex.id);
    out.push(`### ${exHeading(ex, lang)}`);
    out.push(card(ex, lang, '', [
      [t.equipment, equipment(ex, lang)],
      [t.appears, recs.length ? recs.map((h) => `<a href="${pagePath(h.s)}${SUFFIX[lang]}.html">${esc(recordText(h, lang))}</a>`).join(' · ') : t.notYet],
      [t.best, esc(bestText(ex.id, lang))],
    ]));
  }
  return page(out);
}

// ── home ────────────────────────────────────────────────────────────────────
const KNOWLEDGE = { en: path.join(CONTENT, 'knowledge.md'), zh: path.join(CONTENT, 'knowledge.zh-CN.md') };
const hasKnowledge = existsSync(KNOWLEDGE.en) && existsSync(KNOWLEDGE.zh);
function sessionTable(list, lang) {
  const t = labels[lang];
  const rows = list.map((s) => {
    const title = s.status === 'done' ? `${t.done} · ${en(s, 'title', lang, 'Session.title_en', pagePath(s)) || ''}` : t.planned;
    return `| ${s.n} | ${s.date} ${t.weekday[s.weekday] || s.weekday} | ${title} | ${s.status === 'done' ? uniqueCount(s.blocks) : '—'} | [${sessionNo(s, lang)}](${pagePath(s)}${SUFFIX[lang]}.md) |`;
  });
  return `| ${t.th.join(' | ')} |\n|---|---|---|---|---|\n${rows.join('\n')}`;
}
function indexPage(lang) {
  const t = labels[lang];
  const trainer = sessions.filter((s) => s.kind === 'trainer'), self = sessions.filter((s) => s.kind === 'self');
  return page([
    '# Fit101', cssLink(''),
    t.homeDek(trainer.filter((s) => s.status === 'done').length, trainer.length),
    `## ${t.nextTitle}`, next ? t.nextLink(next) : t.noNext,
    `## ${t.trainerSessions}`, sessionTable(trainer, lang),
    `## ${t.selfSessions}`, self.length ? sessionTable(self, lang) : t.noSelf,
    `## ${t.libraryTitle}`, t.libraryLink(exById.size),
    `## ${t.knowledgeHead}`, hasKnowledge ? t.knowledgeLink : t.knowledgeSoon,
  ], lang === 'en' ? HOME_EN_SCRIPT : LANG_SCRIPT);
}

// ── write docs/ ─────────────────────────────────────────────────────────────
// Card-building pages first so every exercise they mention (incl. fallbacks) is known to the library.
const files = new Map();
for (const lang of ['en', 'zh']) {
  for (const s of sessions) files.set(`${pagePath(s)}${SUFFIX[lang]}.md`, sessionPage(s, lang));
  if (next) files.set(`next-session${SUFFIX[lang]}.md`, nextPage(lang));
}
for (const lang of ['en', 'zh']) {
  files.set(`library${SUFFIX[lang]}.md`, libraryPage(lang));
  files.set(`index${SUFFIX[lang]}.md`, indexPage(lang));
}
if (hasKnowledge) for (const lang of ['en', 'zh']) files.set(`knowledge${SUFFIX[lang]}.md`, readFileSync(KNOWLEDGE[lang], 'utf8').replace(/\s*$/, '\n\n') + LANG_SCRIPT + '\n');
else console.warn('content/knowledge.md or content/knowledge.zh-CN.md missing: knowledge page skipped');
if (!next) console.warn('data/next.json missing: next-session page skipped');

rmSync(DOCS, { recursive: true, force: true });
for (const [rel, text] of files) {
  mkdirSync(path.dirname(path.join(DOCS, rel)), { recursive: true });
  writeFileSync(path.join(DOCS, rel), text);
}

// ── html-author → site/ (English default; *.zh-CN.md pair with their twins) ─
rmSync(SITE, { recursive: true, force: true });
execFileSync(process.execPath, [HTML_AUTHOR, '--src', DOCS, '--out', SITE, '--title', 'Fit101', '--no-notes'], { stdio: 'inherit' });

// ── assets/ → site/assets/ (site.css / site.js from html-author stay) ──────
const SKIP = new Set(['contact-sheet.html', 'body-map-preview.html']);
cpSync(ASSETS, path.join(SITE, 'assets'), { recursive: true, filter: (src) => !SKIP.has(path.basename(src)) });
if (SAMPLE) cpSync(path.join(DATA, 'anim'), path.join(SITE, 'assets', 'anim'), { recursive: true });
for (const ex of exById.values()) {
  const f = path.join(SITE, 'assets', ex.anim || `anim/${ex.id}.svg`);
  if (existsSync(f)) continue;
  miss('animation (placeholder used in site/)', ex.id);
  if (existsSync(PLACEHOLDER_ANIM)) { mkdirSync(path.dirname(f), { recursive: true }); copyFileSync(PLACEHOLDER_ANIM, f); }
}

for (const [what, ids] of missing) console.warn(`missing ${what} (${ids.size}): ${[...ids].join(', ')}`);
console.log(`Fit101: ${files.size} Markdown pages (${sessions.length} sessions × 2 languages${next ? ', next session' : ''}${hasKnowledge ? ', knowledge' : ''})${SAMPLE ? ' (sample data)' : ''} → ${path.relative(ROOT, SITE)}/index.html`);

// ── link check: site/ must work from any subpath (GitHub Pages /Fit101/) ────
// No root-absolute href/src ("/x", but "//cdn" and "http…" are fine), no local paths, no file:// URLs.
const htmlFiles = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
  const f = path.join(dir, d.name);
  return d.isDirectory() ? htmlFiles(f) : d.name.endsWith('.html') ? [f] : [];
});
const RULES = [
  ['root-absolute href/src', /\b(?:href|src)\s*=\s*["']?\/(?!\/)[^"'\s>]*/gi],
  ['/Users/ path', /\/Users\/[^"'\s<>]*/g],
  ['file:// URL', /file:\/\/[^"'\s<>]*/gi],
];
const problems = [];
const scanned = htmlFiles(SITE);
for (const f of scanned) {
  const text = readFileSync(f, 'utf8');
  for (const [what, re] of RULES) for (const m of text.matchAll(re)) {
    const a = Math.max(0, m.index - 30), b = Math.min(text.length, m.index + m[0].length + 30);
    problems.push(`  ${path.relative(ROOT, f)}: ${what}: …${text.slice(a, b).replace(/\s+/g, ' ')}…`);
  }
}
if (problems.length) {
  console.error(`link check FAILED: ${problems.length} problem(s) in ${scanned.length} HTML files`);
  for (const p of problems) console.error(p);
  process.exit(1);
}
console.log(`link check passed: ${scanned.length} HTML files, no root-absolute href/src, no /Users/, no file://`);
