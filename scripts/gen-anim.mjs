#!/usr/bin/env node
// Fit101 · 动作动画生成器 v2（伪 3D 四分之三视角，SPEC 第 14 节）
// 读 data/poses.json，为每个动作输出 assets/anim/<id>.svg（纯 SMIL，可放在 <img> 里）、
// assets/anim/<id>.poster.svg（无动画首帧）以及 assets/anim/contact-sheet.html。
// v1（侧视火柴人）保留在 scripts/gen-anim-v1.mjs 作对照。
//
// 用法：
//   node scripts/gen-anim.mjs                 生成全部
//   node scripts/gen-anim.mjs --only squat,x  只生成指定 id
//   node scripts/gen-anim.mjs --frames <dir>  额外把每个关键帧导出成静态 SVG + index.html（调试用）
//   node scripts/gen-anim.mjs --debug         打印每个关键帧的关节世界坐标
//
// 流程：
//   1. 关键帧解析、IK、时间线与 v1 完全相同（下方“骨架/关键帧/时间轴”三段原样沿用）。
//   2. 每个周期均匀采样 NS 帧，每帧把 2D 骨架展开成 3D：
//        侧视 side：2D (x, y) 是矢状面，z = 左右偏移（近侧 N 为 +，远侧 F 为 -，数值来自 iso）。
//        正面 front：2D x 是左右，z = 朝镜头的前后量（由肢体投影长度比例反推，armsBehind 取负）。
//        俯视 iso.top（open-book）：2D 平面是垫子，2D y → z，近侧/远侧偏移 → 离垫子的高度。
//   3. 正交投影：绕 x=200 的竖直轴偏转 yaw（默认 34°）、俯视 pitch（默认 16°）。
//   4. 每段肢体 = 一个局部坐标系里的静态模板（锥形胶囊 + 三层明暗 + 解剖形状的肌肉），
//      外面套一个 <g>，只对 translate / rotate / scale 做 SMIL 插值（体积小）。
//      躯干同理，额外在横向 scale 里体现 3/4 视角下的宽度变化。
//   5. 按每个部件整段动画的平均投影深度排序；比躯干更远的远侧部件放进半透明组。
//
// poses.json 新字段 iso（全部可选）：
//   { sh, el, ha, hip, kn, an }  各关节左右偏移 z（侧视；默认 17/16/14/9/10/10）
//   yaw, pitch, scale, lift       覆盖投影参数
//   bellAt: "mid"                 手持器械放在两手中点（高脚杯）
//   eq: { "<器械序号>": { z } }   场景器械的 z（侧视 = 左右，正面 = 前后），默认 0
//   top: true                     俯视（2D 平面 = 地面/垫子）

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
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

// ======== 以下“骨架尺寸 / 数学 / 骨架 / 关键帧 / 时间轴”与 v1 相同 ========
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

// =====================================================================
// v2：3D 展开、投影、模板、器械、输出
// =====================================================================

// ---------- 颜色（SPEC 第 5 节 + 第 14 节允许的亮面/高光） ----------
const C = {
  body: '#c9c3b6', dk: '#a39d90', hi: '#e9e3d6', paper: '#efeadf', white: '#fffdf8',
  p: '#d9481f', s: '#f0a58a', eq: '#4a4640', ground: '#ddd5c5',
};

// ---------- 投影与采样 ----------
const G = D.groundY;
const PIV = 200;
const NS = 16;               // 每个周期采样数（往返动作 = 每半周期 8 帧，共 17 个值）
const BUDGET = { raw: 70 * 1024, gz: 12 * 1024, poster: 15 * 1024 };
const LIGHT = (() => { const v = [-0.45, -0.89], l = Math.hypot(...v); return [v[0] / l, v[1] / l]; })();
const ISO_SIDE = { sh: 17, el: 17, ha: 16, hip: 9, kn: 10, an: 10 };
// 肢体半径（屏幕像素，近端 → 远端）
const RAD = { UA: [9.2, 7], FA: [7, 5.2], TH: [12.6, 8.8], SH: [8.8, 5.8], FT: [5.2, 3.8], NK: [6.8, 6.8], head: 15.5, hand: 6, elbow: 6.8, knee: 8.4 };
const TORSO = { depth: 13, side: 17, front: 21 }; // 躯干横截面半轴（3D 单位）

function mkProj(o) {
  const yaw = o.yaw ?? 34, pitch = o.pitch ?? 16, SC = o.scale ?? 1.1, LIFT = o.lift ?? 22;
  const cy = Math.cos(rad(yaw)), sy = Math.sin(rad(yaw)), cp = Math.cos(rad(pitch)), sp = Math.sin(rad(pitch));
  const V = ([x, y, z]) => [SC * (x * cy - z * sy), SC * (y * cp + (x * sy + z * cy) * sp)];
  const Pt = ([x, y, z]) => {
    const dx = x - PIV, xr = dx * cy - z * sy, zr = dx * sy + z * cy;
    return [PIV + SC * xr, G - LIFT + SC * ((y - G) * cp + zr * sp), zr * cp + (G - y) * sp];
  };
  const W = [sy * cp, -sp, cy * cp]; // 指向观者
  return { V, Pt, W, SC };
}

// ---------- 小工具 ----------
const f1 = (v) => { const r = Math.round(v * 10) / 10; return Object.is(r, -0) ? '0' : String(r); };
const f2 = (v) => { const r = Math.round(v * 100) / 100; return Object.is(r, -0) ? '0' : String(r); };
const add2 = (a, b) => [a[0] + b[0], a[1] + b[1]];
const sub2 = (a, b) => [a[0] - b[0], a[1] - b[1]];
const mul2 = (a, k) => [a[0] * k, a[1] * k];
const dot2 = (a, b) => a[0] * b[0] + a[1] * b[1];
const cross2 = (a, b) => a[0] * b[1] - a[1] * b[0];
const len2 = (a) => Math.hypot(a[0], a[1]);
const P2 = (p) => `${f1(p[0])} ${f1(p[1])}`;
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const nrm3 = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
const rotv = (v, d) => { const c = Math.cos(rad(d)), s = Math.sin(rad(d)); return [c * v[0] - s * v[1], s * v[0] + c * v[1]]; };
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const unwrap = (angs) => { const o = [angs[0]]; for (let i = 1; i < angs.length; i++) { let a = angs[i]; while (a - o[i - 1] > 180) a -= 360; while (a - o[i - 1] < -180) a += 360; o.push(a); } return o; };

// 平滑闭合路径（Catmull-Rom → 三次贝塞尔）
function smooth(pts, closed = true) {
  const n = pts.length;
  const g = (i) => (closed ? pts[(i + n) % n] : pts[clamp(i, 0, n - 1)]);
  let d = `M${P2(pts[0])}`;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const p0 = g(i - 1), p1 = g(i), p2 = g(i + 1), p3 = g(i + 2);
    const c1 = add2(p1, mul2(sub2(p2, p0), 1 / 6)), c2 = sub2(p2, mul2(sub2(p3, p1), 1 / 6));
    d += `C${P2(c1)} ${P2(c2)} ${P2(p2)}`;
  }
  return d + (closed ? 'Z' : '');
}
// 锥形胶囊（A→B）
function capsule(A, B, r1, r2) {
  let d = sub2(B, A); const L = len2(d);
  d = L < 1e-3 ? [0, 1] : mul2(d, 1 / L);
  const n = [-d[1], d[0]];
  const a1 = add2(A, mul2(n, r1)), b1 = add2(B, mul2(n, r2)), b2 = add2(B, mul2(n, -r2)), a2 = add2(A, mul2(n, -r1));
  return `M${P2(a1)}L${P2(b1)}A${f1(r2)} ${f1(r2)} 0 0 0 ${P2(b2)}L${P2(a2)}A${f1(r1)} ${f1(r1)} 0 0 0 ${P2(a1)}Z`;
}
// 仿射圆（中心 c，共轭半径 a、b）
function ellipseD(c, a, b) {
  const k = 0.5523, p = (u, v) => [c[0] + a[0] * u + b[0] * v, c[1] + a[1] * u + b[1] * v];
  const q = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  let s = `M${P2(p(1, 0))}`;
  for (let i = 0; i < 4; i++) {
    const [u0, v0] = q[i], [u1, v1] = q[(i + 1) % 4];
    s += `C${P2(p(u0 + k * u1, v0 + k * v1))} ${P2(p(u1 + k * u0, v1 + k * v0))} ${P2(p(u1, v1))}`;
  }
  return s + 'Z';
}
// 共轭半径 → <ellipse>（主轴 + 旋转），比贝塞尔路径短
function ellEl(c, A, B, attrs) {
  const e00 = A[0] * A[0] + B[0] * B[0], e11 = A[1] * A[1] + B[1] * B[1], e01 = A[0] * A[1] + B[0] * B[1];
  const m = (e00 + e11) / 2, q = Math.sqrt(((e00 - e11) / 2) ** 2 + e01 * e01);
  const rx = Math.sqrt(m + q), ry = Math.sqrt(Math.max(0, m - q)), th = deg(0.5 * Math.atan2(2 * e01, e00 - e11));
  const tf = Math.abs(th) > 0.5 ? ` transform="rotate(${f1(th)} ${f1(c[0])} ${f1(c[1])})"` : '';
  return `<ellipse cx="${f1(c[0])}" cy="${f1(c[1])}" rx="${f1(rx)}" ry="${f1(Math.max(0.2, ry))}"${tf} ${attrs}/>`;
}
function basis(u) {
  const t = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const a = nrm3(cross3(u, t)); return [a, cross3(u, a)];
}

