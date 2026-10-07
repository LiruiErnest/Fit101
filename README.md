# Fit101

A personal fitness site, bilingual (EN / 中文), fully static.

- **Sessions**: every trainer session as cards, one per exercise, with an animation, equipment and weight, a key cue, and the muscles worked.
- **Next session**: the plan for the next self-training day, with target weights and why each exercise is there.
- **Exercise library**: every exercise once, with where it appeared and best results.
- **Nutrition & knowledge**: meal order, what to eat, cardio and strength-training principles, adapted from a coach's plan.

Live: https://liruiernest.github.io/Fit101/

Built from JSON and Markdown in `data/` and `content/` by `scripts/build.mjs`, which renders Markdown with [html-author](https://github.com/) and writes `site/`. Exercise animations are SVG generated from pose keyframes in `data/poses.json`. No personal data is stored in this repository.

---

个人健身网站，中英双语，纯静态。内容：教练课记录、下次训练计划、动作库（带动画和肌肉图）、饮食与训练知识。线上地址见上。仓库不含任何个人信息。
