# `test/e2e/browser.cjs`：真实 Hydro 浏览器全流程回归

对应源码：[test/e2e/browser.cjs](../../../../test/e2e/browser.cjs)

## 1. 它解决什么问题

在**真实 Hydro** 上把学生与教练的主要路径走一遍：登录、权限、班级、建赛、换题、发布、赛前隐藏、签到、结算、撤销。它使用 [bootstrap.cjs](bootstrap.cjs.md) + [seed.cjs](seed.cjs.md) 建立的临时域和合成数据。

## 2. 它在项目中的位置

- 运行位置：本机 Edge + 通过 HTTP 访问真实 Hydro；需要 `CFTRAIN_E2E_CONFIG`（默认 `.test-output/session.json`）与 `CFTRAIN_E2E_URL`（默认 `http://127.0.0.1`）。
- 它调用谁：浏览器页面上的真实接口；通过 `page.evaluate` 直接调 `api()`（复用页面里的 CSRF token）。
- 与自动化套件的关系：这是"真实 HTTP 但数据合成"的中间层，不能替代第 5 档独立容器验收（[release.cjs.md](release.cjs.md)）。

## 3. 检查的行为

- 教练与学生登录后分别落在 `/cf-training/coach` 与 `/cf-training/student`，学生有绑定表单、教练没有；
- 学生能读 dashboard、题目记录、统计；手动补充/删除见过的题目与比赛；
- 学生访问管理 action（如 `catalog`）返回 403，`rebind` 403，无权 export；跨域 dashboard 403；
- 教练建班、删班、切班、搜索筛选比赛、创建未来训练、换题、发布；
- 发布后学生看到 `hidden: true` 且没有题目；已发布训练不能再换题；
- 学生签到；教练预览结算得到变化；学生不能结算；教练结算成功后重复结算失败；撤销后评分回到起点；
- 全程收集页面 JS 错误并要求为空；结束时截图到 `.test-output/coach.png` 与 `student.png`。

## 4. 源码怎么读

1. 第 4–18 行：配置读取与 `login()`。注意它用真实登录请求（`context.request.post`）。
2. 第 19–22 行：`api()` 辅助函数在页面里 fetch，与页面代码同源，因此带 CSRF。
3. 第 23–39 行：`ratingReady()`：等待 `computing` 结束的轮询（构造小参照池，最多 15 秒），并断言不是 `failed`。
4. 第 40 行以后：按业务顺序的断言块。

## 5. 怎样使用或验证

前置：一个已安装当前候选代码的测试 Hydro、`bootstrap` 与 `seed` 已成功执行、本机能访问该地址、Edge 可用。命令与完整环境搭建引用 [test/e2e/README.md](../../../../test/e2e/README.md)。**本次未运行**。

## 6. 容易误解的地方

- 它需要真实 CF 吗？不需要：数据由 seed 提供，`historyComplete` 为 false 也不会阻止本流程中的操作。
- 它不能证明多进程、重启、审计等深水区；那些由 `release.cjs` 覆盖。
- 截图与配置写入 `.test-output/`，不属于交付物。
- 测试结束后必须运行 cleanup，否则残留测试域与账号。

返回上一级：[`test/e2e/` 目录导航](README.md)。