// ---------- 3D 关节 ----------
function joints3D(ex, rig, P, iso) {
  const J = {};
  const pt = (spec) => pointOf(rig, P, spec);
  if (ex.view === 'side') {
    const z = { ...ISO_SIDE, ...iso };
    const top = !!iso.top;
    const m3 = top ? ([x, y], h) => [x, G - 14 - h, y - 150] : ([x, y], zz) => [x, y, zz];
    const v3 = top ? ([x, y]) => [x, 0, y] : ([x, y]) => [x, y, 0];
    const put = (n, spec, zz) => { J[n] = m3(pt(spec), zz); };
    put('root', 'root', 0); put('neck', 'head', 0); put('neckTop', { node: 'head', at: [0, -12] }, 0); put('headC', { node: 'head', at: [0, -25] }, 0);
    for (const [s, m] of [['N', 1], ['F', -1]]) {
      put('sh' + s, 'sh' + s, m * z.sh); put('el' + s, 'el' + s, m * z.el); put('ha' + s, 'ha' + s, m * z.ha);
      put('hip' + s, 'hip' + s, m * z.hip); put('kn' + s, 'kn' + s, m * z.kn); put('an' + s, 'an' + s, m * z.an);
      put('heel' + s, { node: 'an' + s, at: [-4, 0] }, m * z.an); put('toe' + s, 'toe' + s, m * z.an);
    }
    if (P.$face !== undefined) put('nose', { node: 'head', at: [P.$face, -25] }, 15);
    const fr = (node) => { const M = nodeM(rig, P, node); const l = Math.hypot(M[0], M[1]); return nrm3(v3([M[0] / l, M[1] / l])); };
    return { J, front: fr, torsoFront: fr('torso'), torsoLat: top ? [0, -1, 0] : [0, 0, 1], z3: (spec, zz) => m3(pt(spec), zz) };
  }
  // 正面：2D x = 左右；z = 朝镜头（由投影长度比例反推）
  const put = (n, spec, zz = 0) => { const p = pt(spec); J[n] = [p[0], p[1], zz]; };
  put('root', 'root'); put('neck', 'head'); put('neckTop', { node: 'head', at: [0, -12] }); put('headC', { node: 'head', at: [0, -26] });
  const fwd = (a, b, L) => Math.sqrt(Math.max(0, L * L - (b[0] - a[0]) ** 2 - (b[1] - a[1]) ** 2));
  for (const s of ['L', 'R']) {
    const sg = (ex.armsBehind || []).includes(s) ? -1 : 1;
    put('sh' + s, 'sh' + s, 0); put('el' + s, 'el' + s); put('ha' + s, 'ha' + s);
    J['el' + s][2] = sg * fwd(J['sh' + s], J['el' + s], D.UA);
    J['ha' + s][2] = J['el' + s][2] + sg * fwd(J['el' + s], J['ha' + s], D.FA);
    put('hip' + s, 'hip' + s); put('kn' + s, 'kn' + s); put('an' + s, 'an' + s);
    J['kn' + s][2] = fwd(J['hip' + s], J['kn' + s], D.TH);
    J['an' + s][2] = J['kn' + s][2] - fwd(J['kn' + s], J['an' + s], D.SH);
    const a = J['an' + s];
    J['heel' + s] = [a[0], a[1] + 3, a[2] - 4]; J['toe' + s] = [a[0], a[1] + 3, a[2] + 16];
  }
  const M = nodeM(rig, P, 'torso'); const l = Math.hypot(M[0], M[1]);
  return { J, front: () => [0, 0, 1], torsoFront: [0, 0, 1], torsoLat: [M[0] / l, M[1] / l, 0], z3: (spec, zz) => { const p = pt(spec); return [p[0], p[1], zz]; } };
}

