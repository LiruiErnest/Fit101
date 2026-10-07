#!/usr/bin/env node
// Fit101 · 动作动画生成器
// 读 data/poses.json，为每个动作输出 assets/anim/<id>.svg（纯 SMIL，可放在 <img> 里）
// 以及 assets/anim/contact-sheet.html（全部动画的网格预览）。
//
// 用法：
//   node scripts/gen-anim.mjs                 生成全部
//   node scripts/gen-anim.mjs --only squat,x  只生成指定 id
//   node scripts/gen-anim.mjs --frames <dir>  额外把每个关键帧导出成静态 SVG + index.html（调试用）
//   node scripts/gen-anim.mjs --debug         打印每个关键帧的关节世界坐标
//
// 骨架约定（见 poses.json 的 _doc）：
//   侧视 side：人面朝右（+x）。所有角度单位为度。
//     rot   整个人体绕髋（根）旋转，正 = 顺时针。仰卧头朝左用 -90，俯卧头朝右用 90。
//     torso 躯干前倾，正 = 前倾。
//     armN/armF [s, e]：肩前屈 s（0 = 贴躯干下垂，90 = 前平举，180 = 过头），肘屈 e。
//     legN/legF [h, k, a?]：髋前屈 h，膝屈 k，踝 a（省略 = 脚掌保持水平贴地）。
//   正面 front：人面朝镜头。armL/armR [ab, e, len]：外展 ab（0 = 下垂，90 = 侧平举），
//     肘 e（正 = 前臂继续向上/向内翻），len = 肢体投影长度比例（<1 表示朝镜头伸出的透视缩短）。
//     legL/legR [ab, k, len]。L = 画面左侧。
//   N = 近侧（画在身体前面），F = 远侧（画在身体后面）。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'assets/anim');

// ---------- 参数 ----------
const argv = process.argv.slice(2);
const opt = { only: null, frames: null, debug: false };
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--only') opt.only = argv[++i].split(',');
  else if (argv[i] === '--frames') opt.frames = path.resolve(argv[++i]);
  else if (argv[i] === '--debug') opt.debug = true;
}

// ---------- 固定颜色（SPEC 第 5 节） ----------
const COL = {
  body: '#c9c3b6', line: '#a39d90', p: '#d9481f', s: '#f0a58a', eq: '#4a4640', ground: '#ddd5c5',
};

// ---------- 骨架尺寸 ----------
const D = {
  T: 66,      // 髋 → 颈根
  shDrop: 6,  // 肩关节在颈根下方
  UA: 44, FA: 40, TH: 58, SH: 56, FOOT: 19,
  // 线宽
  wTorso: 26, wUA: 14, wFA: 12, wTH: 18, wSH: 15, wFoot: 9, wNeck: 12, headR: 15, handR: 6.5,
  // 正面
  SW: 25, HW: 12, shDropF: 9,
  ol: 3, // 轮廓额外宽度
  groundY: 286,
};

// ---------- 数学 ----------
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const mul = (A, B) => [
  A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1],
  A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3],
  A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5],
];
const Tm = (x, y) => [1, 0, 0, 1, x, y];
const Rm = (d) => { const c = Math.cos(rad(d)), s = Math.sin(rad(d)); return [c, s, -s, c, 0, 0]; };
const ap = (M, [x, y]) => [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]];
const inv = (M) => {
  const det = M[0] * M[3] - M[1] * M[2];
  const a = M[3] / det, b = -M[1] / det, c = -M[2] / det, d = M[0] / det;
  return [a, b, c, d, -(a * M[4] + c * M[5]), -(b * M[4] + d * M[5])];
};
const rot2 = (d, [x, y]) => { const c = Math.cos(rad(d)), s = Math.sin(rad(d)); return [c * x - s * y, s * x + c * y]; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = (v) => { const r = Math.round(v * 100) / 100; return Object.is(r, -0) ? '0' : String(r); };
const norm180 = (a) => { a = ((a + 180) % 360 + 360) % 360 - 180; return a; };

// 两段 IK：返回两个节点的 SVG 旋转角（相对父级）。sigma=+1 膝式（中间关节在前），-1 肘式。
function twoBone(v, L1, L2, sigma) {
  const d0 = Math.hypot(v[0], v[1]);
  const d = clamp(d0, Math.abs(L1 - L2) + 0.5, L1 + L2 - 0.01);
  const thb = deg(Math.atan2(v[1], v[0])) - 90;
  const a = deg(Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1)));
  const inner = deg(Math.acos(clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1)));
  return [thb - sigma * a, sigma * (180 - inner)];
}
// 正面 IK：肘角固定，求外展角与投影长度比例。eSvg = 肘的 SVG 角。
function scaledSolve(v, L1, L2, eSvg) {
  const v0 = [-L2 * Math.sin(rad(eSvg)), L1 + L2 * Math.cos(rad(eSvg))];
  const len = Math.hypot(...v) / Math.hypot(...v0);
  const th = deg(Math.atan2(v[1], v[0]) - Math.atan2(v0[1], v0[0]));
  return [norm180(th), len];
}

