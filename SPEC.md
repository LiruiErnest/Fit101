# Fit101 · 课程模块 实现规范（v1）

这是 Fit101 第一版的实现契约。几个子代理并行工作，各自只写自己负责的文件；所有文件名、字段名、肌肉 id 以本文为准，不要自行改名。
项目根目录：本仓库根目录（原先在 iCloud 里，2026-10-06 移到本地 Dev 目录）。
设计方案（已经用户确认）：`plan/课程模块-v1.packed.html`。

## 0. 已确认的决定
- 动图：手画 SVG 动画。不逐个手画，而是用“关节骨架 + 姿势关键帧”生成。风格参考训记 app：浅灰人体、发力肌肉标红（主要）/ 淡红（辅助）、器械深灰、简洁无背景。
- 重量：lb 为主，括号里写 kg（1 lb = 0.4536 kg，保留 1 位小数）。
- 页面：每节课一页，共 12 页，加一页“动作库”，加首页。
- 未上的课（第 4 到 12 节）：只放日期和“待上课”。
- 记录方式：用户在对话里告诉 Claude，Claude 改 `data/sessions.json` 后重新生成。
- 每张动作卡片可以展开，显示肌肉部位图（正面 + 背面人体，主要肌群深蓝、辅助浅蓝，风格参考训记的“部位概览”）。
- 不修改 `~/.claude/skills/html-author/` 的任何文件。样式扩展全部放在 `assets/fit.css`。

## 1. 文件布局
```
Fit101/
  SPEC.md                 # 本文
  data/exercises.json     # 动作库（代理 A）
  data/sessions.json      # 12 节课（代理 A）
  data/poses.json         # 每个动作的姿势关键帧（代理 B）
  scripts/gen-anim.mjs    # poses.json → assets/anim/*.svg（代理 B）
  scripts/build.mjs       # data → docs/*.md → html-author → site/（代理 D）
  assets/anim/<id>.svg    # 生成的动画（代理 B）
  assets/anim/contact-sheet.html   # 所有动画一页预览（代理 B）
  assets/body-map.svg     # 正面 + 背面肌肉图（代理 C）
  assets/body-map-preview.html     # 肌肉图预览，可点选区域（代理 C）
  assets/fit.css          # 卡片、动画盒、肌肉图、展开面板的样式（代理 D）
  docs/                   # 生成的 Markdown，不手改（代理 D 生成）
  site/                   # 生成的网站，打开 site/index.html（代理 D 生成）
  plan/                   # 设计方案，不动
```
Node 24 可用。不要安装全局包。`marked` 已在 `~/.claude/skills/html-author/node_modules`。

## 2. 肌肉 id（全站统一）
| id | 中文 | 面 |
|---|---|---|
| chest | 胸大肌 | 正 |
| front-delt | 肩前束 | 正 |
| side-delt | 肩中束 | 正/背 |
| rear-delt | 肩后束 | 背 |
| biceps | 肱二头肌 | 正 |
| triceps | 肱三头肌 | 背 |
| forearms | 前臂 | 正/背 |
| abs | 腹直肌 | 正 |
| obliques | 腹斜肌 | 正 |
| hip-flexors | 髋屈肌 | 正 |
| quads | 股四头肌 | 正 |
| adductors | 内收肌 | 正 |
| calves | 小腿 | 背 |
| traps | 斜方肌 | 背 |
| upper-back | 上背（菱形肌/中斜方） | 背 |
| lats | 背阔肌 | 背 |
| lower-back | 下背（竖脊肌） | 背 |
| glutes | 臀大肌 | 背 |
| glute-med | 臀中肌 | 背 |
| hamstrings | 腘绳肌 | 背 |

