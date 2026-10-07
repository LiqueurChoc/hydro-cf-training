# `test/discovery-scheduler.test.js`：选赛索引与自动同步调度

对应源码：[test/discovery-scheduler.test.js](../../../test/discovery-scheduler.test.js)（对应实现：[lib/core.js](../../../lib/core.js)、[lib/service.js](../../../lib/service.js)）

## 准备了什么场景

这个文件分两部分。

### 1. 接触索引必须与逐场判断完全一致

`prepareExposure`/`exposureFromIndex` 是为了"一次建索引、对很多场比赛复用"而做的优化。测试用 180 条提交、6 条自报，对 7 种账号状态（正常、未绑定、未确认、历史不完整、同步失败、超过 24 小时、同步中）× 12 场比赛逐场对比"优化结果"与"直白实现 `exposure`"，要求**每一个字段、每一个顺序都一致**。

### 2. 选赛筛选与分页

构造 7 场比赛的题库：只有干净场次能被 `mode: 'clear'` 选中；搜索结果、冲突明细（unknown/attended/touched）、分页、`total` 与实际行数都要正确；学生历史只读一次（`historyReads === 1`）；有学生状态未知时"仅无接触"结果为空。

### 3. 自动同步调度（`scheduleDueSyncs` / `tick`）

用一个内存版 state 与任务队列模拟：

- 比赛窗口内的学生到期会进入队列，且**不需要等当前长任务结束**；
- 正在同步、排队中、失败、以及刚同步过的账号不会被重复重启；
- 调度扫描有节流（连续 `tick` 不会反复全表读）；
- 与手动全窗口刷新并发时，自动调度在 CAS 里复查状态后**不会**用普通请求覆盖已排队的大窗口请求。

## 为什么值得检查

- 索引优化一旦与原逻辑有偏差，就会产生"教练看到某选手没有接触、实际他做过这道题"的错误结论，后果是评分失真。
- 调度规则决定"什么时候自动抓 CF"，重复排队会浪费限速配额，漏排队会让页面的"最近同步"时间不更新。

## 怎样运行

```sh
cd <插件目录>
node --test test/discovery-scheduler.test.js
```

纯本地。第二部分用 `service.state`、`service.change`、`service.jobs`、`service.locks` 的替身，不连 Mongo。

## 容易误解的地方

- 调度测试里的时间都是相对当前时间构造的；不要改成写死的日期，否则会随时间失效。
- `tick()` 的"抢锁"在替身里直接返回成功；真实多进程竞争由 [integration.test.js.md](integration.test.js.md) 验证。
- "6 小时 / 60 秒"是到期阈值，不是精确执行间隔；真实执行还受队列与 CF 限速影响。

返回上一级：[`test/` 目录导航](README.md)。