// ---------- 肌肉形状（局部坐标） ----------
// 四肢：[u 沿段 0..1, w 横向 -1..1（+ = 前侧）]；躯干侧视：[x 沿脊柱 3D 单位, y 横向（+ = 前）, 名义半宽 15]；
// 躯干正面：[x 沿脊柱, y 左右, 名义半宽 21]，pair = 左右镜像各一块。
const LIMB_SHAPES = {
  fdelt: { seg: 'UA', pts: [[-0.04, 0.1], [0.0, 0.85], [0.12, 1.02], [0.28, 0.78], [0.42, 0.3], [0.3, 0.06], [0.1, -0.05]] },
  sdelt: { seg: 'UA', pts: [[-0.05, -0.55], [-0.02, 0.55], [0.14, 0.82], [0.32, 0.4], [0.42, 0], [0.32, -0.4], [0.14, -0.82]] },
  rdelt: { seg: 'UA', pts: [[-0.04, -0.1], [0.0, -0.85], [0.12, -1.02], [0.28, -0.78], [0.42, -0.3], [0.3, -0.06], [0.1, 0.05]] },
  biceps: { seg: 'UA', pts: [[0.3, 0.2], [0.42, 0.82], [0.62, 1.0], [0.8, 0.72], [0.9, 0.3], [0.74, 0.12], [0.5, 0.1]] },
  triceps: { seg: 'UA', pts: [[0.1, -0.25], [0.18, -0.92], [0.48, -1.02], [0.78, -0.88], [0.9, -0.45], [0.76, -0.22], [0.45, -0.15]] },
  forearm: { seg: 'FA', pts: [[0.04, 0.55], [0.18, 1.0], [0.45, 0.82], [0.78, 0.45], [0.9, 0.12], [0.78, -0.4], [0.45, -0.82], [0.18, -0.98], [0.04, -0.5]] },
  quads: { seg: 'TH', pts: [[0.08, 0.15], [0.2, 0.8], [0.48, 1.02], [0.74, 0.92], [0.88, 0.55], [0.96, 0.22], [0.86, 0.06], [0.6, -0.08], [0.3, -0.12]], lines: [[[0.32, 0.5], [0.6, 0.55], [0.84, 0.38]]] },
  ham1: { seg: 'TH', pts: [[0.1, -0.5], [0.32, -0.98], [0.66, -1.0], [0.88, -0.78], [0.95, -0.55], [0.7, -0.58], [0.4, -0.6]] },
  ham2: { seg: 'TH', pts: [[0.14, -0.12], [0.4, -0.48], [0.7, -0.5], [0.9, -0.4], [0.93, -0.2], [0.7, -0.08], [0.4, -0.05]] },
  hipflex: { seg: 'TH', pts: [[-0.04, 0.3], [-0.02, 0.92], [0.16, 0.88], [0.32, 0.5], [0.2, 0.22]] },
  adductors: { seg: 'TH', pts: [[0.08, -0.28], [0.12, 0.3], [0.38, 0.24], [0.62, 0.06], [0.52, -0.12], [0.3, -0.3]] },
  glutelow: { seg: 'TH', pts: [[-0.06, -0.2], [-0.02, -1.0], [0.16, -0.98], [0.24, -0.55], [0.12, -0.25]] },
  calves: { seg: 'SH', pts: [[0.06, -0.3], [0.14, -0.96], [0.32, -1.08], [0.5, -0.86], [0.66, -0.5], [0.88, -0.34], [0.92, -0.18], [0.66, -0.22], [0.4, -0.16], [0.14, -0.1]] },
};
const TORSO_SIDE_OUTLINE = [[-9, 1], [-6, 13], [6, 14], [22, 12.5], [36, 13.5], [48, 16], [58, 15], [66, 10.5], [71, 3], [71, -4], [66, -12], [56, -16], [42, -14.5], [28, -12.5], [14, -14], [2, -16.5], [-7, -11]];
const TORSO_SIDE_SHAPES = {
  chest: { pts: [[63, 3], [60, 13], [51, 16.5], [43, 14.5], [41, 9], [47, 5], [56, 3]], lines: [[[60, 6], [50, 12]]] },
  abs: { pts: [[7, 9], [7, 13.6], [22, 12.8], [38, 13.8], [42, 9.5], [38, 6.5], [22, 7]], lines: [[[17, 7.5], [17, 13]], [[26, 7.2], [26, 13]], [[34, 7], [34, 13.5]]] },
  obliques: { pts: [[10, -2], [12, 8], [24, 11], [38, 10], [40, 2], [30, -4], [18, -5]], lines: [[[16, 4], [28, -1]], [[22, 8], [34, 2]]] },
  lats: { pts: [[57, -6], [52, -15.5], [40, -14.5], [26, -12.3], [17, -10.5], [28, -7], [44, -5]] },
  traps: { pts: [[72, -2], [70, -9], [64, -14], [57, -15.5], [60, -9], [66, -4]] },
  upperback: { pts: [[62, -6], [60, -15.6], [50, -15.6], [45, -12], [50, -6], [58, -4]] },
  lowerback: { pts: [[30, -8], [28, -12.6], [14, -13.8], [3, -15.6], [0, -10], [12, -8]], lines: [[[26, -10.5], [6, -12.5]]] },
  glutes: { pts: [[11, -9], [7, -16.8], [-2, -17.8], [-8, -14.5], [-10, -8], [-4, -4.5], [5, -5.5]], lines: [[[-9, -9], [-5, -5], [1, -4]]] },
  glutemed: { pts: [[17, -7], [14, -14.5], [6, -15.8], [4, -9], [9, -6]] },
  hipflex: { pts: [[-4, 9], [-2, 13.5], [8, 13.8], [12, 10], [6, 8]] },
};
const TORSO_FRONT_HALF = [[-9, 0], [-7, 15], [4, 17], [18, 14.5], [32, 15.5], [48, 20.5], [58, 23], [66, 19], [70, 10], [72, 3]];
const TORSO_FRONT_SHAPES = {
  chest: { pair: true, pts: [[60, 1.5], [62, 9], [58, 19.5], [51, 20.5], [43, 16], [40, 9], [42, 2]], lines: [[[57, 4], [50, 15]]] },
  abs: { pts: [[6, -7], [6, 7], [22, 8], [40, 7.5], [42, 0], [40, -7.5], [22, -8]], lines: [[[16, -7.5], [16, 7.5]], [[25, -7.6], [25, 7.6]], [[34, -7.4], [34, 7.4]], [[8, 0], [41, 0]]] },
  obliques: { pair: true, pts: [[8, 10], [10, 15.5], [24, 14.5], [36, 13.6], [32, 9], [18, 8.6]] },
  lats: { pair: true, pts: [[57, 17.5], [48, 21], [36, 16.8], [38, 14.4], [48, 15.8]] },
  traps: { pair: true, pts: [[72, 2.5], [69, 12], [63, 20.5], [60, 16], [66, 9], [70, 2.5]] },
  upperback: { pair: true, pts: [[65, 2], [63, 15], [55, 16], [52, 8], [56, 2]] },
  lowerback: { pts: [[4, -6], [4, 6], [20, 6], [22, 0], [20, -6]] },
  glutes: { pair: true, pts: [[2, 5], [0, 15.5], [-7, 15], [-8, 6]] },
  glutemed: { pair: true, pts: [[13, 13], [9, 17.8], [-2, 17.4], [0, 12], [6, 11]] },
  hipflex: { pair: true, pts: [[5, 4], [-3, 8], [-6, 14], [1, 13], [6, 9]] },
};
const MUSCLE_MAP = {
  chest: [['T', 'chest']], 'front-delt': [['L', 'fdelt']], 'side-delt': [['L', 'sdelt']], 'rear-delt': [['L', 'rdelt']],
  biceps: [['L', 'biceps']], triceps: [['L', 'triceps']], forearms: [['L', 'forearm']], abs: [['T', 'abs']], obliques: [['T', 'obliques']],
  'hip-flexors': [['L', 'hipflex'], ['T', 'hipflex']], quads: [['L', 'quads']], adductors: [['L', 'adductors']], calves: [['L', 'calves']],
  traps: [['T', 'traps']], 'upper-back': [['T', 'upperback']], lats: [['T', 'lats']], 'lower-back': [['T', 'lowerback']],
  glutes: [['T', 'glutes'], ['L', 'glutelow']], 'glute-med': [['T', 'glutemed']], hamstrings: [['L', 'ham1'], ['L', 'ham2']],
};

// ---------- SVG 输出 ----------
function mkOut(dur, STATIC) {
  const TIM = `dur="${dur}s" repeatCount="indefinite"`;
  const varies = (a) => a.some((v) => v !== a[0]);
  // 刚体组：frames = [{tx, ty, rot, sx, sy}]
  function rigid(frames, kids, extra = '') {
    const tr = frames.map((f) => `${f1(f.tx)} ${f1(f.ty)}`);
    const rots = unwrap(frames.map((f) => f.rot ?? 0)).map(f1);
    const scs = frames.map((f) => `${f2(f.sx ?? 1)} ${f2(f.sy ?? 1)}`);
    const hasR = rots.some((v) => v !== '0'), hasS = scs.some((v) => v !== '1 1');
    let tf = `translate(${tr[0]})` + (hasR ? ` rotate(${rots[0]})` : '') + (hasS ? ` scale(${scs[0]})` : '');
    let an = '';
    if (!STATIC && (varies(tr) || (hasR && varies(rots)) || (hasS && varies(scs)))) {
      an += `<animateTransform attributeName="transform" type="translate" values="${tr.join(';')}" ${TIM}/>`;
      if (hasR) an += `<animateTransform attributeName="transform" type="rotate" values="${rots.join(';')}" additive="sum" ${TIM}/>`;
      if (hasS) an += `<animateTransform attributeName="transform" type="scale" values="${scs.join(';')}" additive="sum" ${TIM}/>`;
    }
    return `<g transform="${tf}"${extra}>${an}${kids}</g>`;
  }
  // 普通属性动画
  function attrs(tag, st, dyn) {
    let s = `<${tag}`;
    for (const [k, v] of Object.entries(st)) s += ` ${k}="${v}"`;
    let kids = '';
    for (const [k, vals] of Object.entries(dyn)) {
      s += ` ${k}="${vals[0]}"`;
      if (!STATIC && varies(vals)) kids += `<animate attributeName="${k}" values="${vals.join(';')}" ${TIM}/>`;
    }
    return kids ? `${s}>${kids}</${tag}>` : `${s}/>`;
  }
  return { rigid, attrs, TIM };
}