## 3. 动作清单（24 个，id 固定）
| id | 中文 | 英文（教练表格原名） | 器械 | 视角 | 主要肌群 | 辅助肌群 |
|---|---|---|---|---|---|---|
| step-up | 登台阶 | Step Ups | 台阶/跳箱 | 侧 | quads, glutes | hamstrings, calves |
| bodyweight-squat | 徒手深蹲 | Body Weight Squats | 自重 | 侧 | quads, glutes | hamstrings, abs |
| glute-bridge | 臀桥 | Glute Bridge | 自重，仰卧 | 侧 | glutes | hamstrings, lower-back |
| band-pull-apart | 弹力带拉开 | Band Pull Apart | 弹力带 | 正 | rear-delt, upper-back | traps |
| goblet-squat | 高脚杯深蹲 | Goblet Squat | 哑铃（抱于胸前） | 侧 | quads, glutes | abs, upper-back |
| push-up | 俯卧撑 | Push Ups | 自重 | 侧 | chest, triceps | front-delt, abs |
| trx-row | TRX 划船 | TRX Row | TRX 悬挂带 | 侧 | lats, upper-back | biceps, rear-delt |
| db-rdl | 哑铃罗马尼亚硬拉 | Dumbbell Romanian Deadlift | 哑铃 ×2 | 侧 | hamstrings, glutes | lower-back, forearms |
| cable-crossover | 绳索交叉 | Dumbbell Cable Cross over | 龙门架 | 正 | chest | front-delt |
| cable-fly | 绳索夹胸 | Dumbbell Cable Fly | 龙门架 | 正 | chest | front-delt |
| half-kneeling-press | 半跪姿哑铃推举 | 1/2 Kneeling Shoulder Press | 哑铃 ×1，单跪 | 侧 | front-delt, side-delt | triceps, abs |
| farmer-carry | 农夫行走 | Farmer Carry | 哑铃 ×2 | 侧 | forearms, traps | abs, obliques |
| worlds-greatest-stretch | 世界最伟大拉伸 | Worlds Greatest Stretch | 自重 | 侧 | hip-flexors, hamstrings | obliques |
| dead-bug | 死虫式 | Dead Bug | 自重，仰卧 | 侧 | abs | hip-flexors |
| db-reverse-lunge | 哑铃反向弓步 | DB Reverse Lunge | 哑铃 ×2 | 侧 | quads, glutes | hamstrings, abs |
| db-bench-press | 哑铃卧推 | DB Bench Press | 哑铃 ×2 + 卧推凳 | 侧 | chest | triceps, front-delt |
| pallof-press | Pallof 推 | Pallof Press | 龙门架 | 正 | obliques, abs | front-delt |
| tricep-pushdown | 三头下压 | Tricep Pushdown | 龙门架 | 侧 | triceps | forearms |
| bicep-curl | 二头弯举 | Bicep Curl | 哑铃 ×2 | 侧 | biceps | forearms |
| physio-ball | 瑞士球动作 | Physio Ball Sets | 瑞士球 | 侧 | abs | lower-back, glutes |
| standing-press | 站姿哑铃推举 | Standing Shoulder Press | 哑铃 ×2 | 正 | front-delt, side-delt | triceps, abs |
| plank | 平板支撑 | Plank | 自重 | 侧 | abs | obliques, front-delt |
| weighted-step-up | 负重登台阶 | Weighted Step Up | 哑铃 ×2 + 台阶 | 侧 | quads, glutes | hamstrings, forearms |
| band-walk | 弹力带横走 | Bandwalks | 弹力带（膝上） | 正 | glute-med | quads |

“Physio Ball Sets”在教练表里含义不明，zh 用“瑞士球动作”，cue 里注明“具体动作待和教练确认”。

## 4. 数据形状

### data/exercises.json
```ts
type Exercise = {
  id: string;                       // 第 3 节表的 id
  zh: string; en: string;
  equipment: string;                // 中文，如 "哑铃 ×2"
  muscles: { primary: string[]; secondary: string[] };   // 第 2 节表的 id
  cue: string;                      // 1 到 2 句中文要点，面向新手，具体可执行
  anim: string;                     // "anim/<id>.svg"（相对 assets/）
};
// 文件是 Exercise[]，顺序按第 3 节表。
```

