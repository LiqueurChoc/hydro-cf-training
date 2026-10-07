# `templates/`：网页模板与浏览器脚本

这个目录决定用户**看到的页面**。三个文件都由 Hydro 的模板引擎（Nunjucks）在服务器端渲染成 HTML 后发给浏览器：

| 文件 | 说明 |
| --- | --- |
| [`cf_training.html`](../../../templates/cf_training.html) | 学生页/教练页的骨架、样式和数据入口。见 [cf_training.html.md](cf_training.html.md)。 |
| [`cf_training_app.html`](../../../templates/cf_training_app.html) | 页面上所有交互逻辑（纯浏览器 JavaScript）。见 [cf_training_app.html.md](cf_training_app.html.md)。 |
| [`cf_training_health.html`](../../../templates/cf_training_health.html) | 部署健康探测页，只用于部署脚本。见 [cf_training_health.html.md](cf_training_health.html.md)。 |

## 这个目录整体负责什么

- 页面结构：导航标签（我的训练 / 学生管理 / 选赛与组赛 / 班级管理 / Rating 记录）、表单、表格、弹窗。
- 数据获取：页面加载后调用接口拿数据，再渲染进 DOM。
- 数据展示：榜单、题目列表、统计图表、Rating 成长曲线。
- 安全边界：所有用户输入在插入页面前用 `esc()` 转义（防 XSS）。

它**不包含业务规则**：能否发布、能否结算、算多少分都由服务器决定；页面只负责把结果画出来并把用户的点击变成接口请求。

## 为什么放在一起

Hydro 的 addon 约定把 `templates/*.html` 作为模板资源。`cf_training.html` 通过 `{% include "cf_training_app.html" %}` 把脚本嵌进来，两个文件共同组成一个页面；`cf_training_health.html` 又 include 了前者，用来复用整套页面作为"部署探针"。拆成文件的原因是：骨架与脚本关注点不同，且打包/部署校验需要逐文件检查。

## 它和其他目录的关系

- 渲染数据由 [index.js](../index.js.md) 提供：`TrainingPage.get` 传入 `cfCoach`、`cfToken`、模板名；`TrainingApi.get` 返回页面脚本要找的 JSON。
- 页面调用的每个 `action` 都能在 [index.js](../index.js.md) 的 GET/POST 分发里找到同名分支，业务实现在 [lib/service.js](../lib/service.js.md)。
- 模板会被打包与部署脚本做静态编译检查，见 [scripts/deployment.cjs.md](../scripts/deployment.cjs.md)。

## 新手阅读顺序

1. [cf_training.html.md](cf_training.html.md)：先知道页面上有哪些区域、数据从哪两个变量来。
2. [cf_training_app.html.md](cf_training_app.html.md)：重点读 `api()`、`refresh()`、`openRun()`，建立"点击 → 请求 → 渲染"的闭环。
3. [cf_training_health.html.md](cf_training_health.html.md)：两分钟了解部署探针。

## 一条流程串起来

学生打开 `/cf-training` → [index.js](../index.js.md) 渲染 [cf_training.html](cf_training.html.md)（带 `cfToken`）→ 页面脚本 `guarded(refresh)` 调 `api('dashboard')` → [lib/service.js](../lib/service.js.md) 返回账号、训练列表、Rating → `renderRating` 画出曲线 → 学生点"查看" → `openRun()` 调 `api('run')` → 服务器按身份投影后返回详情 → 页面渲染题目与榜单 → 学生点"签到" → POST `attend` → 刷新状态。

返回上一级：[根目录导航](../README.md)。
