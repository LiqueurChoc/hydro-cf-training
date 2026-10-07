# `lib/cf.js`：访问 Codeforces 公开 API

对应源码：[lib/cf.js](../../../lib/cf.js)

## 1. 它解决什么问题

插件要定期问 CF 要数据：某个 handle 是否存在、交过哪些题、参加过哪些 rated 比赛、有哪些公开比赛和题库。CF 的公开 API 是一组网址，例如 `https://codeforces.com/api/user.status?handle=xxx&from=1&count=500`，返回 JSON。

CF 有两条"礼仪"必须遵守，否则会被限流甚至封禁：**请求不能并发**、**每次请求之间要有间隔**。这个文件把这两条规则和超时、重试封装成一个小客户端 `CodeforcesClient`，业务代码只管"我要调用哪个方法"，不用自己数秒表。

## 2. 它在项目中的位置

- 被谁调用：只被 [lib/service.js](service.js.md) 使用（`syncCatalog`、`importContest`、`syncPage`）。
- 它调用谁：Node 内置的 `fetch`（发 HTTP 请求）。不引用项目其他模块。
- 运行位置：Hydro 服务器进程。没有数据库副作用，但**会访问网络**（写入 CF 的请求本身对 CF 无副作用，全是读接口）。

## 3. 数据怎样经过它

```js
const client = new CodeforcesClient();
const page = await client.call('user.status', { handle: 'tourist', from: 1, count: 500 });
```

- 输入：方法名 + 参数对象。方法必须属于白名单：`user.info`、`user.status`、`user.rating`、`contest.list`、`contest.standings`、`contest.ratingChanges`、`problemset.problems`。传其他名字直接抛 `Unsupported CF API`——这是防止业务代码误用未评估的接口。
- 处理过程（`request` 方法）：
  1. 等到 `nextAt` 时刻（距上次请求至少 `interval` 毫秒，默认 2100 ms）；
  2. 把 `nextAt` 推到 `现在 + interval`；
  3. `fetch` 请求，20 秒超时；HTTP 状态不是 200 或 JSON 的 `status !== 'OK'` 都视为失败；
  4. 失败时按 2.5 秒、5 秒退避，最多尝试 3 次；
  5. 成功时返回 JSON 的 `result` 字段（不是整个响应包）。
- 排队方式（`call` 方法）：每个调用接在上一个调用的 `then` 后面，形成一条串行链条；某个调用失败**不会**卡断后面的调用（`this.tail = task.catch(() => {})`）。
- 输出：CF 返回的 `result` 数组或对象。
- 副作用：网络请求；无数据库写入、无文件生成。

## 4. 源码怎么读

文件只有 36 行，从上到下读：

1. 构造函数第 4 行：`fetchImpl`、`pause`、`interval` 都可以在测试里替换，这就是"不联网也能测限速和重试"的入口。
2. `call`：串行链。理解 `this.tail` 是"上一个任务"即可。
3. `request`：方法白名单 → 拼 URL → 重试循环。注意 `payload.status !== 'OK'` 时把 CF 的错误说明截断到 300 字符再抛出。

## 5. 怎样使用或验证

- 不能单独运行：`node lib/cf.js` 只是定义了一个类，什么都不会发生。
- 本地验证（不联网）：[test/core.test.js](../test/core.test.js.md) 最后一个用例注入假 `fetch`，验证 `Promise.all` 发起两个调用时并发数仍为 1（真正串行），且第一次返回 `FAILED` 后会重试。
- 真实调用：需要能访问 `codeforces.com`。真实的完整链路验证在 `test/live-cf.test.js`（需 `CFTRAIN_LIVE_TEST=1` 和 Mongo，见 [test/live-cf.test.js.md](../test/live-cf.test.js.md)）。
- 想临时观察请求参数，不要修改默认 `interval`：2100 ms 是仓库记录的既有约束，调小会增加被 CF 限流的风险。

## 6. 容易误解的地方

- **它不是通用的 HTTP 工具**：只服务这 7 个 CF 读接口，不提供写操作（本插件从不向 CF 提交或修改任何东西）。
- **"串行"是全进程共享的**：同一个 `CodeforcesClient` 实例上的调用排队；`service.js` 里只创建一个客户端，因此所有同步任务共用这条队列。这也是大班级同步"实际延迟会增加"的原因。
- **重试不代表一定成功**：连续失败 3 次后抛出最后一次错误，任务被标记失败，页面显示原因；恢复靠手动重试，见 [lib/service.js.md](service.js.md) 的 `tick` 失败分支。
- **超时是 20 秒**：这与"CF 很慢"是两回事；超时后按失败重试。

返回上一级：[`lib/` 目录导航](README.md)。