### data/sessions.json
```ts
type Session = {
  n: number;                        // 1…12
  date: string;                     // "2026-10-05"
  weekday: "周一" | "周五";
  status: "done" | "planned";
  title?: string;                   // 已上的课才有，如 "全身循环 A"
  blocks?: {                        // 已上的课才有
    name: string;                   // "热身" | "第一组" | "第二组" | "第三组" | "放松"
    rest?: string;                  // "1 分钟"
    items: { ex: string;            // Exercise.id
             sets: string; reps: string;   // 原文，如 "3", "10-12", "8 每侧", "30 秒"
             weight?: string;       // 原文 lb，如 "30 lb"；自重写 "自重"；未记录省略
             note?: string }[];
  }[];
};
// 文件是 Session[]，n 从 1 到 12。
```

### 12 节课的日期
1 · 2026-09-28 周一 done · 2 · 2026-10-02 周五 done · 3 · 2026-10-05 周一 done · 4 · 2026-10-09 周五 · 5 · 2026-10-12 周一 · 6 · 2026-10-16 周五 · 7 · 2026-10-19 周一 · 8 · 2026-10-23 周五 · 9 · 2026-10-26 周一 · 10 · 2026-10-30 周五 · 11 · 2026-11-02 周一 · 12 · 2026-11-06 周五。

### 已上三节课的内容（来自教练表格，重量单位 lb）
第 1 节 2026-09-28 · 全身循环 A
- 热身：step-up 3 × 8 每侧；bodyweight-squat 3 × 10；glute-bridge 3 × 10；band-pull-apart 3 × 10
- 第一组（休息 1 分钟）：goblet-squat 3 × 10-12 · 20 lb；push-up 3 × 5-10 · 自重；trx-row 3 × 10-15 · 自重
- 第二组：db-rdl 3 × 8 · 20-30 lb；cable-crossover 3 × 12 · 重量原文 "2.5"（单位不明，note 注明）；cable-fly 3 × 10 · 重量原文 "12.5"（同上）
- 第三组：half-kneeling-press 3 × 10 · 12.5 lb；farmer-carry 3 × 30 秒 · 40 lb
- 放松：无具体记录

第 2 节 2026-10-02 · 全身循环 B
- 热身：worlds-greatest-stretch 2 组；dead-bug 2 组
- 第一组：db-reverse-lunge 3 × 6 每侧；db-bench-press 3 × 10；trx-row 3 × 10 · 自重
- 第二组：pallof-press 3 × 10 每侧；tricep-pushdown 3 × 10；bicep-curl 3 × 10
- 第三组：physio-ball 3 × 10；standing-press 3 × 6 · 15 lb；plank 3 × 30 秒 · 自重
（第 2 节多数动作没记录重量，weight 省略）

第 3 节 2026-10-05 · 全身循环 A
- 热身：同第 1 节
- 第一组（休息 1 分钟）：goblet-squat 3 × 10-12 · 30 lb（note：比第 1 节加 10 lb）；push-up 3 × 10 · 自重；trx-row 3 × 10-15 · 自重
- 第二组：db-rdl 3 × 8 · 25 lb；weighted-step-up 3 × 8 · 25 lb；band-walk 3 × 15
- 第三组：half-kneeling-press 3 × 10 · 12.5 lb；farmer-carry 3 × 30 秒 · 40 lb
- 放松：无具体记录

