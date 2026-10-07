# `lib/core.js`：计分、资格与评分算法工具箱

对应源码：[lib/core.js](../../../lib/core.js)

## 1. 它解决什么问题

这份文件回答训练系统里最"数学"的几个问题，全部是**纯函数**（给同样的输入必得同样的输出，不读数据库、不发网络请求）：

- 用户输入的题号/比赛链接格式对不对？→ `parseProblem`、`parseContest`、`handle`、`integer`
- 一场比赛里某学生得多少分？→ `scoreRun`、`compare`、`rankRows`
- 这个学生赛前有没有接触过这些题、有没有参加过这场原赛？→ `exposure`、`prepareExposure`、`exposureFromIndex`
- 把学生放进 CF 的历史参照榜，预测他会涨跌多少分？→ `referenceEngine`
- 统计图表的分档和标签怎么算？→ `ratingHistogram`、`tagPie`
- 提交状态怎么归类？→ `classifyProblem`、`classifyVerdict`、`standardProblemKey`

因为不碰外部环境，它是整个项目里最容易读懂、最容易测试、也最常被修改的部分。

## 2. 它在项目中的位置

- 被谁调用：[index.js](../index.js.md)（参数校验）、[lib/service.js](service.js.md)（计分、资格、导入、统计）、[lib/rating-worker.js](rating-worker.js.md)（评分）、[lib/exposure.js](exposure.js.md)（证据 key）、[lib/groups.js](groups.js.md)（UID 校验）。
- 它调用谁：只用 Node 内置的 `crypto`（`createHash`）做摘要，不引用任何项目模块。
- 运行位置：服务器进程；`referenceEngine` 的一部分还会在评分工作线程里运行（见 [rating-worker.js.md](rating-worker.js.md)）。

## 3. 数据怎样经过它

### 校验和解析

| 函数 | 输入 → 输出 | 细节 |
| --- | --- | --- |
| `integer(value, min, max, name)` | 任意值 → 安全整数 | 数字、范围、整数三者都要满足，否则抛 `数值应为 a—b 的整数` |
| `handle(value)` | 字符串 → 规范化 handle | 只允许 3–24 位大小写字线、数字、`_ . -` |
| `problemKey(p)` | `{contestId, index}` → `"2000/C"` | 统一主键格式 |
| `parseProblem(value)` | `2000/C`、`2000C` 或 CF 题目链接 → `{contestId, index}` | 只接受 `codeforces.com` 域名；`attacker.test` 这类假域名会被拒绝 |
| `parseContest(value)` | 比赛 ID 或比赛链接 → 数字 ID | 范围 1–99999 |
| `digest(value)` | 任意 JSON → sha256 十六进制摘要 | 用于 `configHash`、预览 token、评分版本键 |

### 计分：`scoreRun(run, submissions, member)`

输入是"一场训练的定义"、"这名学生的全部提交记录"和"成员信息"，输出逐题得分与总分。关键规则（对比 CF 官方规则理解）：

- 只统计发生在 `[startAt, startAt + durationSeconds)` 窗口内、且提交者 handle 与绑定 handle 一致的提交（`author.members` 必须恰好一人）。
- 同一提交 ID 去重，按时间、ID 升序处理。
- `COMPILATION_ERROR` 不扣分也不计尝试（`IGNORED`）；`WRONG_ANSWER`、`TLE`、`MLE`、`RUNTIME_ERROR`、`IDLENESS_LIMIT_EXCEEDED`、`CHALLENGED`、`SECURITY_VIOLATED` 算失败提交（`WRONG`）。
- **CF 规则**：最后一次有效提交决定结果。先 AC 又交 WA，这题变 0 分；先 WA 后 AC 只算 AC 前的那次失败。得分为 `max(基础分 × 0.3, 基础分 × (1 − 用时分钟/decayMinutes) − 失败次数 × wrongPenalty)`，四舍五入到两位小数。
- **ICPC 规则**：首个 AC 后不再计分；罚时 = AC 用时分钟 + AC 前失败次数 × icpcPenalty。
- 未评测或未知状态（如 `TESTING`）不参与计算，但会让 `pending > 0`，阻止结算。
- `rankRows` 按得分降序（ICPC 再按罚时升序）排名，**同分并列**（1、1、3 的名次写法）。

示例（**自造数据**，本次实际运行输出 1090）：基础分 1500、衰减 250 分钟、失败扣 50；第 30 分钟一次 WA、第 60 分钟 AC → `max(450, 1500 × (1 − 60/250) − 50) = 1090` 分。可用下面的最小片段自己复算（在插件目录运行 `node -e "..."` 即可，不需要 Hydro）：

