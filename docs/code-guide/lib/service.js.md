# `lib/service.js`：业务总编排与数据访问

对应源码：[lib/service.js](../../../lib/service.js)

## 1. 它解决什么问题

插件所有"多步骤、要读写数据库"的操作都集中在这一个类 `TrainingService` 里：绑定账号、排队同步、分页抓取、导入比赛、发布筛查、算成绩、结算、撤销、纠正、班级榜、题目统计、后台任务调度。之所以集中而不是拆散，是因为这些步骤共享同一个"域档案"对象和同一套并发控制；拆开后很容易出现"你以为写进去了、其实被别人覆盖了"。

它也是插件业务里唯一直接读写 MongoDB 的模块：构造函数里拿到六个集合，其他 `lib` 模块只处理普通对象；唯一的例外是 [index.js](../index.js.md) 的健康探测，它会通过 `service.states` 做一次只读查询。

## 2. 它在项目中的位置

- 被谁创建：[index.js](../index.js.md) 的 `apply`（`new TrainingService(db)` 并 `await service.init()`），并挂在 `global.Hydro.model.cfTraining` 供验收脚本使用。
- 它调用谁：[lib/cf.js](cf.js.md)（网络）、[lib/core.js](core.js.md)、[lib/history.js](history.js.md)、[lib/groups.js](groups.js.md)、[lib/exposure.js](exposure.js.md)、[lib/rating.js](rating.js.md)。
- 运行位置：Hydro 服务器进程。会读写数据库、访问 CF、启动评分 worker。

## 3. 数据存在哪里

| 集合（逻辑名） | 内容 |
| --- | --- |
| `cftrain_state` | 每域一份档案：账号、班级、训练、自报、固定 Rating 起点、结算与审计。同步请求、分页位置、扫描证明也在账号记录里 |
| `cftrain_submission` | 每条提交一份文档，`_id` 为 `bindingId:提交ID`，带同步代次与尝试编号 |
| `cftrain_catalog` | 公开比赛与题库缓存，以及"当前导入快照指针"（`contest:<id>` 文档的 `snapshot` 字段） |
| `cftrain_reference` | 导入时冻结的参照榜：一条元信息 + 若干分片，按 `snapshot` 字段关联 |
| `cftrain_job` | 后台任务：`sync` / `import` / `catalog`，带状态、错误、分页请求与租约 |
| `cftrain_lock` | 多进程共享锁，保证同一时刻只有一个 Hydro 进程在跑 CF 任务 |

物理集合名会受 Hydro 的 prefix/collectionMap 影响，运维时用 [scripts/storage-manifest.cjs.md](../scripts/storage-manifest.cjs.md) 查询真实名称。

## 4. 核心机制：`change()` 与 `revision`

```js
await service.change(domainId, s => { s.accounts.push(...); });
```

- 读出最新档案 → 在副本上执行回调 → `revision + 1` → 用 `replaceOne({_id, revision})` 写回；如果期间被别人改过（匹配数为 0），重试，最多 8 次。
- 所以回调**可能执行多次**：里面不能放"发一条消息""写文件"这类不可重复的副作用；判断条件要用传入的 `s` 而不是闭包里的旧数据。
- 每次写入前检查序列化大小不超过 12 MB，超过就报"训练档案已接近存储上限"。单域最多 200 场训练、每班最多 100 人的限制分布在 `index.js` 与本文件的校验里。

## 5. 主要方法地图

按"学生的一次完整旅程"排序：

