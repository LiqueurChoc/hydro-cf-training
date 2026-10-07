# `test/history.test.js`：题目记录聚合与绑定隔离

对应源码：[test/history.test.js](../../../test/history.test.js)（对应实现：[lib/history.js](../../../lib/history.js)、[lib/service.js](../../../lib/service.js)）

## 准备了什么场景

自造提交记录，覆盖：

1. **同一题多次提交**：一次 WA、一次 AC、再一次 WA，应聚合为一道"已通过"的题（`solved`），提交数 3。
2. **Gym 与脏数据**：`contestId >= 100000` 的 Gym 题保留；缺少 `contestId` 的记录被忽略。
3. **分页与筛选**：`pageSize: 2` 时第一页返回两题、`pages` 为 2；第二页正确；只筛 `solved` / `attempted` 时各自的数量与内容；非法状态 `pending` 报错。
4. **只读当前绑定**：用 `Object.create(TrainingService.prototype)` 替换 `state` 与 `allRecords`，验证 `studentProblems` 只查当前 `bindingId` 的记录；没有绑定的学生返回空列表。
5. **读取期间换绑**：`allRecords` 执行时偷偷把账号换成新绑定，函数必须报"账号已更换"而不是返回旧账号数据。

## 为什么值得检查

- 页面上的"已通过 / 尝试过的题目"直接决定学生对数据的信任；聚合规则（AC 永久、其余有提交都算尝试、Gym 包含）必须稳定。
- 第 5 个场景是真实并发问题：换绑和列表加载同时发生时，服务器必须拒绝返回过期数据，否则学生会看到上一个账号的记录。

## 怎样运行

```sh
cd <插件目录>
node --test test/history.test.js
```

纯本地，无外部依赖，无副作用。

## 容易误解的地方

- 这里的"尝试过的题目"包含编译错误和未评测提交，与 [lib/core.js](../lib/core.js.md) 比赛计分里的"失败提交"不是同一概念。
- 测试直接构造 `TrainingService` 原型对象，说明 `studentProblems` 依赖 `this.state` / `this.allRecords`；修改依赖时要同步更新替身。
- 想看真实 Mongo 版本的绑定一致性，去看 [integration.test.js.md](integration.test.js.md) 与 [problem-stats.test.js.md](problem-stats.test.js.md)。

返回上一级：[`test/` 目录导航](README.md)。
