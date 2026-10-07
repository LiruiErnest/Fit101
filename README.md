# Fit101

我的健身网站。模块：课程（12 节教练课）、自练、下次训练、动作库、饮食与知识。设计方案见 `plan/课程模块-v1.packed.html`，实现契约见 `SPEC.md`。

## 打开
- 中文首页：`site/index.zh-CN.html`
- English home: `site/index.html`

电脑和手机浏览器都能看，不需要服务器。每页左侧目录栏有 EN / 中文 切换，选过一次之后其他页面会记住。

## 重新生成
```sh
cd Fit101
node scripts/build.mjs        # 或 npm run build
node scripts/check-data.mjs   # 只校验数据
node scripts/gen-anim.mjs     # 改了 data/poses.json 之后重新生成动画
```

## 上完一节课怎么记
- 教练课：告诉 Claude 这节课的动作、组数、次数、重量。Claude 会改 `data/sessions.json`（把那节课的 `status` 改成 `done`，填 `title` 和 `blocks`），如果有新动作就同时加到 `data/exercises.json` 和 `data/poses.json`，然后重新生成。
- 自练：练完把实际重量和次数告诉 Claude。Claude 把 `data/next.json` 的内容加上实际数据写进 `data/sessions.json`（`kind: "self"`），再写新的 `data/next.json` 作为下一次计划。

## 每周流程
周一、周五教练课 → 周三自练（看“下次训练”页）→ 练完汇报 → Claude 根据已练内容和身体情况写下一次的计划。

## 隐私
仓库里不放任何个人信息（身高、体重、年龄、联系方式等）。这些只保存在本地的健身档案里。训练记录、课程内容、动作库、饮食知识可以公开。

## 文件
- `data/exercises.json` 动作库（中英文名、器械、肌群、要点）
- `data/sessions.json` 12 节课
- `data/next.json` 下次自练的计划（目标重量、怎么选、为什么这样安排）
- `content/knowledge.md` / `content/knowledge.zh-CN.md` 饮食与知识页的手写内容，来自远程教练的方案
- `data/poses.json` 每个动作的姿势关键帧，`scripts/gen-anim.mjs` 用它生成 `assets/anim/*.svg`
- `assets/body-map.svg` 正面和背面肌肉图；`assets/body-map-preview.html` 可点选预览
- `assets/anim/contact-sheet.html` 24 个动画一页预览
- `assets/fit.css` 卡片样式，叠在 html-author 的 site.css 上
- `docs/`、`site/` 由脚本生成，不要手改