// ---------- 渲染一个动作 ----------
function render(ex, samples, rig, STATIC) {
  const ID = 'a' + data.exercises.indexOf(ex).toString(36); // 短前缀：同页内联多个 SVG 也不冲突
  const iso = ex.iso || {};
  let pj = mkProj(iso);
  // 自动收缩：人物（含头）超出画框上沿 16 px 或左右 8 px 时，绕地面中心整体缩小（只缩不放）
  if (!iso.top && !iso.scale) {
    const JJ0 = samples.P.map((P) => joints3D(ex, rig, P, iso).J);
    let k = 1; const gy = G - (iso.lift ?? 22);
    for (const J of JJ0) for (const [n, p] of Object.entries(J)) {
      const q = pj.Pt(p); const pad = n === 'headC' ? RAD.head + 2 : 8;
      if (q[1] - pad < 16) k = Math.min(k, (gy - 16) / (gy - q[1] + pad));
      if (q[0] - pad < 8) k = Math.min(k, (PIV - 8) / (PIV - q[0] + pad));
      if (q[0] + pad > 392) k = Math.min(k, (392 - PIV) / (q[0] + pad - PIV));
    }
    if (k < 1) pj = mkProj({ ...iso, scale: 1.1 * k });
  }
  const SC = pj.SC;
  const front = ex.view === 'front';
  const sides = front ? ['L', 'R'] : ['N', 'F'];
  const FAR = front ? 'L' : 'F';
  const dur = samples.dur;
  const O = mkOut(dur, STATIC);
  const Ps = samples.P;
  const JJ = Ps.map((P) => joints3D(ex, rig, P, iso));
  const SP = JJ.map((j) => Object.fromEntries(Object.entries(j.J).map(([k, v]) => [k, pj.Pt(v)])));
  const defs = [];
  let uid = 0;
  const nid = (p) => `${ID}${p}${uid++}`;
  const items = []; // {depth, side, svg, layer}
  const lightLocal = (rotDeg, sgn = 1) => { const l = rotv(LIGHT, -rotDeg); return [l[0], l[1] * sgn]; };

  // 三层明暗：模板 path 放 defs，用 <use> 叠三次
  const shade3 = (pathD, cx, r, Ll, kind) => {
    const id = nid('s'); defs.push(`<path id="${id}" d="${pathD}"/>`);
    const o1 = mul2(Ll, 0.16 * r), o2 = mul2(Ll, 0.44 * r);
    const m = (kx, ky, o) => `matrix(${f2(kx)} 0 0 ${f2(ky)} ${f1(cx * (1 - kx) + o[0])} ${f1(o[1])})`;
    const k = kind === 'torso' ? [0.94, 0.86, 0.72, 0.42] : [0.98, 0.84, 0.9, 0.38];
    return `<use href="#${id}" fill="${C.dk}"/><use href="#${id}" fill="${C.body}" transform="${m(k[0], k[1], o1)}"/><use href="#${id}" fill="${C.hi}" transform="${m(k[2], k[3], o2)}"/>`;
  };
  // 一块肌肉：底色 + 深边 + 高光 + 腱划/分界线
  const muscle = (pts, lines, col, Ll, r) => {
    const id = nid('m');
    const cen = [mean(pts.map((p) => p[0])), mean(pts.map((p) => p[1]))];
    const edge = col === C.p ? `stroke="${C.eq}" stroke-opacity=".38"` : `stroke="${C.p}" stroke-opacity=".5"`;
    let s = `<path id="${id}" d="${smooth(pts)}" fill="${col}" ${edge} stroke-width=".9" stroke-linejoin="round"/>`;
    const o = mul2(Ll, 0.35 * r), k = 0.5;
    s += `<use href="#${id}" fill="${C.white}" fill-opacity=".3" stroke="none" transform="matrix(${k} 0 0 ${k} ${f1(cen[0] * (1 - k) + o[0])} ${f1(cen[1] * (1 - k) + o[1])})"/>`;
    for (const ln of lines || []) s += `<path d="${smooth(ln, false)}" fill="none" stroke="${C.eq}" stroke-opacity=".3" stroke-width=".8" stroke-linecap="round"/>`;
    return s;
  };
  const ball = (name, r, fill = `url(#${ID}-sph)`) => O.rigid(SP.map((S) => ({ tx: S[name][0], ty: S[name][1] })), `<circle r="${r}" fill="${fill}"/>`);
  const depthOf = (names) => mean(SP.map((S) => mean(names.map((n) => S[n][2]))));

  // ----- 肌肉清单 -----
  const mus = [];
  for (const m of ex.muscles.secondary || []) mus.push([m, C.s]);
  for (const m of ex.muscles.primary || []) mus.push([m, C.p]);
  const limbMus = {}, torsoMus = [];
  for (const [m, col] of mus) {
    if ((ex.hideMuscles || []).includes(m)) continue;
    const map = MUSCLE_MAP[m];
    if (!map) { console.warn(`  ! ${ID}: 没有肌肉映射 ${m}`); continue; }
    for (const [where, shape] of map) {
      if (where === 'T') torsoMus.push([shape, col]);
      else (limbMus[LIMB_SHAPES[shape].seg] ||= []).push([shape, col, m]);
    }
  }

  // ----- 手持器械：哪些手被器械包住（手画在器械组里） -----
  const eq = ex.equipment || [];
  const handInEq = new Set();
  for (const q of eq) if (['dumbbell', 'handle'].includes(q.type) && iso.bellAt !== 'mid') for (const h of q.hands || [q.hand]) handInEq.add(h);

  // ----- 躯干 -----
  const torsoFr = SP.map((S, i) => {
    const A = S.root, B = S.neck;
    const d = sub2(B, A), L = len2(d) || 1;
    const n = [-d[1] / L, d[0] / L];
    const fp = pj.V(JJ[i].torsoFront), lp = pj.V(JJ[i].torsoLat);
    const a = TORSO.depth, b = front ? TORSO.front : TORSO.side;
    const hw = Math.sqrt((dot2(n, fp) * a) ** 2 + (dot2(n, lp) * b) ** 2);
    return { A, L, rot: deg(Math.atan2(d[1], d[0])), hw, fsign: Math.sign(dot2(n, fp)) || 1 };
  });
  {
    const Lt = Math.max(...torsoFr.map((f) => f.L));
    const kx = Lt / D.T;
    const nom = (front ? TORSO.front : 15) * SC;
    const sg = front ? 1 : (mean(torsoFr.map((f) => f.fsign)) >= 0 ? 1 : -1);
    const tp = ([x, y]) => [x * kx, y * SC * sg * (front ? 1.15 : 1)];
    const outline = front ? [...TORSO_FRONT_HALF, ...TORSO_FRONT_HALF.slice(1).reverse().map(([x, y]) => [x, -y])] : TORSO_SIDE_OUTLINE;
    const rm = mean(torsoFr.map((f) => f.rot));
    const Ll = lightLocal(rm);
    let kids = shade3(smooth(outline.map(tp)), Lt * 0.45, 15 * SC, Ll, 'torso');
    const lib = front ? TORSO_FRONT_SHAPES : TORSO_SIDE_SHAPES;
    for (const [shape, col] of torsoMus) {
      const sh = lib[shape];
      const variants = sh.pair ? [1, -1] : [1];
      for (const v of variants) kids += muscle(sh.pts.map(([x, y]) => tp([x, y * v])), (sh.lines || []).map((ln) => ln.map(([x, y]) => tp([x, y * v]))), col, Ll, 6);
    }
    const frames = torsoFr.map((f) => ({ tx: f.A[0], ty: f.A[1], rot: f.rot, sx: f.L / Lt, sy: f.hw / nom }));
    items.push({ key: 'torso', depth: depthOf(['root', 'neck']) - 1, svg: O.rigid(frames, kids) });
  }
  const torsoDepth = items[0].depth;
  const torsoCenter = SP.map((S) => mul2(add2(S.root, S.neck), 0.5));

  // ----- 四肢 -----
  const segDefs = [];
  for (const s of sides) {
    segDefs.push({ key: 'UA', s, a: 'sh' + s, b: 'el' + s, node: 'sh' + s, after: ['el' + s, RAD.elbow] });
    segDefs.push({ key: 'FA', s, a: 'el' + s, b: 'ha' + s, node: 'el' + s, after: handInEq.has('ha' + s) ? null : ['ha' + s, RAD.hand] });
    segDefs.push({ key: 'TH', s, a: 'hip' + s, b: 'kn' + s, node: 'hip' + s, after: ['kn' + s, RAD.knee] });
    segDefs.push({ key: 'SH', s, a: 'kn' + s, b: 'an' + s, node: 'kn' + s });
    segDefs.push({ key: 'FT', s, a: 'heel' + s, b: 'toe' + s, node: 'an' + s });
  }
  segDefs.push({ key: 'NK', s: '', a: 'neck', b: 'neckTop', node: 'head' });
  for (const g of segDefs) {
    const k = g.s === FAR ? 0.94 : 1;
    const [r1, r2] = RAD[g.key].map((r) => r * k);
    const fr = SP.map((S, i) => {
      const A = S[g.a], B = S[g.b], d = sub2(B, A), L = len2(d);
      return { A, L, rot: deg(Math.atan2(d[1], d[0] || 1e-6)), d, i };
    });
    const Lt = Math.max(1, ...fr.map((f) => f.L));
    const rm = mean(unwrap(fr.map((f) => f.rot)));
    // 前侧在局部 +y 还是 -y
    let sg = 1, inner = 1;
    {
      const votes = fr.map((f) => {
        const n = [-f.d[1], f.d[0]];
        if (front) return Math.sign(dot2(n, sub2(torsoCenter[f.i], f.A))) || 1;
        return Math.sign(dot2(n, pj.V(JJ[f.i].front(g.node)))) || 1;
      });
      const v = mean(votes) >= 0 ? 1 : -1;
      if (front) inner = v; else sg = v;
    }
    const Ll = lightLocal(rm);
    let kids = shade3(capsule([0, 0], [Lt, 0], r1, r2), Lt / 2, (r1 + r2) / 2, Ll, 'limb');
    const showMus = !ex.muscleSide || g.s === ex.muscleSide || g.s === '';
    if (showMus) for (const [shape, col, mid] of limbMus[g.key] || []) {
      const sh = LIMB_SHAPES[shape];
      const wmap = (u, w) => {
        if (!front) return w * sg;
        if (mid === 'adductors') return inner * (0.25 + 0.55 * (w + 1) / 2);
        if (mid === 'side-delt') return -inner * (0.2 + 0.6 * Math.abs(w));
        if (/delt/.test(mid)) return w * 0.85;
        return w * 0.5;
      };
      const tp = ([u, w]) => [u * Lt, wmap(u, w) * (r1 + (r2 - r1) * clamp(u, 0, 1))];
      kids += muscle(sh.pts.map(tp), (sh.lines || []).map((ln) => ln.map(tp)), col, Ll, (r1 + r2) / 2);
    }
    let svg = O.rigid(fr.map((f) => ({ tx: f.A[0], ty: f.A[1], rot: f.rot, sx: f.L / Lt })), kids);
    if (g.after) svg += ball(g.after[0], f1(g.after[1] * k));
    items.push({ key: g.key + g.s, depth: depthOf([g.a, g.b]), side: g.s, svg });
  }

  // ----- 头 -----
  {
    let kids = `<circle r="${RAD.head}" fill="url(#${ID}-sph)"/>`;
    if (!front) {
      const J0 = JJ[0];
      const ear = sub2(pj.Pt(add3(J0.J.headC, add3(mul3(J0.front('head'), -2), iso.top ? [0, -13, 0] : [0, 1, 13]))), SP[0].headC);
      kids += `<ellipse cx="${f1(ear[0])}" cy="${f1(ear[1])}" rx="2.8" ry="3.8" fill="${C.dk}" fill-opacity=".55"/>`;
    }
    let svg = O.rigid(SP.map((S) => ({ tx: S.headC[0], ty: S.headC[1] })), kids);
    if (SP[0].nose) svg += ball('nose', 3.6, C.dk);
    items.push({ key: 'head', depth: depthOf(['headC']) + 2, svg });
  }

  // ----- 器械 -----
  const eqz = (i, def = 0) => (iso.eq && iso.eq[i] && iso.eq[i].z !== undefined ? iso.eq[i].z : def);
  const P3 = (xy, z) => (iso.top ? [xy[0], G - 2, xy[1] - 150 + 0 * z] : [xy[0], xy[1], z]);
  const pointAt = (spec, i, zdef) => {
    // 返回每帧的 3D 点
    if (Array.isArray(spec)) return Ps.map(() => P3(spec, zdef));
    if (typeof spec === 'string') return JJ.map((j) => j.J[spec]);
    return Ps.map((P, k) => {
      const jz = JJ[k].J[spec.node] ? JJ[k].J[spec.node][2] : 0;
      return JJ[k].z3(spec, iso.top ? 0 : jz);
    });
  };
  const dumbbellDefs = {};
  const axisOf = (ang) => {
    if (front) return Math.abs(ang) < 1 ? [1, 0, 0] : nrm3([Math.cos(rad(ang)), Math.sin(rad(ang)), 0]);
    if (Math.abs(ang) < 1) return iso.top ? [0, -1, 0] : [0, 0, 1];
    return nrm3([Math.cos(rad(ang)), Math.sin(rad(ang)), 0]);
  };
  // 有厚度的圆片（屏幕偏移 c2，法线 u，半径 R，厚度 t），正面带同心圆和高光
  const disc = (c2, u, R, t, face = true) => {
    const [a3, b3] = basis(u);
    const A = mul2(pj.V(a3), R / pj.SC), B = mul2(pj.V(b3), R / pj.SC);
    const vu = pj.V(mul3(u, t / 2 / pj.SC));
    const toward = dot3(u, pj.W) >= 0 ? 1 : -1;
    const back = sub2(c2, mul2(vu, toward)), fr2 = add2(c2, mul2(vu, toward));
    const v = sub2(fr2, back);
    const th = Math.atan2(cross2(B, v), cross2(A, v));
    const e = (tt) => add2(add2(mul2(A, Math.cos(tt)), mul2(B, Math.sin(tt))), back);
    const q0 = e(th), q1 = e(th + Math.PI);
    let s = ellEl(back, A, B, `fill="${C.eq}"`) + `<path d="M${P2(q0)}L${P2(add2(q0, v))}L${P2(add2(q1, v))}L${P2(q1)}Z" fill="${C.eq}"/>`;
    s += ellEl(fr2, A, B, `fill="${C.eq}" stroke="${C.white}" stroke-opacity=".14" stroke-width=".7"`);
    if (face) {
      s += ellEl(fr2, mul2(A, 0.6), mul2(B, 0.6), `fill="none" stroke="${C.white}" stroke-opacity=".22" stroke-width=".8"`);
      s += ellEl(add2(fr2, mul2(LIGHT, R * 0.2)), mul2(A, 0.28), mul2(B, 0.28), `fill="${C.white}" fill-opacity=".16"`);
    }
    return s;
  };
  const metalTube = (A, B, r) => {
    const o = mul2(LIGHT, r * 0.35);
    return `<path d="${capsule(A, B, r, r)}" fill="${C.eq}"/><path d="${capsule(add2(A, o), add2(B, o), r * 0.35, r * 0.35)}" fill="${C.white}" fill-opacity=".22"/>`;
  };
  const dumbbellDef = (u, sc) => {
    const key = u.map((x) => x.toFixed(2)).join(',') + ':' + sc;
    if (dumbbellDefs[key]) return dumbbellDefs[key];
    const h = 5 * sc;
    const parts = [];
    const at = (t) => pj.V(mul3(u, t));
    parts.push({ d: 0, svg: metalTube(at(-h - 1), at(h + 1), 2.2) });
    for (const sg of [-1, 1]) {
      const dd = sg * dot3(u, pj.W);
      parts.push({ d: dd * 1, svg: disc(at(sg * (h + 2.1)), u, 10 * sc * pj.SC, 4.2 * pj.SC, false) });
      parts.push({ d: dd * 2, svg: disc(at(sg * (h + 5.8)), u, 7.4 * sc * pj.SC, 3.2 * pj.SC, true) });
      parts.push({ d: dd * 3, svg: disc(at(sg * (h + 8.3)), u, 2.8 * pj.SC, 1.8 * pj.SC, false) });
    }
    parts.sort((a, b) => a.d - b.d);
    const idb = nid('db'), idf = nid('db');
    defs.push(`<g id="${idb}">${parts.filter((p) => p.d <= 0).map((p) => p.svg).join('')}</g>`);
    defs.push(`<g id="${idf}">${parts.filter((p) => p.d > 0).map((p) => p.svg).join('')}</g>`);
    return (dumbbellDefs[key] = [idb, idf]);
  };
  // 定向长方体：角点 O，三条棱 a、b、c；style: pad / metal / box
  const box = (O3, a, b, c, style = 'pad') => {
    const faces = [];
    const quad = (o, e1, e2) => [o, add3(o, e1), add3(add3(o, e1), e2), add3(o, e2)];
    for (const [e, f1v, f2v] of [[a, b, c], [b, c, a], [c, a, b]]) {
      const n = nrm3(e);
      for (const sgn of [-1, 1]) {
        const o = sgn > 0 ? add3(O3, e) : O3;
        const dn = dot3(mul3(n, sgn), pj.W);
        if (dn <= 0.001) continue;
        const up = -n[1] * sgn;
        faces.push({ pts: quad(o, f1v, f2v).map((p) => pj.Pt(p)), up, nz: dn });
      }
    }
    return faces.map((f) => {
      let fill;
      if (style === 'metal') fill = C.eq;
      else fill = f.up > 0.6 ? C.paper : f.nz > 0.7 ? C.ground : C.body;
      const extra = style === 'metal' ? (f.up > 0.6 ? `<path d="M${f.pts.map(P2).join('L')}Z" fill="${C.white}" fill-opacity=".14"/>` : '') : '';
      const stroke = style === 'metal' ? C.eq : C.dk;
      return `<path d="M${f.pts.map(P2).join('L')}Z" fill="${fill}" stroke="${stroke}" stroke-width="1" stroke-linejoin="round"/>` + extra;
    }).join('');
  };
  const pt3 = (x, y, z) => pj.Pt([x, y, z]);
  const hasPulleyEx = eq.some((q) => q.type === 'pulley' || q.type === 'bar' || (q.type === 'column' && (q.pulleys || []).length));
  const columns = [];
  const torsoMid = (L) => (L === 'mid' ? Math.max(torsoDepth, items.find((it) => it.key === 'head').depth) + 0.5 : L === 'back' ? -1e9 : L === 'front' ? 1e9 : null);

  eq.forEach((q, qi) => {
    const L = q.layer;
    const push = (svg, depth, side) => items.push({ key: 'eq' + qi, depth: torsoMid(L) ?? depth, svg, side, layer: L });
    switch (q.type) {
      case 'dumbbell': case 'handle': {
        const u = axisOf(q.angle ?? 0), sc = q.scale ?? 1;
        let hands = q.hands || [q.hand];
        if (iso.bellAt === 'mid') hands = ['mid'];
        for (const h of hands) {
          const pos = h === 'mid' ? SP.map((S, i) => pj.Pt(add3(mul3(add3(JJ[i].J[sides[0] === 'N' ? 'haN' : 'haR'], JJ[i].J[sides[0] === 'N' ? 'haF' : 'haL']), 0.5), [1, 10, 0]))) : SP.map((S) => S[h]);
          let kids;
          if (q.type === 'dumbbell') {
            const [b, f] = dumbbellDef(u, sc);
            kids = `<use href="#${b}"/>` + (h !== 'mid' ? `<circle r="${RAD.hand}" fill="url(#${ID}-sph)"/>` : '') + `<use href="#${f}"/>`;
          } else {
            const A = pj.V(mul3(u, -8)), B = pj.V(mul3(u, 8));
            kids = `<path d="${capsule(A, B, 3.6, 3.6)}" fill="${C.eq}"/><path d="${capsule(add2(A, [-1, -1.2]), add2(B, [-1, -1.2]), 1.2, 1.2)}" fill="${C.white}" fill-opacity=".2"/>` +
              `<circle r="${RAD.hand}" fill="url(#${ID}-sph)"/>`;
          }
          const fa = h === 'mid' ? null : items.find((it) => it.key === 'FA' + h.slice(2));
          const dep = mean(pos.map((p) => p[2]));
          push(O.rigid(pos.map((p) => ({ tx: p[0], ty: p[1] })), kids), Math.max(dep, fa ? fa.depth : -1e9) + 0.2, h === 'mid' ? '' : h.slice(2));
        }
        break;
      }
      case 'box': {
        const z0 = eqz(qi, 0);
        push(box([q.x, q.y, z0 - 30], [q.w, 0, 0], [0, G - q.y, 0], [0, 0, 60]), -1e9);
        break;
      }
      case 'bench': {
        const z0 = eqz(qi, 0); let s = '';
        for (const lx of [q.x + 18, q.x + q.w - 18]) {
          s += metalTube(pj.Pt([lx, q.y + 10, z0]), pj.Pt([lx, G, z0 - 15]), 2.6) + metalTube(pj.Pt([lx, q.y + 10, z0]), pj.Pt([lx, G, z0 + 15]), 2.6) + metalTube(pj.Pt([lx, G - 1, z0 - 17]), pj.Pt([lx, G - 1, z0 + 17]), 2.4);
        }
        s += box([q.x, q.y, z0 - 16], [q.w, 0, 0], [0, 11, 0], [0, 0, 32]);
        push(s, -1e9);
        break;
      }
      case 'inclineBench': {
        const { x, y, seatW = 50, backL = 90, angle = 30 } = q; const z0 = eqz(qi, 0);
        const dir = [-Math.cos(rad(angle)), -Math.sin(rad(angle)), 0];
        const nrm = [-Math.sin(rad(angle)), Math.cos(rad(angle)), 0];
        const bx = x - backL * Math.cos(rad(angle)), by = y + 6 - backL * Math.sin(rad(angle));
        let s = '';
        s += metalTube(pt3(x + seatW - 8, y + 14, z0), pt3(x + seatW - 8, G, z0), 3) + metalTube(pt3(x - 4, y + 14, z0), pt3(x - 4, G, z0), 3);
        s += metalTube(pt3(x - 4, y + 34, z0), pt3(bx + 25, by + 20, z0), 2.6) + metalTube(pt3(bx + 22, by + 18, z0), pt3(bx + 22, G, z0), 3);
        for (const fx of [x - 4, x + seatW - 8, bx + 22]) s += metalTube(pt3(fx, G - 1, z0 - 15), pt3(fx, G - 1, z0 + 15), 2.4);
        s += box([x - 2, y + 6 - 4, z0 - 15], mul3(dir, backL + 2), mul3(nrm, 10), [0, 0, 30]);
        s += box([x - 4, y + 2, z0 - 15], [seatW + 6, 0, 0], [0, 10, 0], [0, 0, 30]);
        push(s, -1e9);
        break;
      }
      case 'column': {
        const z0 = eqz(qi, front ? -6 : 0);
        const top = q.top ?? 20; let s = '';
        if (!hasPulleyEx && !(q.pulleys || []).length) {
          s += box([q.x - 6, top, z0 - 6], [12, 0, 0], [0, G - top, 0], [0, 0, 12]);
        } else {
          s += box([q.x - 17, G - 4, z0 - 17], [34, 0, 0], [0, 4, 0], [0, 0, 34], 'metal');
          s += metalTube(pt3(q.x, top, z0), pt3(q.x, G - 3, z0), 4.6);
          for (const py of q.pulleys || []) s += disc(pt3(q.x + 0, py, z0 + 7).slice(0, 2), [0, 0, 1], 8.5 * pj.SC, 4 * pj.SC, true) + `<circle cx="${f1(pt3(q.x, py, z0 + 9.5)[0])}" cy="${f1(pt3(q.x, py, z0 + 9.5)[1])}" r="1.8" fill="${C.white}" fill-opacity=".35"/>`;
        }
        columns.push({ x: q.x, top, z0 });
        push(s, pt3(q.x, 170, z0)[2] - 2); // 立柱参与深度排序（在人前面时挡住人）
        break;
      }
      case 'pulley': {
        const z0 = eqz(qi, front ? -6 : 0);
        push(disc(pt3(q.cx, q.cy, z0).slice(0, 2), [0, 0, 1], (q.r ?? 7) * 1.2 * pj.SC, 4 * pj.SC, true), -1e9);
        break;
      }
      case 'line': {
        const z0 = eqz(qi, front ? -6 : 0), w = q.width ?? 6;
        let s;
        if (w >= 9) {
          const dx = q.x2 - q.x1, dy = q.y2 - q.y1;
          const dep = q.layer === 'front' ? 16 : 34;
          s = box([q.x1, q.y1 - w / 2, z0 - dep / 2], [dx, dy, 0], [0, w, 0], [0, 0, dep]);
        } else s = metalTube(pt3(q.x1, q.y1, z0), pt3(q.x2, q.y2, z0), w / 2);
        push(s, -1e9);
        break;
      }
      case 'anchor': {
        const z0 = eqz(qi, 0);
        let s = box([q.x - 16, q.y - 12, z0 - 8], [32, 0, 0], [0, 6, 0], [0, 0, 16], 'metal');
        const c = pt3(q.x, q.y, z0);
        s += `<circle cx="${f1(c[0])}" cy="${f1(c[1])}" r="4.5" fill="none" stroke="${C.eq}" stroke-width="2.4"/>`;
        push(s, -1e9);
        break;
      }
      case 'mat': {
        const z0 = 0;
        const y0 = q.y - 150, h = q.h;
        void z0;
        push(box([q.x, G - 4, y0], [q.w, 0, 0], [0, 4, 0], [0, 0, h]), -1e9);
        break;
      }
      case 'ball': {
        const r = q.r, z0 = eqz(qi, 0);
        const cxs = Ps.map((P) => (typeof q.cx === 'string' ? P[q.cx] : q.cx));
        const pos = cxs.map((cx) => pt3(cx, G - r, z0));
        const R = r * pj.SC;
        const seamFr = cxs.map((cx) => deg((cx - cxs[0]) / r));
        const seam = O.rigid(seamFr.map((a) => ({ tx: 0, ty: 0, rot: a })), `<path d="M${f1(-R * 0.75)} ${f1(-R * 0.55)}Q0 ${f1(R * 0.05)} ${f1(R * 0.75)} ${f1(-R * 0.55)}" fill="none" stroke="${C.dk}" stroke-width="1.6" stroke-opacity=".7"/><path d="M${f1(-R * 0.6)} ${f1(R * 0.7)}Q0 ${f1(R * 0.2)} ${f1(R * 0.6)} ${f1(R * 0.7)}" fill="none" stroke="${C.dk}" stroke-width="1.2" stroke-opacity=".45"/>`);
        const kids = `<circle r="${f1(R)}" fill="url(#${ID}-ball)" stroke="${C.dk}" stroke-width="1"/>${seam}<ellipse cx="${f1(-R * 0.34)}" cy="${f1(-R * 0.4)}" rx="${f1(R * 0.22)}" ry="${f1(R * 0.13)}" transform="rotate(-35 ${f1(-R * 0.34)} ${f1(-R * 0.4)})" fill="${C.white}" fill-opacity=".7"/>`;
        push(O.rigid(pos.map((p) => ({ tx: p[0], ty: p[1] })), kids), mean(pos.map((p) => p[2])));
        samples.ballX = cxs; samples.ballR = r;
        break;
      }
      case 'cable': case 'strap': case 'band': {
        const zFixed = eqz(qi, 0);
        let A3 = pointAt(q.from, qi, zFixed), B3 = pointAt(q.to, qi, zFixed);
        // 从立柱滑轮出来的绳：起点放在滑轮外沿
        const A = A3.map((p) => pj.Pt(p)), B = B3.map((p) => pj.Pt(p));
        const v = (arr, k) => arr.map((p) => f1(p[k]));
        const dep = mean([...A, ...B].map((p) => p[2]));
        let s = '';
        if (q.type === 'cable') {
          s = O.attrs('line', { stroke: C.eq, 'stroke-width': 1.7, 'stroke-linecap': 'round' }, { x1: v(A, 0), y1: v(A, 1), x2: v(B, 0), y2: v(B, 1) });
        } else if (q.type === 'strap') {
          s = O.attrs('line', { stroke: C.eq, 'stroke-width': q.width ?? 4.6, 'stroke-linecap': 'round' }, { x1: v(A, 0), y1: v(A, 1), x2: v(B, 0), y2: v(B, 1) });
          s += O.attrs('line', { stroke: C.white, 'stroke-opacity': '.2', 'stroke-width': 1.2 }, { x1: v(A, 0), y1: v(A, 1), x2: v(B, 0), y2: v(B, 1) });
        } else {
          const w = q.width ?? 5, base = q.restLen ?? 50;
          const ws = A.map((a, i) => f1(clamp(w * Math.sqrt(base / Math.max(1, len2(sub2(B[i], a)))), 2, w * 1.3)));
          s = O.attrs('line', { stroke: C.eq, 'stroke-linecap': 'round' }, { x1: v(A, 0), y1: v(A, 1), x2: v(B, 0), y2: v(B, 1), 'stroke-width': ws });
          s += O.attrs('line', { stroke: C.white, 'stroke-opacity': '.22', 'stroke-width': 1.1 }, { x1: v(A, 0), y1: v(A, 1), x2: v(B, 0), y2: v(B, 1) });
          for (const E of [A, B]) s += O.attrs('ellipse', { rx: 6.5, ry: 4.2, fill: 'none', stroke: C.eq, 'stroke-width': 2.2 }, { cx: v(E, 0), cy: v(E, 1) });
        }
        push(s, L ? dep : dep + 3);
        break;
      }
      case 'bar': {
        const half = q.half ?? 80;
        const A3 = pointAt(q.from, qi, 0), B3 = pointAt(q.to, qi, 0);
        const cen = A3.map((a, i) => pj.Pt(mul3(add3(a, B3[i]), 0.5)));
        const ax = front ? [1, 0, 0] : [0, 0, 1];
        const e1 = pj.V(mul3(ax, -half)), e2 = pj.V(mul3(ax, half));
        let kids = metalTube(e1, e2, 2.8);
        for (const sg of [-1, 1]) { const p = pj.V(mul3(ax, sg * half * 0.82)); kids += `<path d="${capsule(p, add2(p, mul2(sub2(e2, e1), sg * 0.12)), 3.6, 3.6)}" fill="${C.eq}"/>`; }
        let s = O.rigid(cen.map((p) => ({ tx: p[0], ty: p[1] })), kids);
        if (q.cableFrom) {
          const z0 = eqz(qi, front ? -6 : 0);
          const c0 = pt3(q.cableFrom[0], q.cableFrom[1], z0);
          s = O.attrs('line', { x1: f1(c0[0]), y1: f1(c0[1]), stroke: C.eq, 'stroke-width': 1.7 }, { x2: cen.map((p) => f1(p[0])), y2: cen.map((p) => f1(p[1] - 2)) }) + s;
        }
        push(s, mean(cen.map((p) => p[2])) + 4);
        break;
      }
      default: break;
    }
  });
  // 龙门架：两根立柱时加顶梁
  if (columns.length === 2 && front) {
    const [a, b] = columns;
    items.push({ key: 'beam', depth: -1e9, svg: metalTube(pt3(a.x, a.top, a.z0), pt3(b.x, b.top, b.z0), 4.5) });
  }

  // ----- 地面：网格（静态，可选滚动）、淡色地块、随动软影 -----
  let ground = '';
  const ticks = eq.find((q) => q.type === 'ticks');
  const groundOn = ex.ground !== false && !iso.top;
  const gc = pt3(PIV, G, 0);
  if (groundOn) {
    const X0 = 25, X1 = 375, Z0 = -84, Z1 = 84, XS = 25, ZS = 28;
    let gd = '';
    const ext = ticks ? 100 : 0;
    for (let x = X0; x <= X1 + ext + 0.1; x += XS) gd += `M${P2(pt3(x, G, Z0))}L${P2(pt3(x, G, Z1))}`;
    for (let zz = Z0; zz <= Z1 + 0.1; zz += ZS) gd += `M${P2(pt3(X0, G, zz))}L${P2(pt3(X1 + ext, G, zz))}`;
    const floor = [[X0, Z0], [X1, Z0], [X1, Z1], [X0, Z1]].map(([x, zz]) => P2(pt3(x, G, zz))).join('L');
    let grid = `<path d="${gd}" fill="none" stroke="${C.ground}" stroke-width="1"/>`;
    if (ticks) {
      const sh = pj.V([-(ticks.distance ?? 100), 0, 0]);
      grid = `<g>${STATIC ? '' : `<animateTransform attributeName="transform" type="translate" values="0 0;${f1(sh[0])} ${f1(sh[1])}" ${O.TIM}/>`}${grid}</g>`;
    }
    defs.push(`<radialGradient id="${ID}-fade" gradientUnits="userSpaceOnUse" cx="${f1(gc[0])}" cy="${f1(gc[1])}" r="190" gradientTransform="translate(${f1(gc[0])} ${f1(gc[1])}) scale(1 .32) translate(${f1(-gc[0])} ${f1(-gc[1])})"><stop offset="0" stop-color="#fff"/><stop offset=".55" stop-color="#fff" stop-opacity=".75"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`);
    defs.push(`<mask id="${ID}-gm" maskUnits="userSpaceOnUse" x="0" y="0" width="400" height="300"><rect width="400" height="300" fill="url(#${ID}-fade)"/></mask>`);
    ground += `<g mask="url(#${ID}-gm)"><path d="M${floor}Z" fill="${C.paper}" fill-opacity=".7"/>${grid}</g>`;
  }
  // 软影：所有关节（和球）在地面上的包络 → 屏幕椭圆（在 x 轴投影方向的旋转坐标系里）
  if (!iso.top) {
    const xa = pj.V([1, 0, 0]); const ang = deg(Math.atan2(xa[1], xa[0]));
    const fr = JJ.map((j, i) => {
      const pts = Object.values(j.J);
      let xs = pts.map((p) => p[0]);
      if (samples.ballX) xs = xs.concat([samples.ballX[i] - samples.ballR, samples.ballX[i] + samples.ballR]);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const zs = pts.map((p) => Math.abs(p[2]));
      const c = pt3((minX + maxX) / 2 + 6, G, 0);
      const cr = rotv(c, -ang);
      return { cx: cr[0], cy: cr[1], rx: len2(pj.V([(maxX - minX) / 2 + 14, 0, 0])), ry: Math.max(5, Math.abs(pj.V([0, 0, Math.max(...zs) + 12])[1]) * 1.15) };
    });
    defs.push(`<radialGradient id="${ID}-shd"><stop offset="0" stop-color="${C.dk}" stop-opacity=".5"/><stop offset=".55" stop-color="${C.dk}" stop-opacity=".22"/><stop offset="1" stop-color="${C.dk}" stop-opacity="0"/></radialGradient>`);
    ground += `<g transform="rotate(${f1(ang)})">` + O.attrs('ellipse', { fill: `url(#${ID}-shd)` }, { cx: fr.map((f) => f1(f.cx)), cy: fr.map((f) => f1(f.cy)), rx: fr.map((f) => f1(f.rx)), ry: fr.map((f) => f1(f.ry)) }) + '</g>';
  }

  // ----- 排序输出 -----
  const back = items.filter((it) => it.depth <= -1e8).map((it) => it.svg).join('');
  const frontL = items.filter((it) => it.depth >= 1e8).map((it) => it.svg).join('');
  const mid = items.filter((it) => Math.abs(it.depth) < 1e8).sort((a, b) => a.depth - b.depth);
  const far = mid.filter((it) => it.side === FAR && it.depth < torsoDepth);
  const rest = mid.filter((it) => !far.includes(it));
  defs.unshift(`<radialGradient id="${ID}-sph" cx=".5" cy=".5" r=".55" fx=".36" fy=".3"><stop offset="0" stop-color="${C.hi}"/><stop offset=".55" stop-color="${C.body}"/><stop offset="1" stop-color="${C.dk}"/></radialGradient>`);
  if (samples.ballX) defs.push(`<radialGradient id="${ID}-ball" cx=".5" cy=".5" r=".55" fx=".35" fy=".3"><stop offset="0" stop-color="${C.white}"/><stop offset=".6" stop-color="${C.ground}"/><stop offset="1" stop-color="${C.dk}"/></radialGradient>`);
  const body = ground + back + `<g opacity=".82">${far.map((it) => it.svg).join('')}</g>` + rest.map((it) => it.svg).join('') + frontL;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><title>${ex.zh} · ${ex.en}</title><defs>${defs.join('')}</defs>${body}</svg>\n`;
}

// ---------- 采样 ----------
function sampleExercise(ex, rig) {
  const KF = ex.keyframes.map((k) => resolveKF(ex, k, rig));
  for (let i = 1; i < KF.length; i++) {
    for (const key of KF[i]._ik) {
      while (KF[i][key] - KF[i - 1][key] > 180) KF[i][key] -= 360;
      while (KF[i][key] - KF[i - 1][key] < -180) KF[i][key] += 360;
    }
  }
  const TL = makeTimeline(ex, KF);
  const P = TL.n === 1 ? [TL.frames[0]] : Array.from({ length: NS + 1 }, (_, i) => TL.at(i / NS));
  return { KF, TL, samples: { P, dur: TL.dur } };
}

// ---------- 主流程 ----------
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/poses.json'), 'utf8'));
const list = data.exercises.filter((e) => !opt.only || opt.only.includes(e.id));
fs.mkdirSync(OUT, { recursive: true });
if (opt.frames) fs.mkdirSync(opt.frames, { recursive: true });
const frameCells = [];
const sizes = [];
const bad = (s) => /<style|<script|NaN|undefined|Infinity/.test(s);

for (const ex of list) {
  const rig = ex.view === 'side' ? sideRig() : frontRig();
  const { KF, samples } = sampleExercise(ex, rig);
  if (opt.debug) {
    console.log(`\n# ${ex.id}`);
    KF.forEach((P, i) => {
      const J = joints3D(ex, rig, P, ex.iso || {}).J;
      console.log(`  kf${i}: ` + Object.entries(J).map(([k, v]) => `${k}(${v.map((x) => x.toFixed(0)).join(',')})`).join(' '));
    });
  }
  const svg = render(ex, samples, rig, false);
  const poster = render(ex, { P: [samples.P[0]], dur: samples.dur }, rig, true);
  fs.writeFileSync(path.join(OUT, ex.id + '.svg'), svg);
  fs.writeFileSync(path.join(OUT, ex.id + '.poster.svg'), poster);
  const raw = Buffer.byteLength(svg), gz = zlib.gzipSync(svg, { level: 9 }).length, pr = Buffer.byteLength(poster);
  sizes.push({ id: ex.id, raw, gz, pr, bad: bad(svg) || bad(poster) });
  if (opt.frames) {
    KF.forEach((P, i) => {
      const f = `${ex.id}-k${i}.svg`;
      fs.writeFileSync(path.join(opt.frames, f), render(ex, { P: [P], dur: samples.dur }, rig, true));
      frameCells.push(f);
    });
  }
}