// ---------- 骨架（节点：父级、平移、旋转，都是 P 的函数） ----------
function sideRig() {
  const N = {};
  N.root = { parent: null, off: (P) => [P.rx, P.ry], rot: (P) => P.r };
  N.torso = { parent: 'root', off: () => [0, 0], rot: (P) => P.t };
  N.head = { parent: 'torso', off: () => [0, -D.T], rot: (P) => P.n };
  for (const s of ['N', 'F']) {
    N['sh' + s] = { parent: 'torso', off: () => [0, -D.T + D.shDrop], rot: (P) => -P['s' + s] };
    N['el' + s] = { parent: 'sh' + s, off: (P) => [0, D.UA * P['ln' + s]], rot: (P) => -P['e' + s] };
    N['ha' + s] = { parent: 'el' + s, off: (P) => [0, D.FA * P['fl' + s]], rot: () => 0 };
    N['hip' + s] = { parent: 'root', off: () => [0, 0], rot: (P) => -P['h' + s] };
    N['kn' + s] = { parent: 'hip' + s, off: () => [0, D.TH], rot: (P) => P['k' + s] };
    N['an' + s] = { parent: 'kn' + s, off: () => [0, D.SH], rot: (P) => -P['a' + s] };
    N['toe' + s] = { parent: 'an' + s, off: () => [D.FOOT, 0], rot: () => 0 };
  }
  return N;
}
function frontRig() {
  const N = {};
  N.root = { parent: null, off: (P) => [P.rx, P.ry], rot: (P) => P.r };
  N.torso = { parent: 'root', off: () => [0, 0], rot: (P) => P.t };
  N.head = { parent: 'torso', off: () => [0, -D.T], rot: (P) => P.n };
  for (const [s, m] of [['L', 1], ['R', -1]]) {
    N['sh' + s] = { parent: 'torso', off: () => [-m * D.SW, -D.T + D.shDropF], rot: (P) => m * P['ab' + s] };
    N['el' + s] = { parent: 'sh' + s, off: (P) => [0, D.UA * P['len' + s]], rot: (P) => m * P['e' + s] };
    N['ha' + s] = { parent: 'el' + s, off: (P) => [0, D.FA * P['len' + s]], rot: () => 0 };
    N['hip' + s] = { parent: 'root', off: () => [-m * D.HW, 0], rot: (P) => m * P['h' + s] };
    N['kn' + s] = { parent: 'hip' + s, off: (P) => [0, D.TH * P['ll' + s]], rot: (P) => m * P['k' + s] };
    // 脚始终保持水平
    N['an' + s] = { parent: 'kn' + s, off: (P) => [0, D.SH * P['sl' + s]], rot: (P) => -(P.r + m * P['h' + s] + m * P['k' + s]) };
  }
  return N;
}

function nodeM(rig, P, name) {
  const n = rig[name];
  if (!n) throw new Error('unknown joint ' + name);
  const base = n.parent ? nodeM(rig, P, n.parent) : [1, 0, 0, 1, 0, 0];
  const [x, y] = n.off(P);
  return mul(mul(base, Tm(x, y)), Rm(n.rot(P)));
}
function worldRot(rig, P, name) { let s = 0; for (let n = name; n; n = rig[n].parent) s += rig[n].rot(P); return s; }
function pointOf(rig, P, spec) {
  if (Array.isArray(spec)) return spec;
  if (typeof spec === 'string') return ap(nodeM(rig, P, spec), [0, 0]);
  return ap(nodeM(rig, P, spec.node), spec.at || [0, 0]);
}

// ---------- 关键帧解析 ----------
const merge = (a, b) => {
  const o = { ...a };
  for (const [k, v] of Object.entries(b || {})) {
    o[k] = v && typeof v === 'object' && !Array.isArray(v) && a && typeof a[k] === 'object' && !Array.isArray(a[k]) ? merge(a[k], v) : v;
  }
  return o;
};

function resolveKF(ex, raw, rig) {
  const k = merge(ex.base || {}, raw);
  const P = { rx: 0, ry: 0, r: k.rot ?? 0, t: k.torso ?? 0, n: k.neck ?? 0 };
  const ikSet = new Set();
  const flat = {};
  if (ex.view === 'side') {
    for (const s of ['N', 'F']) {
      const arm = k['arm' + s] || [0, 10];
      P['s' + s] = arm[0]; P['e' + s] = arm[1];
      P['ln' + s] = arm[2] ?? 1; P['fl' + s] = arm[3] ?? 1; // 上臂/前臂投影长度比例（俯视或手臂朝镜头时 <1）
      const leg = k['leg' + s] || [0, 0];
      P['h' + s] = leg[0]; P['k' + s] = leg[1];
      if (leg.length > 2 && leg[2] !== null) P['a' + s] = leg[2]; else { P['a' + s] = 0; flat[s] = 0; }
    }
  } else {
    for (const s of ['L', 'R']) {
      const arm = k['arm' + s] || [5, 5, 1];
      P['ab' + s] = arm[0]; P['e' + s] = arm[1]; P['len' + s] = arm[2] ?? 1;
      const leg = k['leg' + s] || [3, 0, 1];
      P['h' + s] = leg[0]; P['k' + s] = leg[1]; P['ll' + s] = leg[2] ?? 1;
      P['sl' + s] = leg[3] ?? P['ll' + s]; // 小腿投影比例（坐姿时大腿朝镜头、小腿不缩短）
      if (leg[3] === undefined) P['_slFollow' + s] = 1;
    }
  }
  for (const [pk, pv] of Object.entries(k.props || {})) P['$' + pk] = pv;
  if (k.root) { P.rx = k.root[0]; P.ry = k.root[1]; }
  if (k.anchor) {
    P.rx = 0; P.ry = 0;
    const p = pointOf(rig, P, { node: k.anchor.joint, at: k.anchor.off });
    P.rx = k.anchor.at[0] - p[0]; P.ry = k.anchor.at[1] - p[1];
  }
  const target = (t) => (Array.isArray(t) ? t : ap(nodeM(rig, P, t.rel), t.at));
  // 躯干朝向某点（如仰卧时肩/头贴地）
  if (k.ik && k.ik.neck) {
    const q = target(k.ik.neck);
    const ro = ap(nodeM(rig, P, 'root'), [0, 0]);
    const want = deg(Math.atan2(q[0] - ro[0], -(q[1] - ro[1])));
    P.t = norm180(want - P.r); ikSet.add('t');
  }
  const ik = k.ik || {};
  if (ex.view === 'side') {
    for (const s of ['N', 'F']) {
      const ft = ik['foot' + s];
      if (ft) {
        const tg = target(ft);
        const v = ap(inv(nodeM(rig, P, 'root')), tg);
        const [t1, t2] = twoBone(v, D.TH, D.SH, +1);
        P['h' + s] = norm180(-t1); P['k' + s] = norm180(t2);
        ikSet.add('h' + s); ikSet.add('k' + s);
        flat[s] = Array.isArray(ft) && ft.length > 2 ? ft[2] : (ft.angle ?? 0);
      }
      const ht = ik['hand' + s];
      if (ht) {
        const tg = target(ht);
        const v0 = ap(inv(nodeM(rig, P, 'torso')), tg);
        const off = rig['sh' + s].off(P);
        const sig = (ik.elbowFlip || []).includes(s) ? +1 : -1;
        const [t1, t2] = twoBone([v0[0] - off[0], v0[1] - off[1]], D.UA * P['ln' + s], D.FA * P['fl' + s], sig);
        P['s' + s] = norm180(-t1); P['e' + s] = norm180(-t2);
        ikSet.add('s' + s); ikSet.add('e' + s);
      }
      // 肘落在指定点：上臂指向它并按距离缩放投影长度；前臂取 forearmWorld 世界角度（180 = 竖直向上）
      const et = ik['elbow' + s];
      if (et) {
        const tg = target(et);
        const v0 = ap(inv(nodeM(rig, P, 'torso')), tg);
        const off = rig['sh' + s].off(P);
        const v = [v0[0] - off[0], v0[1] - off[1]];
        P['s' + s] = norm180(-(deg(Math.atan2(v[1], v[0])) - 90));
        P['ln' + s] = Math.hypot(...v) / D.UA;
        if (ik.forearmWorld !== undefined) P['e' + s] = ik.forearmWorld - (P['s' + s] - P.t - P.r);
        ikSet.add('s' + s);
      }
    }
    // 脚掌保持水平（或指定世界角度）：a = r - h + k - 角度
    for (const [s, ang] of Object.entries(flat)) P['a' + s] = P.r - P['h' + s] + P['k' + s] - ang;
  } else {
    for (const [s, m] of [['L', 1], ['R', -1]]) {
      const ht = ik['hand' + s];
      if (ht) {
        const tg = target(ht);
        const v0 = ap(inv(nodeM(rig, P, 'torso')), tg);
        const off = rig['sh' + s].off(P);
        const [th, len] = scaledSolve([v0[0] - off[0], v0[1] - off[1]], D.UA, D.FA, m * P['e' + s]);
        P['ab' + s] = m * th; P['len' + s] = len; ikSet.add('ab' + s);
      }
      const ft = ik['foot' + s];
      if (ft) {
        const tg = target(ft);
        const v0 = ap(inv(nodeM(rig, P, 'root')), tg);
        const off = rig['hip' + s].off(P);
        const [th, len] = scaledSolve([v0[0] - off[0], v0[1] - off[1]], D.TH, D.SH, m * P['k' + s]);
        P['h' + s] = m * th; P['ll' + s] = len; ikSet.add('h' + s);
        if (P['_slFollow' + s]) P['sl' + s] = len;
      }
    }
  }
  P._ik = ikSet;
  return P;
}