| 方法 | 做什么 | 副作用 |
| --- | --- | --- |
| `init()` | 建索引；为老数据补起点；给状态异常的账号重新排队同步 | 写数据库 |
| `state(domainId)` | 读档案；没有时返回空档案（不写库） | 无 |
| `change(domainId, apply)` | 上面的 CAS 写入 | 写数据库 |
| `bind(domainId, uid, handle, coachActor)` | 绑定/换绑：生成新 `bindingId`，旧记录作废，然后排队同步 | 写数据库 + 排队 |
| `queueSync(domainId, uid, since, {onlyIfReady})` | 创建新的同步"代次"（generation），把任务写进队列 | 写数据库 |
| `syncPage(domainId, payload)` | 执行一页同步：验证账号存在性、保存 CF rating 起点、分页写提交、推进游标、完成后写扫描证明 | 写数据库 + 访问 CF |
| `syncCatalog()` | 拉比赛列表与题库 | 写数据库 + 访问 CF |
| `importContest(contestId)` | 导入一场已结束比赛的参照榜，生成不可变快照 | 写数据库 + 访问 CF |
| `reference(id)` | 读取并缓存参照引擎（进程内最多 6 个） | 读数据库 |
| `screening(domainId, uids, contestId, problems, at)` | 发布前对一批学生做接触筛查，生成带证据的快照 | 读数据库 |
| `discover(domainId, uids, filters)` | 选赛：对题库中的比赛逐场算"未知/参赛/接触"，支持搜索、只筛干净场次、分页 | 读数据库 |
| `replacements(domainId, runId, index, tolerance)` | 找难度相近且未被这批学生接触过的替换题（最多 60 道） | 读数据库 |
| `result(domainId, runId)` | 组装榜单：计分、资格、签到、扫描完备性 | 读数据库 |
| `preview(domainId, runId)` | 试算结算并生成一次性 token | 读数据库 + 评分计算 |
| `settle(domainId, runId, token, actor)` | 重新预览、核对 token 与版本、保存冻结成绩、置为已结算 | 写数据库 |
| `correctExposure(...)` | 教练按证据 ID 纠正误报（先要求已发布、未结算） | 写数据库 |
| `cancelDraft` / `rescheduleDraft` | 草稿取消与改期（改期清掉旧筛查依据） | 写数据库 |
| `groupLeaderboard(...)` | 班级榜：共享本地 Rating + 当前绑定账号的去重 AC 数 | 读数据库 + 评分计算 |
| `studentProblems` / `studentProblemStats` | 学生题目列表与统计（按 `bindingId` 隔离，读取中换绑会报错） | 读数据库 |
| `scheduleDueSyncs(now)` | 按到期规则给账号排队：日常 6 小时一次；比赛窗口前后约 60 秒一次 | 写数据库 |
| `tick()` | 抢共享锁 → 恢复过期任务 → 调度 → 取一个任务执行（同步一页 / 题库 / 导入） | 写数据库 + 访问 CF |
| `close()` | 停止 Rating worker | 无持久化副作用 |

## 6. 三条必须理解的规则

### （1）同步代次与重试不缩窗

`syncRequest.generation` 表示"第几次请求"，`syncAttempt` 表示"这次请求的第几次执行"，`cycle` 保存分页位置。一条成功的分页写入要求数据库里的代次不超过自己，且尝试编号不超过自己——这保证**旧的慢请求、失败后的普通重试不会覆盖新数据，也不会把尚未扫完的窗口缩小**。

为什么重要：结算需要证明"赛后完整重扫了比赛窗口"。如果一次全窗口刷新失败，后续普通的"刷新历史"必须继续覆盖原范围，否则教练会以为已重扫、实际没有。[test/settlement-coverage.test.js](../test/settlement-coverage.test.js.md) 用真实 Mongo 验证了失败、空页、分页中途失败三种情况。

### （2）扫描证明（`scanProofs`）

同步成功结束时记录：绑定 `bindingId`、代次、开始/完成时间、实际扫到的下界 `coveredSince`、是否扫到历史末尾。结算校验 `coversRun`：

- 该证明属于当前绑定；
- 开始时间在**比赛结束后**（撤销后还要在撤销时间之后）；
- `coveredSince <= 开赛时间`（或读到历史末尾）。

只有满足这些，这一场才允许结算。页面上"请同步本场所有学生"就是把所有成员排成一次覆盖整个窗口的扫描。