```js
const c = require('./lib/core');
const run = { startAt: 0, durationSeconds: 7200, rules: c.rules('CF'),
  slots: [{ index: 'A', original: { contestId: 1, index: 'A' },
            actual: { contestId: 1, index: 'A' }, points: 1500 }] };
const member = { uid: 1, handle: 'Student' };
const sub = (min, verdict) => ({ id: min, creationTimeSeconds: min * 60,
  problem: run.slots[0].actual, author: { members: [{ handle: 'Student' }] }, verdict });
console.log(c.scoreRun(run, [sub(30, 'WRONG_ANSWER'), sub(60, 'OK')], member).points); // 1090
```

### 资格判断：`exposure(...)`

输入账号状态、历史提交、个人自报和本场题目，输出：

| 字段 | 含义 |
| --- | --- |
| `status` | `clear`（未发现接触）/ `exposed`（接触过题） / `attended`（参加过原赛） / `unknown`（信息不完整，不能当作清白） |
| `touched` | 赛前有提交的题目 key 列表（任何 verdict 都算接触） |
| `accepted` | 赛前已有 AC 的题目 key |
| `attended` | 是否在 `ratingHistory` 或提交里发现参加过这场原赛 |
| `unknown` | 账号未确认、历史不完整、从未成功同步、同步失败，或上次同步距今超过 24 小时 |

`prepareExposure` / `exposureFromIndex` 是同一判断的优化版本：筛查很多场比赛时只建一次索引，避免每场重复扫全部提交。两者结果必须一致，[test/discovery-scheduler.test.js](../test/discovery-scheduler.test.js.md) 专门逐场对照验证。

### 模拟评分：`referenceEngine(reference, type)`

返回一个函数 `(student, oldRating) => 预测结果`。算法参考 CF 2015 年公开方法：把学生插入历史参照榜，按"预期排名与实际排名的几何平均"反解 rating，取一半变化，再做全体和高分组修正。细节：

- 先按得分（ICPC 再按罚时）排序参照榜，构造"期望胜场"表 `table`，用整数二分（区间 `[1, 8000]`）反解；
- 同分时，展示名次用最前位置，计算用最后位置（`ratingRank`）——这是 CF 公开算法里的取法；
- 输出里 `approximate: true` 明确标记这是模拟估计；`VERSION = 'cf-public-2015-v1'` 是算法版本，会写进结算记录。

## 4. 源码怎么读

1. 第 4–42 行：版本常量、`fail`、校验与解析函数。注意 `rules()` 对 CF/ICPC 之外的赛制直接拒绝。
2. 第 44–62 行：提交状态集合与 `classifyProblem`/`classifyVerdict`。注释解释了"OK 永久获胜，之后的失败提交不会把题降级"。
3. 第 65–99 行：Gym 识别（`contestId >= 100000` 不算标准题）、难度直方图、标签饼图。
4. 第 100–146 行：`scoreRun` 与排名。先看主循环里 `IGNORED`、`WRONG`、`pending` 的分支。
5. 第 147–189 行：三种接触判断实现。
6. 第 191–251 行：评分引擎。第一次读不必推公式，先记住输入输出和"近似"标记；想核对时对照 [test/core.test.js](../test/core.test.js.md) 里的 `oracle`（一个慢但直白的独立实现）。

## 5. 怎样使用或验证

- 可以单独运行上面的最小计分示例（只需 Node，不需要 Hydro/Mongo）。
- 完整单元测试：`node --test test/core.test.js`，覆盖解析、计分、排名、接触判断、评分算法和 CF 客户端。
- 统计相关：`node --test test/problem-stats.test.js`（直方图/标签分母）。
- 算法等价的差分验证：`node test/bench-rating.cjs` 会用"原始串行实现"和 worker 版本对比全规模结果；它是性能对照，不是正规验收，见 [test/bench-rating.cjs.md](../test/bench-rating.cjs.md)。

## 6. 容易误解的地方

- **`rules()` 里 `minimumFraction: 0.3` 是固定值**，没有配置入口；`decayMinutes`、`wrongPenalty`、`icpcPenalty` 可以由教练创建草稿时指定。
- **`VERSION` 与 `rules.version` 是两个东西**：前者是评分算法版本（影响历史重放），后者是本次训练计分规则的版本标记。修改评分算法必须保留旧版本实现，否则旧比赛评分会随升级变化。
- **`exposure` 的 `unknown` 不是"有接触"也不是"干净"**：它表示证据不足；发布计分赛前所有学生必须是已知状态，见 [index.js](../index.js.md) 的 `publish` 分支与 [lib/service.js](service.js.md) 的 `screening`。
- **`scoreRun` 不看数据库**：它接收的记录由调用方提供，所以数据库里的同步延迟、重测会直接影响结果；结算前要求重新扫描完整窗口，正是为了让这份输入值得信任（见 [test/settlement-coverage.test.js.md](../test/settlement-coverage.test.js.md)）。
- **修改这里的任何计算都要同步测试**：`core.test.js`、`problem-stats.test.js`、`discovery-scheduler.test.js`、`rating-computation.test.js` 分别锁定了计分、统计、接触索引和评分重放。

返回上一级：[`lib/` 目录导航](README.md)。
