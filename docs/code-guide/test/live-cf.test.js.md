# `test/live-cf.test.js`：真实 CF API 验证（可选）

对应源码：[test/live-cf.test.js](../../../test/live-cf.test.js)

## 准备了什么场景

这是唯一会**真实访问 `codeforces.com`** 的测试。它需要两个条件同时满足，否则整体跳过：

- `CFTRAIN_LIVE_TEST=1`
- `CFTRAIN_TEST_MONGO_URL`（使用随机临时库）

执行内容：

1. `init()` 建索引后运行 `syncCatalog()`：拉取 `contest.list` 与 `problemset.problems`，断言卷宗里已结束的 CF/ICPC 比赛超过 500 场。
2. `importContest(1919)`（Hello 2024）：检查比赛类型是 CF、参照人数与 ratingChanges 一致且超过 1000、每道题都有基础分；再用参照引擎做一次预测，结果为整数。
3. 调 `user.status` 读取 `tourist` 的前两条提交，检查字段结构（id、problem、author 都在）。
4. 结束时删除临时库。

## 为什么值得检查

CF 的接口字段和限流策略是外部事实，不会永远不变。这个测试是"接口兼容性报警器"：如果 CF 改了返回结构，这里最先失败。它也能验证"导入参照榜"这条链路在真实数据上的完整性（参照人数 = rated 人数）。

## 怎样运行

```sh
cd <插件目录>
CFTRAIN_LIVE_TEST=1 CFTRAIN_TEST_MONGO_URL=mongodb://oj-mongo:27017 node --test test/live-cf.test.js
```

- 需要一个能访问 CF 的网络环境；用例超时上限 240 秒。
- 只用公开接口、只读数据；不使用任何 CF 账号凭据。
- 没有网络或未设置变量时显示 `SKIP`。

## 容易误解的地方

- **它不是常规回归**：CF 有速率限制，跑一次会占用配额；日常改动不需要跑，涉及 [lib/cf.js](../lib/cf.js.md) 或导入逻辑时再跑。
- **固定用 Hello 2024（contest 1919）**：这是历史比赛，参照数据稳定；用例断言的具体人数（>1000、等于 ratingChanges 数）是当时记录的口径，CF 补录历史可能让数字变化，届时先核实再调整。
- **测试通过仅代表公开导入链路可用**，不代表正式部署环境已验收。

返回上一级：[`test/` 目录导航](README.md)。