// ---------- 时间轴 ----------
function bezierEase([x1, y1, x2, y2], x) {
  if (x <= 0) return 0; if (x >= 1) return 1;
  const bx = (u) => 3 * (1 - u) * (1 - u) * u * x1 + 3 * (1 - u) * u * u * x2 + u * u * u;
  const by = (u) => 3 * (1 - u) * (1 - u) * u * y1 + 3 * (1 - u) * u * u * y2 + u * u * u;
  let lo = 0, hi = 1;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (bx(m) < x) lo = m; else hi = m; }
  return by((lo + hi) / 2);
}

function makeTimeline(ex, KF) {
  let seq = ex.seq;
  if (!seq) {
    const n = KF.length;
    if (ex.loop === 'cycle') seq = [...KF.keys(), 0];
    else seq = n === 1 ? [0] : [...KF.keys(), ...[...KF.keys()].reverse().slice(1)];
  }
  const frames = seq.map((i) => KF[i]);
  const n = frames.length;
  const keyTimes = ex.keyTimes || frames.map((_, i) => (n === 1 ? 0 : i / (n - 1)));
  const ease = ex.ease === 'linear' ? [0, 0, 1, 1] : ex.ease || [0.45, 0, 0.55, 1];
  const dur = ex.period ?? 3;
  const timing = n === 1 ? '' :
    `dur="${dur}s" repeatCount="indefinite" calcMode="spline" keyTimes="${keyTimes.map(fmt).join(';')}" keySplines="${Array(n - 1).fill(ease.join(' ')).join(';')}"`;
  // 在任意时刻插值 P（与 SMIL spline 一致）
  const at = (time) => {
    if (n === 1) return frames[0];
    let i = 0; while (i < n - 2 && time > keyTimes[i + 1]) i++;
    const u = bezierEase(ease, (time - keyTimes[i]) / (keyTimes[i + 1] - keyTimes[i]));
    const A = frames[i], B = frames[i + 1], o = {};
    for (const key of Object.keys(A)) if (typeof A[key] === 'number') o[key] = A[key] + (B[key] - A[key]) * u;
    return o;
  };
  return { frames, n, timing, at, dur };
}

// ---------- SVG 输出工具 ----------
function mkEmit(TL) {
  const isConst = (vals) => vals.every((v) => Math.abs(v - vals[0]) < 1e-4);
  const animTag = (attr, vals) => `<animate attributeName="${attr}" values="${vals.map(fmt).join(';')}" ${TL.timing}/>`;
  function el(tag, attrs) {
    let stat = '', kids = '';
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null) continue;
      if (typeof v === 'function') {
        const vals = TL.frames.map(v);
        stat += ` ${k}="${fmt(vals[0])}"`;
        if (!isConst(vals)) kids += animTag(k, vals);
      } else stat += ` ${k}="${typeof v === 'number' ? fmt(v) : v}"`;
    }
    return kids ? `<${tag}${stat}>${kids}</${tag}>` : `<${tag}${stat}/>`;
  }
  function open(node) {
    const offs = TL.frames.map(node.off), rots = TL.frames.map(node.rot);
    let s = '';
    if (isConst(offs.map((o) => o[0])) && isConst(offs.map((o) => o[1]))) {
      s += offs[0][0] || offs[0][1] ? `<g transform="translate(${fmt(offs[0][0])} ${fmt(offs[0][1])})">` : '<g>';
    } else {
      s += `<g transform="translate(${fmt(offs[0][0])} ${fmt(offs[0][1])})"><animateTransform attributeName="transform" type="translate" values="${offs.map((o) => fmt(o[0]) + ' ' + fmt(o[1])).join(';')}" ${TL.timing}/>`;
    }
    if (isConst(rots)) s += rots[0] ? `<g transform="rotate(${fmt(rots[0])})">` : '<g>';
    else s += `<g transform="rotate(${fmt(rots[0])})"><animateTransform attributeName="transform" type="rotate" values="${rots.map(fmt).join(';')}" ${TL.timing}/>`;
    return s;
  }
  // 稠密采样的属性动画（用于跟随手的绳索/弹力带端点），线性插值
  const SAMPLES = 60;
  function dense(attrs, fnOfP) {
    // fnOfP(P) -> {attr: value}
    if (TL.n === 1) {
      const v = fnOfP(TL.frames[0]);
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, { stat: fmt(x) }]));
    }
    const times = Array.from({ length: SAMPLES + 1 }, (_, i) => i / SAMPLES);
    const rows = times.map((t) => fnOfP(TL.at(t)));
    const out = {};
    for (const a of attrs) {
      const vals = rows.map((r) => r[a]);
      out[a] = isConst(vals) ? { stat: fmt(vals[0]) } : {
        stat: fmt(vals[0]),
        anim: `<animate attributeName="${a}" values="${vals.map(fmt).join(';')}" dur="${TL.dur}s" repeatCount="indefinite" calcMode="linear" keyTimes="${times.map(fmt).join(';')}"/>`,
      };
    }
    return out;
  }
  function denseEl(tag, staticAttrs, attrs, fnOfP) {
    const d = dense(attrs, fnOfP);
    let s = `<${tag}`;
    for (const [k, v] of Object.entries(staticAttrs)) s += ` ${k}="${v}"`;
    let kids = '';
    for (const a of attrs) { s += ` ${a}="${d[a].stat}"`; if (d[a].anim) kids += d[a].anim; }
    return kids ? `${s}>${kids}</${tag}>` : `${s}/>`;
  }
  return { el, open, denseEl };
}

