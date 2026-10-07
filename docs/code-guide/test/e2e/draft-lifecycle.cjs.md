# `test/e2e/draft-lifecycle.cjs`：草稿改期与取消的页面行为

对应源码：[test/e2e/draft-lifecycle.cjs](../../../../test/e2e/draft-lifecycle.cjs)

## 1. 它解决什么问题

一个已过开赛时间的草稿在页面上应该怎样呈现？规则是"不能发布，只能改期或取消"。这个脚本在 375px 手机上渲染真实模板，用构造的过期草稿检查按钮与提示，防止页面出现"还能点发布"的漏洞。

## 2. 检查的行为

- 过期草稿不显示"锁定题目并发布"按钮，提示先改期；
- 改期表单提交 `reschedule_draft`，携带新的本机时间（脚本记录请求体断言 action 顺序：先改期、后取消）；
- 取消后：改期表单与"同步本场"按钮消失，训练列表显示"已取消"；
- 页面无 JS 错误。

## 3. 它在项目中的位置

- 使用 [ui.cjs](ui.cjs.md) 的模板渲染器；拦截 `dashboard`、`run`、`reschedule_draft`、`cancel_draft` 并即时更新内存里的 run 状态。
- 与实现对应：页面侧 [cf_training_app.html](../../../../templates/cf_training_app.html) 的 `openRun` 分支与 `ct-reschedule-draft` 表单；服务端 [lib/service.js](../../../../lib/service.js) 的 `rescheduleDraft` / `cancelDraft`（真实规则与并发在 [test/draft-lifecycle.test.js.md](../draft-lifecycle.test.js.md) 用 Mongo 验证）。

## 4. 怎样运行

```sh
cd <插件目录>
node test/e2e/draft-lifecycle.cjs
```

需要 Edge + Playwright；不连数据库。预期退出码 0。本次未运行。

## 5. 容易误解的地方

- 它只验证"页面按钮与请求"，不验证服务端规则：能不能取消、改期后是否清筛查依据，由 Mongo 测试保障。
- 用例中的"过期"是构造的 `Date.now() - 86400000`，不依赖系统时区外的东西。
- 时间格式化在页面上用本机时区，脚本按 `datetime-local` 的约定断言。

返回上一级：[`test/e2e/` 目录导航](README.md)。
