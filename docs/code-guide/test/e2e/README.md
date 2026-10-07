# `test/e2e/`：浏览器回归与真实环境验收

这个目录的脚本分三类，用途完全不同，先分清再看文件：

| 类别 | 需要什么 | 会碰真实数据吗 | 代表 |
| --- | --- | --- | --- |
| 浏览器模板回归 | 本机 Edge + Playwright | 不会：真实模板 + 构造响应 | `ui.cjs`、`classes.cjs`、`discovery.cjs`、`exposure.cjs`、`student-response.cjs`、`draft-lifecycle.cjs`、`run-race.cjs` |
| 真实 Hydro 集成 | 已安装插件的 Hydro + 临时域/账号 | 只碰专用测试域 | `bootstrap.cjs`、`seed.cjs`、`browser.cjs`、`cleanup.cjs` |
| 独立环境验收 | 专用隔离容器/数据库 | 只碰隔离环境 | `release*.cjs`、`release-environment.ps1`、`deployment.cjs` |

**已有详细说明**：[test/e2e/README.md](../../../../test/e2e/README.md)（验收流程、隔离容器搭建命令与限制）。本页只做导航与逐文件索引。

## 为什么放在一起

浏览器回归全部依赖 [ui.cjs](ui.cjs.md) 导出的 `template()`（它把真实模板中的 Hydro 标记替换成静态 HTML），彼此共享同一套"构造数据 + 拦截接口"的写法；真实环境脚本共享 `bootstrap/seed/cleanup` 三段式生命周期。集中放置便于对照，但它们**不能互相替代**。

## 文件索引

| 文件 | 说明 |
| --- | --- |
| [`ui.cjs`](../../../../test/e2e/ui.cjs) | 共享模板渲染器 + 学生主页综合回归。见 [ui.cjs.md](ui.cjs.md)。 |
| [`classes.cjs`](../../../../test/e2e/classes.cjs) | 班级授权、转让、切班与手机布局。见 [classes.cjs.md](classes.cjs.md)。 |
| [`discovery.cjs`](../../../../test/e2e/discovery.cjs) | 选赛切班、搜索翻页、乱序保护。见 [discovery.cjs.md](discovery.cjs.md)。 |
| [`exposure.cjs`](../../../../test/e2e/exposure.cjs) | 接触证据纠正表单。见 [exposure.cjs.md](exposure.cjs.md)。 |
| [`student-response.cjs`](../../../../test/e2e/student-response.cjs) | 学生视角的赛前隐藏与赛中榜单。见 [student-response.cjs.md](student-response.cjs.md)。 |
| [`draft-lifecycle.cjs`](../../../../test/e2e/draft-lifecycle.cjs) | 草稿改期与取消按钮。见 [draft-lifecycle.cjs.md](draft-lifecycle.cjs.md)。 |
| [`run-race.cjs`](../../../../test/e2e/run-race.cjs) | 快速切换训练时写操作不串场。见 [run-race.cjs.md](run-race.cjs.md)。 |
| [`bootstrap.cjs`](../../../../test/e2e/bootstrap.cjs) | 在真实 Hydro 里创建临时域与账号。见 [bootstrap.cjs.md](bootstrap.cjs.md)。 |
| [`seed.cjs`](../../../../test/e2e/seed.cjs) | 写入合成比赛/参照/提交数据。见 [seed.cjs.md](seed.cjs.md)。 |
| [`browser.cjs`](../../../../test/e2e/browser.cjs) | 真实 Hydro 的登录、权限与全流程回归。见 [browser.cjs.md](browser.cjs.md)。 |
| [`cleanup.cjs`](../../../../test/e2e/cleanup.cjs) | 删除测试域、账号与数据。见 [cleanup.cjs.md](cleanup.cjs.md)。 |
| [`release.cjs`](../../../../test/e2e/release.cjs) | 隔离容器中的完整候选验收。见 [release.cjs.md](release.cjs.md)。 |
| [`release-fixture.cjs`](../../../../test/e2e/release-fixture.cjs) | 仅测试用的控制面板插件。见 [release-fixture.cjs.md](release-fixture.cjs.md)。 |
| [`release-environment.ps1`](../../../../test/e2e/release-environment.ps1) | 搭建/清理隔离容器。见 [release-environment.ps1.md](release-environment.ps1.md)。 |
| [`deployment.cjs`](../../../../test/e2e/deployment.cjs) | 隔离容器中的真实部署/回退演练。见 [deployment.cjs.md](deployment.cjs.md)。 |

## 一条流程串起来（浏览器回归）

`ui.cjs` 的 `template(coach)` 把 [cf_training.html](../../../../templates/cf_training.html) 的模板标记替换掉，输出普通 HTML → 各脚本用 Playwright 打开这个 HTML，并拦截 `http://*.test/api**` 返回构造 JSON → 脚本点击按钮、断言 DOM 与发出的请求 → 任何页面 JS 错误或多余的 alert 都会让脚本失败。整个过程不启动 Hydro、不连数据库、不访问 CF。

## 容易误解的地方

- **模板回归通过 ≠ 真实验收**：它证明页面逻辑与布局；权限、CSRF、真实数据库一致性只在真实 Hydro 验收（[release.cjs.md](release.cjs.md)）中验证。
- **脚本多数需要本机 Edge**：`chromium.launch({ channel: 'msedge' })`，并需要 Node 能加载 `playwright`（容器里通常靠 `NODE_PATH`）。
- **真实环境脚本有防呆检查**：`bootstrap/seed/cleanup` 要求域名为 `cftrain-e2e-*`；`release*` 要求固定隔离容器名与专用库，不会误伤正式环境。
- **不要在没有隔离环境时运行 `release-environment.ps1` 或 `release.cjs`**：它们会创建/删除容器与数据库；只在专门准备的机器上按 [test/e2e/README.md](../../../../test/e2e/README.md) 执行。

返回上一级：[`test/` 目录导航](../README.md)。