// ---------- 肌肉区域 ----------
// 侧视：肢体段上的“半边色带”（side +1 = 前侧，-1 = 后侧，0 = 居中），from/to 为段长比例。
function sideMuscles(id) {
  const T = D.T;
  const band = (node, len, w, side, from, to, wFrac = 0.5) => ({ node, kind: 'band', len, w, side, from, to, wFrac });
  const tor = (side, from, to, wFrac = 0.5) => ({ node: 'torso', kind: 'band', len: -T, w: D.wTorso, side, from, to, wFrac });
  switch (id) {
    case 'chest': return [tor(1, 0.6, 0.9)];
    case 'abs': return [tor(1, 0.15, 0.55)];
    case 'obliques': return [tor(0, 0.18, 0.52, 0.4)];
    case 'lats': return [tor(-1, 0.42, 0.82)];
    case 'upper-back': return [tor(-1, 0.68, 0.94)];
    case 'lower-back': return [tor(-1, 0.08, 0.4)];
    case 'traps': return [tor(-1, 0.86, 1.05, 0.55), { node: 'head', kind: 'band', len: -12, w: D.wNeck, side: -1, from: 0, to: 0.7, wFrac: 0.6 }];
    case 'front-delt': return ['N', 'F'].map((s) => band('sh' + s, D.UA, D.wUA, 1, 0, 0.28, 0.6));
    case 'side-delt': return ['N', 'F'].map((s) => band('sh' + s, D.UA, D.wUA, 0, 0, 0.28, 0.6));
    case 'rear-delt': return ['N', 'F'].map((s) => band('sh' + s, D.UA, D.wUA, -1, 0, 0.28, 0.6));
    case 'biceps': return ['N', 'F'].map((s) => band('sh' + s, D.UA, D.wUA, 1, 0.32, 0.82));
    case 'triceps': return ['N', 'F'].map((s) => band('sh' + s, D.UA, D.wUA, -1, 0.3, 0.85));
    case 'forearms': return ['N', 'F'].map((s) => band('el' + s, D.FA, D.wFA, 0, 0.12, 0.72, 0.6));
    case 'quads': return ['N', 'F'].map((s) => band('hip' + s, D.TH, D.wTH, 1, 0.2, 0.86));
    case 'hip-flexors': return ['N', 'F'].map((s) => band('hip' + s, D.TH, D.wTH, 1, 0.0, 0.3)).concat([tor(1, 0.0, 0.14)]);
    case 'hamstrings': return ['N', 'F'].map((s) => band('hip' + s, D.TH, D.wTH, -1, 0.3, 0.86));
    case 'adductors': return ['N', 'F'].map((s) => band('hip' + s, D.TH, D.wTH, 0, 0.2, 0.6, 0.35));
    case 'calves': return ['N', 'F'].map((s) => band('kn' + s, D.SH, D.wSH, -1, 0.1, 0.5));
    case 'glutes': return [{ node: 'root', kind: 'glute' }].concat(['N', 'F'].map((s) => band('hip' + s, D.TH, D.wTH, -1, 0.0, 0.28)));
    case 'glute-med': return [{ node: 'root', kind: 'glute', small: true }];
    default: return [];
  }
}
// 正面：形状直接给出
function frontMuscles(id) {
  const T = D.T;
  const lim = (base, len, lenKey, w, from, to, wFrac = 0.62) => ['L', 'R'].map((s) => ({ node: base + s, kind: 'fband', len, lenKey: lenKey + s, w, from, to, wFrac }));
  const shape = (svg) => ({ node: 'torso', kind: 'shape', svg });
  switch (id) {
    case 'chest': return [shape((c) => `<ellipse cx="-10" cy="${-T + 20}" rx="10" ry="8" fill="${c}"/><ellipse cx="10" cy="${-T + 20}" rx="10" ry="8" fill="${c}"/>`)];
    case 'abs': return [shape((c) => `<rect x="-7" y="${-T + 32}" width="14" height="${T - 40}" rx="5" fill="${c}"/>`)];
    case 'obliques': return [shape((c) => `<rect x="-19" y="${-T + 34}" width="8" height="${T - 42}" rx="4" fill="${c}"/><rect x="11" y="${-T + 34}" width="8" height="${T - 42}" rx="4" fill="${c}"/>`)];
    case 'lats': return [shape((c) => `<path d="M-22 ${-T + 14} L-12 ${-T + 18} L-12 ${-T + 42} L-18 ${-T + 46} Z" fill="${c}"/><path d="M22 ${-T + 14} L12 ${-T + 18} L12 ${-T + 42} L18 ${-T + 46} Z" fill="${c}"/>`)];
    case 'upper-back': return [shape((c) => `<rect x="-16" y="${-T + 12}" width="32" height="18" rx="6" fill="${c}"/>`)];
    case 'lower-back': return [shape((c) => `<rect x="-9" y="-24" width="18" height="18" rx="5" fill="${c}"/>`)];
    case 'traps': return [shape((c) => `<path d="M-7 ${-T - 8} L7 ${-T - 8} L22 ${-T + 5} L0 ${-T + 14} L-22 ${-T + 5} Z" fill="${c}" stroke="${c}" stroke-width="3" stroke-linejoin="round"/>`)];
    case 'front-delt': case 'side-delt': case 'rear-delt': return lim('sh', D.UA, 'len', D.wUA, 0, 0.26, 0.8);
    case 'biceps': case 'triceps': return lim('sh', D.UA, 'len', D.wUA, 0.32, 0.85);
    case 'forearms': return lim('el', D.FA, 'len', D.wFA, 0.12, 0.72);
    case 'quads': case 'hamstrings': return lim('hip', D.TH, 'll', D.wTH, 0.2, 0.86);
    case 'adductors': return ['L', 'R'].map((s, i) => ({ node: 'hip' + s, kind: 'fband', len: D.TH, lenKey: 'll' + s, w: D.wTH, from: 0.15, to: 0.6, wFrac: 0.4, shift: i ? -4 : 4 }));
    case 'hip-flexors': return lim('hip', D.TH, 'll', D.wTH, 0, 0.28);
    case 'calves': return lim('kn', D.SH, 'sl', D.wSH, 0.1, 0.5);
    case 'glutes': return [{ node: 'root', kind: 'shape', svg: (c) => `<circle cx="-9" cy="2" r="10" fill="${c}"/><circle cx="9" cy="2" r="10" fill="${c}"/>` }];
    case 'glute-med': return [{ node: 'root', kind: 'shape', svg: (c) => `<ellipse cx="-19" cy="-5" rx="7" ry="9" fill="${c}"/><ellipse cx="19" cy="-5" rx="7" ry="9" fill="${c}"/>` }];
    default: return [];
  }
}

