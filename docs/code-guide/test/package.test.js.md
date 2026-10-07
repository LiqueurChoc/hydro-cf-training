# `test/package.test.js`：候选包清单规则

对应源码：[test/package.test.js](../../../test/package.test.js)（被测对象：[scripts/package.cjs](../../../scripts/package.cjs)）

## 准备了什么场景

只有一个用例，但规则很具体：调用 `files()` 拿到候选包清单，然后断言：

- 必须包含运行时与恢复关键文件：`lib/rating-worker.js`、`lib/exposure.js`、`lib/student-response.js`、`lib/groups.js`、`scripts/recovery-contract.json`、`scripts/database-backup.cjs`、`test/e2e/release.cjs`、`test/draft-lifecycle.test.js`；
- 不能包含 `.test-output`、`.workbuddy`、`node_modules`、`dist*`、`.deployment.json`、会话凭据 `session*.json`；
- 清单内没有重复路径。

## 为什么值得检查

打包清单是"交付范围"的唯一定义。最容易犯的错误是：新增了运行文件却忘了加进清单，或把本地凭据/生成物打进包。这个测试用少量代表文件把两类错误都挡住。

## 怎样运行

```sh
cd <插件目录>
node --test test/package.test.js
```

纯本地，不写任何文件（只读取目录）。补充手工确认：`node scripts/package.cjs --list`（本次运行输出 62 行，不包含 `docs/code-guide/`）。

## 容易误解的地方

- 它测"清单规则"，不测"tar 包内容"；真正的打包产物体积与哈希由 `pack()` 生成后人工核对。
- 不能因为测试通过就认为清单完整——它只抽查了几个代表文件；新增文件时要主动确认清单覆盖。
- `docs/` 大部分文档不进包是刻意的（避免交付包携带历史资料），见 [scripts/package.cjs.md](../scripts/package.cjs.md)。

返回上一级：[`test/` 目录导航](README.md)。