## 5. 动画 SVG 契约（代理 B）
- 每个动作一个文件 `assets/anim/<id>.svg`，`viewBox="0 0 400 300"`，无固定 width/height，背景透明。放在 `<img>` 里也要能动，所以动画用 SMIL（`<animateTransform>` / `<animate>`），不用 CSS 动画和 JS。
- 人体：一套共用的骨架，分层 `<g>`：躯干 → 上臂 → 前臂；骨盆 → 大腿 → 小腿；头。每个关节一个旋转中心。线条圆头、粗 14 到 18 单位的“简笔火柴人加粗”风格，或者填充的简单肢体块，两者选一种并全部统一。
- 颜色（固定写死，不用 CSS 变量，因为要在 `<img>` 里工作）：人体 `#c9c3b6`，关节/轮廓 `#a39d90`，主要发力肌群 `#d9481f`，辅助肌群 `#f0a58a`，器械 `#4a4640`，地面/凳子 `#ddd5c5`。主要/辅助肌群按第 3 节表，在对应肢体段上画成色块或加粗描边。
- 动作定义写在 `data/poses.json`：每个动作 = 视角（side/front）、器械、2 到 3 个关键帧（各关节角度 + 躯干平移），周期 2 到 3 秒，往返循环，缓动 `calcMode="spline"`。`scripts/gen-anim.mjs` 读它生成全部 SVG。目标是改一个 JSON 就能加新动作。
- 侧视动作（深蹲、硬拉、卧推、俯卧撑等）用 side；正面动作（夹胸、推举、横走、弹力带拉开）用 front。仰卧/俯卧动作旋转整个人体即可。
- `contact-sheet.html` 把 24 个 SVG 排成网格，带中英文名，用来人工检查。

## 6. 肌肉图契约（代理 C）
- 一个文件 `assets/body-map.svg`，`viewBox="0 0 400 360"`，左边正面人体、右边背面人体，风格参考训记“部位概览”：浅灰轮廓、肌肉分区可单独上色。
- 每个肌肉分区是一个 `<path>` 或 `<g>`，带 `class="m" data-m="<id>"`，id 用第 2 节表；双侧肌肉（如 quads）左右各一个 path，都用同一个 data-m。正面图里放正面肌群，背面图里放背面肌群；side-delt 和 forearms 两面都放。
- 默认填充 `currentColor` 不要用；默认填充用 `var(--m-off, #e9e3d6)`，描边 `var(--m-line, #c9c3b6)`。build 会把区域加上 `class="m p"`（主要）或 `class="m s"`（辅助）；`fit.css` 定义 `.m.p { fill: var(--blue) } .m.s { fill: var(--blue-soft) }`。SVG 会被内联到页面里，所以这里可以用 CSS 变量。
- 不要写 `<style>` 在 SVG 内部。
- `body-map-preview.html`：内联这张 SVG，点一下分区就切换 p/s/off，并列出所有 data-m 以便核对。

## 7. 页面和样式契约（代理 D）
- `scripts/build.mjs`：读 `data/*.json`，写 `docs/index.md`、`docs/课程/01.md … 12.md`、`docs/动作库.md`，然后用 `execFileSync` 调用 `~/.claude/skills/html-author/scripts/build_pages.mjs --src docs --out site --title Fit101 --lang zh-CN --no-notes`。再把 `assets/` 复制到 `site/assets/`。
- Markdown 结构（课程页）：`# 第 3 节 · 全身循环 A`，一行元信息（日期、周几、教练课、动作数），然后每个 block 是 `## 第一组 · 组间休息 1 分钟`，每个动作是 `### 高脚杯深蹲 · Goblet Squat`，下面一段原样 HTML 卡片：
  ```html
  <div class="ex">
    <div class="ex-anim"><img src="../assets/anim/goblet-squat.svg" alt="高脚杯深蹲 动画"></div>
    <dl class="ex-meta">…器械 / 组 × 次 / 休息 / 重量 lb (kg) / 历次记录…</dl>
    <p class="ex-cue"><b>要点</b> …</p>
    <details class="ex-muscles"><summary>练到的肌肉</summary>
      <div class="ex-map">…内联 body-map.svg，区域加 p/s…</div>
      <p class="ex-legend">主要：股四头肌、臀大肌 · 辅助：腹直肌、上背</p>
    </details>
  </div>
  ```
  路径要按页面所在目录算相对路径（课程页在 `site/课程/`，动作库和首页在 `site/`）。
