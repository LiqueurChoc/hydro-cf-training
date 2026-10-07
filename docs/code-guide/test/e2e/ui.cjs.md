# `test/e2e/ui.cjs`：模板渲染器与学生主页综合回归

对应源码：[test/e2e/ui.cjs](../../../../test/e2e/ui.cjs)

## 1. 它解决什么问题

两个问题一起解决：

1. **提供一个"不用 Hydro 也能渲染真实模板"的工具**：`template(coach)` 读取真实的 [templates/cf_training.html](../../../../templates/cf_training.html) 和 [cf_training_app.html](../../../../templates/cf_training_app.html)，把 `{% extends %}`、`{% if cfCoach %}`、`{{ url(...) }}`、`{% include %}` 等标记替换成静态 HTML（两种角色变体都支持），替换后还会断言"没有残留模板标记"。其他浏览器回归脚本都 `require('./ui.cjs')` 拿这个函数。
2. **学生主页的综合回归**：自己作为脚本运行时，用构造的 dashboard/题目/统计响应驱动页面，检查：
   - 慢的题目列表请求不阻塞成长曲线与统计（独立加载）；
   - 快速切换题目分类时，旧的慢响应不会覆盖新结果（乱序保护）；
   - 统计图：缺档用 0 补齐成 4 根柱子、标签用文字而不是外部图片、键盘可聚焦并显示提示、Esc 关闭；
   - 1280px 与 375px 下无横向溢出；
   - 手动删除"已见过"标记；
   - Rating 计算中 / 失败 / 恢复三态：计算中不显示旧曲线、失败显示原因、恢复后重新画图；
   - 换绑后不保留旧账号的图表；未绑定时显示等待绑定文案；
   - 教练视角下后台任务文案、HTML 转义（恶意 handle 不产生 `<img>`）、班级删除与"无班级"提示。

## 2. 它在项目中的位置

- 运行位置：本机命令行 + Edge 浏览器。`require.main === module` 保护了 IIFE，所以被其他脚本 `require` 时**不会**顺带运行它的用例。
- 它调用谁：真实的两个模板文件；`playwright`；不加载 `lib/`（页面行为全部由拦截响应驱动）。
- 被谁调用：`classes.cjs`、`discovery.cjs`、`exposure.cjs`、`student-response.cjs`、`draft-lifecycle.cjs`、`run-race.cjs` 都 `require('./ui.cjs')` 取 `template`。

## 3. 数据怎样经过它

`page.route('http://fixture.test/api**', ...)` 拦截页面发出的每个接口请求，按 `action` 返回构造数据（`respond(route, result)` 统一包成 `{ok: true, result}`）。页面以为自己在和真实服务器说话；脚本因此可以精确制造"慢响应、乱序响应、失败状态"。

## 4. 源码怎么读

1. 第 9–23 行：`template()` 替换规则。理解"页面只用了这些模板结构"这句话——如果将来模板新增了模板语法，这里会因残留标记断言失败，提醒同步更新。
2. 第 25–43 行：构造数据 `account`、`dashboard()`、`stats`、`problems()`、`respond()`。
3. 第 45 行起：主流程。按顺序读 `dashboard()`/`template(false)` → 路由拦截 → 各断言段。注释直接标出每段测什么。

## 5. 怎样使用或验证

```sh
cd <插件目录>
node test/e2e/ui.cjs
```

前置：本机有 Edge；Node 能加载 `playwright`。预期输出 `PASS: template fixtures — ...`，退出码 0。本次说明**未运行**该脚本（没有浏览器环境），描述来自源码与仓库记录。

作为模块使用的最简短方式：

```js
const { template } = require('./test/e2e/ui.cjs');
const html = template(true); // 教练视角的静态页面
```

## 6. 容易误解的地方

- **`template()` 是"最简替换器"，不是完整模板引擎**：它只覆盖当前模板实际用到的语法；新增模板特性时要在这里补替换规则。
- **它渲染的是真实模板当前内容**，因此模板改动会直接影响这些用例；失败时先判断是页面 bug 还是替换器没跟上。
- **它不验证服务器权限**：所有响应都是脚本给的，权限相关逻辑在 [permissions.test.js.md](../permissions.test.js.md) 与 [release.cjs.md](release.cjs.md)。

返回上一级：[`test/e2e/` 目录导航](README.md)。