// ---------- 渲染一个动作 ----------
function render(ex, TL, rig) {
  const E = mkEmit(TL);
  const side = ex.view === 'side';
  const LC = 'stroke-linecap="round"';
  const line = (x1, y1, x2, y2, color, w, extra = '') => E.el('line', { x1, y1, x2, y2, stroke: color, 'stroke-width': w, 'stroke-linecap': 'round', ...(extra || {}) });
  void LC;

  // 每个节点的绘制（pass: 'o' 轮廓, 'f' 填充）
  const drawsBefore = {}, drawsAfter = {};
  const add = (node, fn, after = false) => { const m = after ? drawsAfter : drawsBefore; (m[node] ||= []).push(fn); };
  const col = (pass) => (pass === 'o' ? COL.line : COL.body);
  const W = (pass, w) => (pass === 'o' ? w + D.ol : w);

  if (side) {
    add('torso', (p) => line(0, 0, 0, -D.T, col(p), W(p, D.wTorso)));
    add('root', (p) => E.el('circle', { cx: -4, cy: 3, r: p === 'o' ? 13.5 : 12, fill: col(p) }), true);
    add('head', (p) => line(0, 0, 0, -12, col(p), W(p, D.wNeck)) + E.el('circle', { cx: 0, cy: -25, r: p === 'o' ? D.headR + 1.5 : D.headR, fill: col(p) }));
    // 可选的“鼻尖”标记：props.face = 鼻尖在头部前后方向的偏移，用来表现转头（俯视时）
    if (ex.keyframes.some((k) => k.props && k.props.face !== undefined) || (ex.base && ex.base.props && ex.base.props.face !== undefined)) {
      add('head', (p) => (p === 'f' ? E.el('circle', { cx: (P) => P.$face, cy: -25, r: 4, fill: COL.line }) : ''));
    }
    for (const s of ['N', 'F']) {
      add('sh' + s, (p) => line(0, 0, 0, (P) => D.UA * P['ln' + s], col(p), W(p, D.wUA)));
      add('el' + s, (p) => line(0, 0, 0, (P) => D.FA * P['fl' + s], col(p), W(p, D.wFA)));
      add('ha' + s, (p) => E.el('circle', { cx: 0, cy: 0, r: p === 'o' ? D.handR + 1.5 : D.handR, fill: col(p) }), true);
      add('hip' + s, (p) => line(0, 0, 0, D.TH, col(p), W(p, D.wTH)));
      add('kn' + s, (p) => line(0, 0, 0, D.SH, col(p), W(p, D.wSH)));
      add('an' + s, (p) => line(-4, 0, D.FOOT, 0, col(p), W(p, D.wFoot)));
    }
  } else {
    const T = D.T;
    const torsoPath = `M${-D.SW + 3} ${-T + 4} L${D.SW - 3} ${-T + 4} L${D.HW + 8} -6 Q0 4 ${-D.HW - 8} -6 Z`;
    add('torso', (p) => `<path d="${torsoPath}" fill="${col(p)}" stroke="${col(p)}" stroke-width="${p === 'o' ? 13 : 10}" stroke-linejoin="round"/>`);
    add('head', (p) => line(0, 0, 0, -12, col(p), W(p, D.wNeck)) + E.el('circle', { cx: 0, cy: -26, r: p === 'o' ? D.headR + 2.5 : D.headR + 1, fill: col(p) }));
    for (const s of ['L', 'R']) {
      add('sh' + s, (p) => line(0, 0, 0, (P) => D.UA * P['len' + s], col(p), W(p, D.wUA)));
      add('el' + s, (p) => line(0, 0, 0, (P) => D.FA * P['len' + s], col(p), W(p, D.wFA)));
      add('ha' + s, (p) => E.el('circle', { cx: 0, cy: 0, r: p === 'o' ? D.handR + 1.5 : D.handR, fill: col(p) }), true);
      add('hip' + s, (p) => line(0, 0, 0, (P) => D.TH * P['ll' + s], col(p), W(p, D.wTH)));
      add('kn' + s, (p) => line(0, 0, 0, (P) => D.SH * P['sl' + s], col(p), W(p, D.wSH)));
      const m = s === 'L' ? -1 : 1;
      add('an' + s, (p) => line(-5 * m, 2, 6 * m, 2, col(p), W(p, D.wFoot + 2)));
    }
  }

  // 肌肉色块（只在填充层）
  const mus = [];
  for (const m of ex.muscles.secondary || []) mus.push([m, COL.s]);
  for (const m of ex.muscles.primary || []) mus.push([m, COL.p]);
  for (const [m, c] of mus) {
    if ((ex.hideMuscles || []).includes(m)) continue; // 该视角看不到的肌群（如正面看上背）
    const regions = side ? sideMuscles(m) : frontMuscles(m);
    if (!regions.length) console.warn(`  ! ${ex.id}: 没有肌肉区域 ${m}`);
    for (const g of regions) {
      // muscleSide: 只给一侧肢体上色（如单侧拉伸），躯干等不分侧的区域照常画
      if (ex.muscleSide && /[NFLR]$/.test(g.node) && g.node !== 'root' && !g.node.endsWith(ex.muscleSide)) continue;
      if (g.kind === 'band') {
        const w = g.w * g.wFrac, o = g.side * (g.w / 2 - w / 2);
        const lk = /^sh/.test(g.node) ? 'ln' + g.node.slice(2) : /^el/.test(g.node) ? 'fl' + g.node.slice(2) : null;
        const L = (P) => g.len * (lk ? P[lk] : 1);
        add(g.node, (p) => (p === 'f' ? line(o, (P) => L(P) * g.from, o, (P) => L(P) * g.to, c, w) : ''));
      } else if (g.kind === 'fband') {
        const w = g.w * g.wFrac, sh = g.shift || 0;
        add(g.node, (p) => (p === 'f' ? line(sh, (P) => g.len * P[g.lenKey] * g.from, sh, (P) => g.len * P[g.lenKey] * g.to, c, w) : ''));
      } else if (g.kind === 'glute') {
        add('root', (p) => (p === 'f' ? `<circle cx="${g.small ? -2 : -5}" cy="${g.small ? -2 : 3}" r="${g.small ? 7 : 10}" fill="${c}"/>` : ''), true);
      } else if (g.kind === 'shape') {
        add(g.node, (p) => (p === 'f' ? g.svg(c) : ''), g.node === 'root');
      }
    }
  }

  // 手持器械：放在手节点里，反向旋转保持世界角度
  const eq = ex.equipment || [];
  for (const q of eq) {
    if (!['dumbbell', 'handle', 'barbell'].includes(q.type)) continue;
    const hands = q.hands || [q.hand];
    for (const h of hands) {
      const ang = q.angle ?? 0;
      const sc = q.scale ?? 1;
      add(h, (p) => {
        if (p !== 'f') return '';
        const rotFn = (P) => ang - worldRot(rig, P, h);
        const vals = TL.frames.map(rotFn);
        let open;
        if (vals.every((v) => Math.abs(v - vals[0]) < 1e-4)) open = `<g transform="rotate(${fmt(vals[0])}) scale(${sc})">`;
        else open = `<g transform="scale(${sc})"><g transform="rotate(${fmt(vals[0])})"><animateTransform attributeName="transform" type="rotate" values="${vals.map(fmt).join(';')}" ${TL.timing}/>`;
        let body = '';
        if (q.type === 'dumbbell') {
          body = `<line x1="-12" y1="0" x2="12" y2="0" stroke="${COL.eq}" stroke-width="5" stroke-linecap="round"/>` +
            `<rect x="-19" y="-9.5" width="8" height="19" rx="2.5" fill="${COL.eq}"/><rect x="11" y="-9.5" width="8" height="19" rx="2.5" fill="${COL.eq}"/>`;
        } else if (q.type === 'handle') {
          body = `<line x1="-8" y1="0" x2="8" y2="0" stroke="${COL.eq}" stroke-width="5" stroke-linecap="round"/>`;
        } else if (q.type === 'barbell') {
          body = `<line x1="-70" y1="0" x2="70" y2="0" stroke="${COL.eq}" stroke-width="4" stroke-linecap="round"/>` +
            `<rect x="-66" y="-16" width="9" height="32" rx="3" fill="${COL.eq}"/><rect x="57" y="-16" width="9" height="32" rx="3" fill="${COL.eq}"/>`;
        }
        const close = open.startsWith('<g transform="scale') && open.includes('animateTransform') ? '</g></g>' : '</g>';
        return open + body + close;
      });
    }
  }

  // 链：从根到叶，嵌套输出
  // own = 从第几个节点开始由这条链负责绘制（前面的祖先节点只提供变换）
  const chain = (names, pass, own) => {
    let s = '', close = '';
    names.forEach((nm, i) => {
      s += E.open(rig[nm]);
      if (i >= own) for (const f of drawsBefore[nm] || []) s += f(pass);
      close = (i >= own ? (drawsAfter[nm] || []).map((f) => f(pass)).join('') : '') + '</g></g>' + close;
    });
    return s + close;
  };
  const chainBoth = (names) => {
    const own = names[1] === 'torso' && names.length > 2 && names[2] !== 'head' ? 2 : names[1] === 'torso' ? 0 : 1;
    return chain(names, 'o', own) + chain(names, 'f', own);
  };

  // 场景器械
  const layers = { back: '', mid: '', front: '' };
  const G = D.groundY;
  if (ex.ground !== false) layers.back += `<line x1="20" y1="${G}" x2="380" y2="${G}" stroke="${COL.ground}" stroke-width="4" stroke-linecap="round"/>`;
  const num = (v, P) => (typeof v === 'string' && v.startsWith('$') ? P[v] : v);
  for (const q of eq) {
    const L = q.layer;
    switch (q.type) {
      case 'box': {
        layers[L || 'back'] += `<rect x="${q.x}" y="${q.y}" width="${q.w}" height="${G - 2 - q.y}" rx="3" fill="${COL.ground}" stroke="${COL.line}" stroke-width="2"/>`;
        break;
      }
      case 'bench': {
        const { x, y, w } = q; // y = 凳面上沿
        layers[L || 'back'] += `<rect x="${x + 12}" y="${y + 10}" width="6" height="${G - y - 12}" fill="${COL.eq}"/><rect x="${x + w - 18}" y="${y + 10}" width="6" height="${G - y - 12}" fill="${COL.eq}"/>` +
          `<rect x="${x}" y="${y}" width="${w}" height="12" rx="4" fill="${COL.ground}" stroke="${COL.line}" stroke-width="2"/>`;
        break;
      }
      case 'column': {
        const { x, top = 20, pulleys = [] } = q;
        let s = `<rect x="${x - 5}" y="${top}" width="10" height="${G - 2 - top}" rx="2" fill="${COL.eq}" opacity="${q.opacity ?? 1}"/>`;
        for (const py of pulleys) s += `<circle cx="${x}" cy="${py}" r="7" fill="${COL.ground}" stroke="${COL.eq}" stroke-width="3"/>`;
        layers[L || 'back'] += s;
        break;
      }
      case 'cable': case 'strap': case 'band': {
        const a = q.from, b = q.to;
        const width = q.width ?? (q.type === 'cable' ? 2.5 : q.type === 'strap' ? 4.5 : 5);
        const attrs = ['x1', 'y1', 'x2', 'y2'];
        if (q.type === 'band') attrs.push('stroke-width');
        const base = q.type === 'band' ? (q.restLen ?? 60) : 0;
        layers[L || 'front'] += E.denseEl('line', { stroke: q.color === 'ground' ? COL.ground : COL.eq, 'stroke-linecap': 'round', ...(q.type === 'band' ? {} : { 'stroke-width': width }) }, attrs, (P) => {
          const p1 = pointOf(rig, P, a), p2 = pointOf(rig, P, b);
          const o = { x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1] };
          if (q.type === 'band') o['stroke-width'] = clamp(width * Math.sqrt(base / Math.max(1, Math.hypot(p2[0] - p1[0], p2[1] - p1[1]))), 2.2, width * 1.3);
          return o;
        });
        break;
      }
      case 'inclineBench': {
        // 坐垫水平，靠背从 (x, y) 向左上抬起 angle 度
        const { x, y, seatW = 50, backL = 90, angle = 30 } = q;
        const bx = x - backL * Math.cos(rad(angle)), by = y + 6 - backL * Math.sin(rad(angle));
        const pad = (x1, y1, x2, y2) => `<line x1="${fmt(x1)}" y1="${fmt(y1)}" x2="${fmt(x2)}" y2="${fmt(y2)}" stroke="${COL.line}" stroke-width="15" stroke-linecap="round"/><line x1="${fmt(x1)}" y1="${fmt(y1)}" x2="${fmt(x2)}" y2="${fmt(y2)}" stroke="${COL.ground}" stroke-width="12" stroke-linecap="round"/>`;
        const sup = (x1, y1) => `<line x1="${fmt(x1)}" y1="${fmt(y1)}" x2="${fmt(x1)}" y2="${G - 2}" stroke="${COL.eq}" stroke-width="6"/>`;
        layers[L || 'back'] += sup(x + seatW - 8, y + 6) + sup(x - 4, y + 6) + `<line x1="${fmt(x - 4)}" y1="${y + 30}" x2="${fmt(bx + 25)}" y2="${fmt(by + 18)}" stroke="${COL.eq}" stroke-width="5"/>` +
          sup(bx + 22, by + 16) + pad(x, y + 6, bx, by) + pad(x, y + 6, x + seatW, y + 6);
        break;
      }
      case 'mat': {
        layers[L || 'back'] += `<rect x="${q.x}" y="${q.y}" width="${q.w}" height="${q.h}" rx="${q.rx ?? 10}" fill="${COL.ground}"/>`;
        break;
      }
      case 'line': {
        layers[L || 'back'] += `<line x1="${q.x1}" y1="${q.y1}" x2="${q.x2}" y2="${q.y2}" stroke="${COL.eq}" stroke-width="${q.width ?? 6}" stroke-linecap="round"/>`;
        break;
      }
      case 'pulley': {
        layers[L || 'back'] += `<circle cx="${q.cx}" cy="${q.cy}" r="${q.r ?? 7}" fill="${COL.ground}" stroke="${COL.eq}" stroke-width="3"/>`;
        break;
      }
      case 'bar': {
        // 定长横杆：中心在两手中点，长度固定（手可以在杆上略微滑动）
        const half = q.half ?? 80;
        layers[L || 'front'] += E.denseEl('line', { stroke: COL.eq, 'stroke-width': q.width ?? 6, 'stroke-linecap': 'round' }, ['x1', 'y1', 'x2', 'y2'], (P) => {
          const a = pointOf(rig, P, q.from), b = pointOf(rig, P, q.to);
          const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2;
          return { x1: cx - half, y1: cy, x2: cx + half, y2: cy };
        });
        if (q.cableFrom) layers.mid += E.denseEl('line', { stroke: COL.eq, 'stroke-width': 2.5, 'stroke-linecap': 'round' }, ['x1', 'y1', 'x2', 'y2'], (P) => {
          const a = pointOf(rig, P, q.from), b = pointOf(rig, P, q.to);
          return { x1: q.cableFrom[0], y1: q.cableFrom[1], x2: (a[0] + b[0]) / 2, y2: (a[1] + b[1]) / 2 };
        });
        break;
      }
      case 'anchor': {
        layers[L || 'back'] += `<line x1="${q.x - 22}" y1="${q.y - 8}" x2="${q.x + 22}" y2="${q.y - 8}" stroke="${COL.eq}" stroke-width="6" stroke-linecap="round"/><circle cx="${q.x}" cy="${q.y}" r="5" fill="${COL.eq}"/>`;
        break;
      }
      case 'ball': {
        const r = q.r;
        const cy = q.cy ?? G - 2 - r;
        const x0 = num(q.cx, TL.frames[0]);
        const g = E.el('circle', { cx: (P) => num(q.cx, P), cy, r, fill: COL.ground, stroke: COL.eq, 'stroke-width': 3 });
        // 滚动的接缝线
        const seamT = (P) => { const cx = num(q.cx, P); return [cx, deg((cx - x0) / r)]; };
        const vals = TL.frames.map(seamT);
        const seam = `<path d="M${-r * 0.7} ${-r * 0.7} Q0 ${-r * 0.1} ${r * 0.7} ${-r * 0.7}" fill="none" stroke="${COL.line}" stroke-width="2.5"/>`;
        let s2;
        if (TL.n === 1) s2 = `<g transform="translate(${fmt(vals[0][0])} ${cy})">${seam}</g>`;
        else s2 = `<g transform="translate(${fmt(vals[0][0])} ${cy})"><animateTransform attributeName="transform" type="translate" values="${vals.map((v) => fmt(v[0]) + ' ' + cy).join(';')}" ${TL.timing}/><g><animateTransform attributeName="transform" type="rotate" values="${vals.map((v) => fmt(v[1])).join(';')}" ${TL.timing}/>${seam}</g></g>`;
        layers[L || 'mid'] += g + s2;
        break;
      }
      case 'ticks': {
        // 地面刻痕滚动，表示在行走
        const sp = q.spacing ?? 50, dist = q.distance ?? 100;
        let marks = '';
        for (let x = 0; x <= 400 + dist; x += sp) marks += `<line x1="${x}" y1="${G + 6}" x2="${x - 8}" y2="${G + 11}" stroke="${COL.line}" stroke-width="2.5" stroke-linecap="round"/>`;
        const anim = TL.n === 1 ? '' : `<animateTransform attributeName="transform" type="translate" values="0 0;${-dist} 0" dur="${TL.dur}s" repeatCount="indefinite"/>`;
        layers.back += `<clipPath id="clip-${ex.id}"><rect x="20" y="${G}" width="360" height="16"/></clipPath><g clip-path="url(#clip-${ex.id})"><g>${anim}${marks}</g></g>`;
        break;
      }
      default: break;
    }
  }

  let body = layers.back;
  if (side) {
    body += chainBoth(['root', 'torso', 'shF', 'elF', 'haF']);
    body += chainBoth(['root', 'hipF', 'knF', 'anF']);
    body += layers.mid0 || '';
    body += chainBoth(['root', 'torso', 'head']);
    body += layers.mid;
    body += chainBoth(['root', 'hipN', 'knN', 'anN']);
    body += chainBoth(['root', 'torso', 'shN', 'elN', 'haN']);
  } else {
    const behind = ex.armsBehind || []; // 画在头和躯干后面的手臂（如手放在脑后）
    for (const s of behind) body += chainBoth(['root', 'torso', 'sh' + s, 'el' + s, 'ha' + s]);
    body += chainBoth(['root', 'hipL', 'knL', 'anL']);
    body += chainBoth(['root', 'hipR', 'knR', 'anR']);
    body += chainBoth(['root', 'torso', 'head']);
    body += layers.mid;
    for (const s of ['L', 'R']) if (!behind.includes(s)) body += chainBoth(['root', 'torso', 'sh' + s, 'el' + s, 'ha' + s]);
  }
  body += layers.front;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><title>${ex.zh} · ${ex.en}</title>${body}</svg>\n`;
}

// ---------- 主流程 ----------
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/poses.json'), 'utf8'));
const list = data.exercises.filter((e) => !opt.only || opt.only.includes(e.id));
fs.mkdirSync(OUT, { recursive: true });
if (opt.frames) fs.mkdirSync(opt.frames, { recursive: true });
const frameCells = [];

for (const ex of list) {
  const rig = ex.view === 'side' ? sideRig() : frontRig();
  const KF = ex.keyframes.map((k) => resolveKF(ex, k, rig));
  // IK 角度展开，避免 ±180 跳变
  for (let i = 1; i < KF.length; i++) {
    for (const key of KF[i]._ik) {
      while (KF[i][key] - KF[i - 1][key] > 180) KF[i][key] -= 360;
      while (KF[i][key] - KF[i - 1][key] < -180) KF[i][key] += 360;
    }
  }
  if (opt.debug) {
    console.log(`\n# ${ex.id}`);
    const joints = ex.view === 'side' ? ['root', 'head', 'shN', 'elN', 'haN', 'haF', 'knN', 'anN', 'toeN', 'knF', 'anF', 'toeF'] : ['root', 'head', 'shL', 'haL', 'haR', 'knL', 'anL', 'anR'];
    KF.forEach((P, i) => {
      const parts = joints.map((j) => `${j}(${pointOf(rig, P, j).map((v) => v.toFixed(0)).join(',')})`);
      const ang = Object.entries(P).filter(([k, v]) => typeof v === 'number' && !['rx', 'ry'].includes(k)).map(([k, v]) => `${k}=${v.toFixed(0)}`);
      console.log(`  kf${i}: ${parts.join(' ')}\n        ${ang.join(' ')}`);
    });
  }
  const TL = makeTimeline(ex, KF);
  fs.writeFileSync(path.join(OUT, ex.id + '.svg'), render(ex, TL, rig));
  if (opt.frames) {
    KF.forEach((P, i) => {
      const f = `${ex.id}-k${i}.svg`;
      fs.writeFileSync(path.join(opt.frames, f), render(ex, makeTimeline({ ...ex, seq: [0] }, [P]), rig));
      frameCells.push(f);
    });
  }
  console.log(`✓ ${ex.id}.svg`);
}