- 每个生成的 Markdown 顶部（标题之后）放一行 `<link rel="stylesheet" href="../assets/fit.css">`（相对路径按页面位置），让 marked 原样输出。先验证 html-author 不会把它吃掉；如果被吃掉，改用 `<style>` 内联整份 fit.css。
- 未上的课：`# 第 4 节 · 待上课`，元信息，一段说明“上完课后告诉 Claude 这节课的动作和重量，这一页会自动更新。”
- 动作库页：每个动作 `## 中文 · English`，同样的卡片，meta 里多两行：“出现在：第 1 节 20 lb · 第 3 节 30 lb”和“最好成绩”（从 sessions 汇总，自重动作写次数）。
- 首页 `index.md`：标题 Fit101，一段说明，12 节课的表格（节、日期、状态、动作数、链接），动作库链接。
- `fit.css`：只用 site.css 已有的变量（`--card --line --ink --ink-2 --ink-3 --accent --accent-soft --blue --blue-soft --fig-bg --r --r-sm --sunk`）。桌面卡片两栏（动画 200 px + 内容），600 px 以下单栏。动画盒背景 `var(--fig-bg)`，圆角。深色模式只靠变量，不另写颜色。`details` 的 summary 做成按钮样子。
- 完成后：跑一次 build，打开 `site/课程/03.html` 和 `site/动作库.html` 检查。如果机器上有 Google Chrome，用 `--headless --screenshot --window-size=1280,900` 和 `--window-size=390,844` 各截一张存到 `site/_check/`，自己看截图确认卡片没有溢出、动画盒显示、肌肉图能展开。
- 如果 `data/` 或 `assets/anim/`、`assets/body-map.svg` 还不存在（别的代理还在写），先用 SPEC 里的字段造 2 个动作、1 节课的临时数据放在 `data/_sample/` 下跑通，不要写 `data/exercises.json` 和 `data/sessions.json`。

## 8. 通用要求
- 全部用中文写用户可见文字；英文动作名保留教练表格原文。
- 不改 `~/.claude/skills/html-author/` 下任何文件；不改 `plan/`、`../Resources/`。
- 只写自己负责的文件；做完在最终汇报里列出写了哪些文件、怎么验证的、哪里不确定。

---

# 第二轮（2026-10-06 晚）：双语、下次训练、知识页

三件新事。契约如下，文件名和字段名以本节为准。

## 9. 双语：每页一个中文版和一个英文版，目录栏里切换

- 用 html-author 自带的配对机制：`foo.md` 是英文版，`foo.zh-CN.md` 是中文版，两者并排时目录栏自动出现“语言 EN / 中文”切换。**不要再传 `--lang zh-CN`**（传了之后默认语言变成中文，`foo.md` 会和自己配对，这是上一轮看到的空切换的原因）。`.zh-CN.md` 文件自己就会拿到中文标签。
- 生成的文件名全部改成 ASCII，目录栏显示的是页面标题，不是文件名：
  ```
  docs/index.md            docs/index.zh-CN.md          # 首页
  docs/library.md          docs/library.zh-CN.md        # 动作库
  docs/next-session.md     docs/next-session.zh-CN.md   # 下次训练
  docs/knowledge.md        docs/knowledge.zh-CN.md      # 饮食与知识（从 content/ 复制）
  docs/sessions/01.md      docs/sessions/01.zh-CN.md    # 教练课 1…12
  docs/self/01.md          docs/self/01.zh-CN.md        # 自练 1…（上完课后才有）
  ```
  `site/index.html` 是英文首页，`site/index.zh-CN.html` 是中文首页。
- 记住语言选择：build 在每页 Markdown 末尾放一小段 `<script>`：点目录栏里 `[data-lang-switch]` 时把 `fit-lang` 写进 localStorage；页面加载时如果 localStorage 的语言和本页 `<html lang>` 不同，且页面里存在 `[data-lang-switch]` 链接，就跳转过去。没有选择过时不跳转。用 try/catch 包住 localStorage。
- 数据加英文字段：
  - `Exercise`：加 `cue_en: string`、`equipment_en: string`。
  - `Session`：加 `title_en?: string`、item 加 `note_en?: string`。
  - build 里放一个词典 `labels`，两种语言各一套：UI 文字（器械、组 × 次、重量、历次记录、要点、练到的肌肉、主要、辅助、出现在、最好成绩、待上课、教练课、自练、周一…周日、第 N 节、热身/第一组/第二组/第三组/放松 → Warm-up / Block 1 / Block 2 / Block 3 / Cool-down、无具体记录、重量单位待确认 等），以及 20 个肌肉 id 的中英文名（英文：Chest, Front delt, Side delt, Rear delt, Biceps, Triceps, Forearms, Abs, Obliques, Hip flexors, Quads, Adductors, Calves, Traps, Upper back, Lats, Lower back, Glutes, Glute med, Hamstrings）。
  - reps/weight 里的中文片段按词典替换：每侧 → each side，秒 → s，未记录 → not recorded，自重 → bodyweight，分钟 → min。