### （3）预览 token 与结算

`preview` 会临时把本场事件放进评分输入、后台重算，然后生成 `token = sha256({event, rows, revision})`。`settle` 会**重新跑一遍预览**并核对 token，然后在 CAS 里再次核对 revision。所以：预览后同步、改资格、改练习标记、甚至只是扫描证明变化，都会让旧 token 失效，必须重新预览。这是防止"看到 A 结果，结算成 B 结果"的保护。

## 7. 源码怎么读

建议顺序（也是文件内的组织顺序）：

1. 第 10–27 行：`coversRun` 与 `retainScanProofs`。先理解"什么算有效扫描证明"。
2. 第 29–67 行：构造函数与 `init`。看六个集合和"老数据补起点"。
3. 第 68–109 行：`state` / `change` / `enqueue` / `bind`。
4. 第 140–173 行：`queueSync`。仔细读三个"取最宽窗口"的 `Math.min` 表达式，它对应上面规则（1）。
5. 第 260–343 行：`syncPage`。这是全文件最需要耐心的地方：读一页 → 写提交（带代次条件的 `bulkWrite`）→ 写档案（游标、证明、接触证据）。
6. 第 344–415 行：`importContest`（冻结参照榜）与 `screening`。
7. 第 416–506 行：`discover` / `replacements` / `result`（资格与完备性判断在 `result` 末尾）。
8. 第 528–577 行：`replay` / `preview` / `settle`。评分三件套。
9. 第 578–646 行：`scheduleDueSyncs` 与 `tick`。理解"每 3 秒只是节拍，任务实际串行"。

辅助测试会直接构造 `Object.create(TrainingService.prototype)` 并替换 `state`/`allRecords`，所以方法之间通过 `this.` 调用，便于单独替换，读代码时可以顺着 `this.xxx` 找依赖。

## 8. 怎样使用或验证

- 不能单独运行。
- 无外部服务测试（全部用替身）：`node --test test/history.test.js`、`test/groups.test.js`、`test/problem-stats.test.js`、`test/rating-computation.test.js`、`test/rating-peak.test.js`、`test/discovery-scheduler.test.js`、`test/exposure-evidence.test.js`（部分用例）。
- 真实 Mongo 临时库（会自动建随机 `cftrain_test_*` 库并在结束时删除）：

```sh
CFTRAIN_TEST_MONGO_URL=mongodb://oj-mongo:27017 node --test test/integration.test.js
```

同类命令可用于 `settlement-coverage.test.js`、`draft-lifecycle.test.js`、`permissions.test.js` 中的 Mongo 用例。环境配置见 [test/README.md](../test/README.md)。
- 未配置 `CFTRAIN_TEST_MONGO_URL` 时这些用例**明确跳过**，不是通过。

## 9. 容易误解的地方

- **`change` 回调不是事务**：它只在单个文档上原子；提交集合与档案是两次写入。代次与 attempt 校验就是为跨文档场景兜底的。
- **`result` 是"当场重算"，已结算场次除外**：`settled?.scoreSnapshot` 分支直接返回冻结快照，所以 CF 重新判题不会自动改动已结算榜单；要更新必须先撤销。
- **`discover` 只做筛查，不导入**：列表里能看到比赛不代表能创建；创建前必须 `importContest` 成功（页面会提示"请先导入本场比赛"）。
- **`replacements` 的"陌生"是相对于当前已同步证据的**：历史不完整时会返回 `unknown: true`，页面提示仍需人工核对。
- **不要绕过 `studentRunResponse` 直接返回 `result`**：那是学生的唯一字段白名单，见 [lib/student-response.js.md](student-response.js.md)。
- **改这里牵一发动全身**：先看 [test/README.md](../test/README.md) 的"改动范围 → 优先验证"对照表；结算、同步、评分相关改动至少要跑 `settlement-coverage.test.js`、`integration.test.js` 和 `permissions.test.js`。

返回上一级：[`lib/` 目录导航](README.md)。