if (opt.frames) {
  const page = (cells) => `<!doctype html><meta charset="utf-8"><style>body{font:12px sans-serif;display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:8px}figure{margin:0;border:1px solid #ddd}img{width:100%;display:block}</style>` +
    cells.map((f) => `<figure><img src="${f}"><figcaption>${f}</figcaption></figure>`).join('');
  fs.writeFileSync(path.join(opt.frames, 'index.html'), page(frameCells));
  for (let i = 0; i * 16 < frameCells.length; i++) fs.writeFileSync(path.join(opt.frames, `page${i}.html`), page(frameCells.slice(i * 16, i * 16 + 16)));
}

// 预览页（始终包含全部动作）
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const cells = data.exercises.map((e, i) => `  <figure><img src="${e.id}.svg" alt="${esc(e.zh)} 动画"><figcaption><b>${i + 1}. ${esc(e.zh)}</b><span>${esc(e.en)}</span><code>${e.id} · ${e.viewLabel || (e.view === 'side' ? '侧视' : '正面')}</code></figcaption></figure>`).join('\n');
const sheet = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fit101 动画预览</title>
<style>
  :root { --bg: #f6f3ee; --card: #fff; --ink: #2b2925; --ink-2: #6b665d; --line: #e4ddd0; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 20px 16px; background: var(--bg); color: var(--ink); font: 14px/1.4 -apple-system, "PingFang SC", "Helvetica Neue", sans-serif; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p.note { margin: 0 0 16px; color: var(--ink-2); font-size: 13px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
  figure { margin: 0; background: var(--card); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
  figure img { display: block; width: 100%; aspect-ratio: 4 / 3; background: #fbfaf7; }
  figcaption { padding: 8px 10px; display: flex; flex-wrap: wrap; gap: 2px 8px; align-items: baseline; border-top: 1px solid var(--line); }
  figcaption b { font-size: 15px; }
  figcaption span { color: var(--ink-2); }
  figcaption code { width: 100%; font-size: 11px; color: #9a9488; }
</style>
</head>
<body>
<h1>Fit101 · 动作动画预览（${data.exercises.length} 个）</h1>
<p class="note">由 scripts/gen-anim.mjs 从 data/poses.json 生成。每格都是 &lt;img&gt; 引入的 SVG（SMIL 动画），能动说明放进页面后也能动。深红 = 主要发力肌群，浅红 = 辅助。</p>
<div class="grid">
${cells}
</div>
</body>
</html>
`;
fs.writeFileSync(path.join(OUT, 'contact-sheet.html'), sheet);
console.log('✓ contact-sheet.html');