- 英文页里动作标题是 `### Goblet Squat · 高脚杯深蹲`（英文在前），中文页保持 `### 高脚杯深蹲 · Goblet Squat`。

## 10. 下次训练页（next-session）

- 数据在 `data/next.json`（由 Claude 每周写，格式见下）。页面标题中文“下次训练”，英文“Next Session”。
- 页面结构：标题、一行元信息（日期、周几、时间、时长、类型“自练”）、`## 目标`、`## 为什么这样安排`（要点列表）、每个 block 一个 `##`，动作卡片和课程页相同，但 meta 多两行：`目标重量`（`target`）和 `怎么选`（`how`）；`## 放松`（纯文字）；`## 练完之后`（checklist 列表）。
- 放松、checklist 等纯文字用 `text`/`text_en` 字段。
- 练完后 Claude 把 next.json 的内容加上实际重量写进 `data/sessions.json`，`kind: "self"`，并写新的 next.json。所以 `Session` 加 `kind?: "trainer" | "self"`（缺省 trainer）；`kind: "self"` 的课 `n` 单独从 1 编号，页面放在 `docs/self/`。

```ts
type Next = {
  date: string; weekday: string; weekday_en: string;
  time: string;                      // "11:00-12:00"
  duration: string;                  // "约 55 分钟"
  duration_en: string;
  title: string; title_en: string;
  goal: string; goal_en: string;
  rationale: string[]; rationale_en: string[];
  blocks: { name: string; name_en: string; rest?: string; rest_en?: string;
            items: { ex: string; sets: string; reps: string;
                     target?: string; target_en?: string;     // 目标重量
                     how?: string; how_en?: string }[] }[];   // 怎么选重量 / 注意什么
  cooldown: { text: string; text_en: string };
  after: { items: string[]; items_en: string[] };
};
```

## 11. 知识页（knowledge）

- 内容是手写 Markdown：`content/knowledge.zh-CN.md`（中文）和 `content/knowledge.md`（英文），build 原样复制到 `docs/`。来源是 远程教练方案的 xlsx（存放在本地 Resources，不入仓库）（用 openpyxl 读）。
- 结构（`#` 标题“饮食与知识” / “Nutrition & Knowledge”，每段一个 `##`，细项 `###`）：
  1. 这份资料的来源和怎么用：远程教练在 2025 年为一个减脂案例写的；个人数字不入仓库，热量部分改成通用算法和示例。
  2. 热量与三大营养素：只讲公式（Mifflin-St Jeor、÷0.7、力训/有氧消耗、减脂 ×0.64）和维持体重的算法，用一个标注为示例的虚构人物举例；不出现本人的身高、体重、年龄。
  3. 餐序：现在是中午 11 点练，用原表“午饭前练”那一行：早饭 → 练前餐（可选，垫 20-30 g 碳水）→ 训练 → 午饭 = 练后餐（全天最大一餐，先吃碳水和蛋白质）→ 晚饭 = 其他餐。
  4. 吃什么：瘦肉清单、高脂肉清单、糖油混合物、蔬菜不限量、水果要算碳水、脂肪怎么吃（推荐模式和两种缺乏补法）。
  5. 外卖、食堂、在外就餐怎么办（问答 7、8、9、10）。
  6. 饿了怎么办、低热量零食、便携碳水（问答 14、23、24）。
  7. 体重怎么看（问答 17、18）和喝酒（问答 11）。
  8. 有氧：概况、形式、时间点、有氧置换饮食、热量消耗表的用法。
  9. 力训原则：组数、配重、力竭、间歇；三分化和四分化模板各一个简表（部位、组数、可选动作）。
  10. 附录：问答汇总 1 到 24 全文，每问一个 `###`。表格里有些问题正文是空的（如 1、5、6、15、23、24），空的就写“原表未给出正文”。