if (opt.frames) {
  const page = (cells) => `<!doctype html><meta charset="utf-8"><style>body{font:12px sans-serif;display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:8px}figure{margin:0;border:1px solid #ddd;background:#fffdf8}img{width:100%;display:block}</style>` +
    cells.map((f) => `<figure><img src="${f}"><figcaption>${f}</figcaption></figure>`).join('');
  fs.writeFileSync(path.join(opt.frames, 'index.html'), page(frameCells));
}

// 预览页（始终包含全部动作）。用 <object> 嵌入，便于 setCurrentTime 定格：contact-sheet.html?t=0.3
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const cells = data.exercises.map((e, i) => `  <figure><object type="image/svg+xml" data="${e.id}.svg" data-dur="${e.period ?? 3}" aria-label="${esc(e.zh)} 动画"></object><figcaption><b>${i + 1}. ${esc(e.zh)}</b><span>${esc(e.en)}</span><code>${e.id} · ${e.viewLabel || (e.view === 'side' ? '侧视' : '正面')}</code></figcaption></figure>`).join('\n');
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
  figure object { display: block; width: 100%; aspect-ratio: 4 / 3; background: #fffdf8; pointer-events: none; }
  figcaption { padding: 8px 10px; display: flex; flex-wrap: wrap; gap: 2px 8px; align-items: baseline; border-top: 1px solid var(--line); }
  figcaption b { font-size: 15px; }
  figcaption span { color: var(--ink-2); }
  figcaption code { width: 100%; font-size: 11px; color: #9a9488; }
</style>
</head>
<body>
<h1>Fit101 · 动作动画预览（${data.exercises.length} 个）</h1>
<p class="note">由 scripts/gen-anim.mjs（v2，伪 3D 四分之三视角）从 data/poses.json 生成。深红 = 主要发力肌群，浅红 = 辅助。地址后加 <code>?t=0.3</code> 把全部动画定格在周期的 30%。</p>
<div class="grid">
${cells}
</div>
<script>
  const t = parseFloat(new URLSearchParams(location.search).get('t'));
  if (!isNaN(t)) for (const o of document.querySelectorAll('object')) {
    const freeze = () => { const s = o.contentDocument && o.contentDocument.documentElement; if (s && s.pauseAnimations) { s.pauseAnimations(); s.setCurrentTime(t * parseFloat(o.dataset.dur)); } };
    o.addEventListener('load', freeze); freeze();
  }
</script>
</body>
</html>
`;
fs.writeFileSync(path.join(OUT, 'contact-sheet.html'), sheet);

// 体积表
console.log('\n id                         raw KB   gzip KB  poster KB');
let fail = 0;
for (const s of sizes) {
  const over = s.raw > BUDGET.raw || s.gz > BUDGET.gz || s.pr > BUDGET.poster || s.bad;
  if (over) fail++;
  console.log(` ${s.id.padEnd(26)} ${(s.raw / 1024).toFixed(1).padStart(6)}  ${(s.gz / 1024).toFixed(1).padStart(7)}  ${(s.pr / 1024).toFixed(1).padStart(8)}${over ? '  ✗ 超预算' + (s.bad ? '/含 NaN 等' : '') : ''}`);
}
const tot = sizes.reduce((a, s) => [a[0] + s.raw, a[1] + s.gz], [0, 0]);
console.log(` 合计 ${sizes.length} 个：${(tot[0] / 1024).toFixed(0)} KB，gzip ${(tot[1] / 1024).toFixed(0)} KB`);
if (fail) { console.error(`✗ ${fail} 个文件超出体积预算（每个 ≤ 70 KB、gzip ≤ 12 KB、首帧 ≤ 15 KB）`); process.exit(1); }
console.log('✓ 全部在预算内；contact-sheet.html 已更新');
