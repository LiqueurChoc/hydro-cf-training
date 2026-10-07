# `test/e2e/run-race.cjs`：快速切换训练时写操作不串场

对应源码：[test/e2e/run-race.cjs](../../../../test/e2e/run-race.cjs)

## 1. 它解决什么问题

用户在训练 A 的详情页点了"取消草稿"，但在请求还在路上时返回列表、打开了训练 B；如果页面不处理，写操作可能作用到 B（`currentRun` 被新详情覆盖）。这个脚本复现该时序，验证写操作始终绑定"用户实际看到的那场训练"。

## 2. 检查的行为

- 打开训练 A 的详情请求被故意挂起；
- 用户在 A 尚未返回时打开训练 B；
- 此时对 B 发起取消操作，页面提示操作完成后，拦截到的写请求 `id` 必须是 `B`，且只发生一次；
- 页面无 JS 错误。

## 3. 它在项目中的位置

- 与 [templates/cf_training_app.html](../../../../templates/cf_training_app.html) 的 `runSeq` / `currentRun` 机制对应：切换详情页会使旧请求失效、写操作前检查 `currentRun`。
- 使用 [ui.cjs](ui.cjs.md) 的模板渲染器；拦截 `dashboard`、`run`、`cancel_draft`。

## 4. 怎样运行

```sh
cd <插件目录>
node test/e2e/run-race.cjs
```

需要 Edge + Playwright；不连数据库。预期退出码 0。本次未运行。

## 5. 容易误解的地方

- 标题里的 "race" 指竞态时序，不是比赛（contest）。它会用延迟响应精确控制先后。
- 它只验证页面不会把写操作发给错误的训练；服务端校验发布/结算状态与权限不受影响（见 [permissions.test.js.md](../permissions.test.js.md)）。
- 修改详情页按钮的事件绑定方式时，应同时检查这个用例与 [ui.cjs.md](ui.cjs.md) 中的相关断言。

返回上一级：[`test/e2e/` 目录导航](README.md)。