- 英文版是完整翻译，不是摘要。食物名保留中文并加英文（如 黄焖鸡 braised chicken）。
- 两个文件末尾加一行：“来源：好人松松 远程方案，2025；仅供个人使用。”

## 12. 新动作（本轮加 2 个）
| id | 中文 | 英文 | 器械 | 视角 | 主要 | 辅助 |
|---|---|---|---|---|---|---|
| incline-db-press | 上斜哑铃卧推 | Incline Dumbbell Press | 哑铃 ×2 + 上斜凳（30°） | 侧 | chest, front-delt | triceps |
| lat-pulldown | 高位下拉 | Lat Pulldown | 高位下拉机 | 正 | lats | biceps, rear-delt, upper-back |

## 13. 放松动作（第三轮，2026-10-06 晚）

放松（cool-down）也要有卡片、动图和要点。`Exercise` 加可选字段 `type?: "stretch"`（缺省是力量动作）。拉伸动作的 `reps` 写保持时间，如 "30 秒 每侧"。

| id | 中文 | 英文 | 器械 | 视角 | 主要 | 辅助 | 动作描述（教练教过前三个） |
|---|---|---|---|---|---|---|---|
| childs-pose | 婴儿式 | Child's Pose | 自重，跪姿 | 侧 | lats, lower-back | glutes | 跪坐在脚跟上，上身前趴，额头贴地，双臂向前伸直；动画是手臂缓慢前伸、臀部向脚跟下沉的呼吸起伏 |
| triceps-stretch | 过头肱三头拉伸 | Overhead Triceps Stretch | 自重，站姿 | 正 | triceps | lats | 一只手臂举过头、肘弯曲让手落在脑后，另一只手抓住肘部向内下方轻拉；动画是另一只手把肘慢慢拉过中线再放松 |
| open-book | 开书式 | Open Book | 自重，侧卧 | 俯视（top-down，人侧躺在地上） | chest, obliques | front-delt, upper-back | 侧躺，下面的腿伸直，上面的腿屈膝、膝盖贴地，双手在身前合掌；上面的手像翻书一样画弧打开到另一侧地面，头跟着转，膝盖不离地；动画是手臂 180° 弧线打开再合上 |
| doorway-pec-stretch | 门框胸部拉伸 | Doorway Pec Stretch | 门框或深蹲架立柱 | 侧 | chest, front-delt | biceps | 站在门框或立柱旁，前臂和手掌贴在立柱上、肘与肩同高，同侧脚向前迈一步，身体慢慢前倾到胸前侧有拉伸感；动画是身体向前倾再回来 |

- 这四个加到 `data/exercises.json` 末尾（代理 E），`data/poses.json` 末尾（代理 B）。
- `data/sessions.json`：第 1、3 节的“放松” block 原来 items 为空，改成这三个教练教过的动作（childs-pose、triceps-stretch、open-book），sets "1"、reps "未记录"、weight "自重"、note "教练教过的放松动作，具体节次和时长未记录"，note_en 对应。第 2 节不加。
- `data/next.json` 的 `cooldown` 改为 `{ text, text_en, rest?, rest_en?, items: [...] }`，items 和 block 的 items 同形。build（代理 D）：有 items 就按 block 渲染成 `## 放松` 加卡片，`text` 作为这段开头的一句话；没有 items 就只渲染文字（兼容旧格式）。
- 动作库页：`type: "stretch"` 的动作排在最后，前面加一个 `## 拉伸与放松` / `## Stretches & Cool-down` 的分隔标题（普通动作前面也加 `## 力量动作` / `## Strength`），卡片不变。
- 动画风格和第 5 节一致。俯视视角（open-book）：人体平躺在画面里，地面不画线，用一块浅色垫子矩形代替。
