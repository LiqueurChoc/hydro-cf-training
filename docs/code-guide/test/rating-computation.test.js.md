# `test/rating-computation.test.js`：评分缓存、版本与工作线程

对应源码：[test/rating-computation.test.js](../../../test/rating-computation.test.js)（对应实现：[lib/rating.js](../../../lib/rating.js)、[lib/service.js](../../../lib/service.js)）

## 准备了什么场景

全部用内存替身提供参照快照（`service.refs`），实际启动真实的 worker（[lib/rating-worker.js](../../../lib/rating-worker.js)）。构造一个 100 人的参照榜和一条结算事件，然后：

| 用例 | 场景 | 检查什么 |
| --- | --- | --- |
| 冷读让出事件循环 | 在 `replay` 未完成时安排一个 `setImmediate` | 定时器能执行，说明评分不阻塞请求（这是 T03 改进的核心） |
| worker 与原始重放一致 | 缺算法字段的老事件、多个 UID、起点增删、撤销、改分数 | `service.replay` 的结果与主线程原始实现逐字段相同；`ready`；热缓存不重复读参照数据 |
| 缓存隔离 | 热读后修改返回对象 | 改返回值不影响下一次读取 |
| 同版本合并 | 两个读者同时等同一任务；期间出现新版本 | 同版本只算一次；旧任务完成不能发布成新版本；缓存启动次数等于版本数 |
| worker 失败与边界 | 把 `workerFile` 指向一个直接退出的模块 | 报"worker 退出"；失败状态可见、1 秒后可重试；队列满返回 `busy`/报错；LRU 与字节上限生效 |
| 多实例与重启 | 两个 `TrainingService` 实例；销毁后重建 | 从数据库输入重建的结果与原实例一致，不依赖本进程的失效标记 |
| 预览 token | 计算中预览、worker 执行期间档案变化 | 计算中 `token: null`；档案变化导致预览报"档案已变化" |

## 为什么值得检查

评分是最重的计算，最容易出的问题是"缓存把旧结果当成新结果"和"并发读者看到半成品"。这组用例固定了状态机：`computing` 时绝不显示旧值，旧任务绝不覆盖新版本，失败可重试，重启可重建。修改 [lib/rating.js](../../../lib/rating.js) 的缓存策略时必须全部保持通过。

## 怎样运行

```sh
cd <插件目录>
node --test test/rating-computation.test.js
```

纯本地，但会真的创建 Node 工作线程，因此比普通单测慢一些（通常在数秒内）。

## 容易误解的地方

- `service.refs` 是替身，不含真实 MongoDB 分片读取；真实读路径在 [integration.test.js.md](integration.test.js.md) 与 [settlement-coverage.test.js.md](settlement-coverage.test.js.md)。
- "让出事件循环"用例使用 `setImmediate` 而非计时器，是为了稳定复现；它不测性能，性能对照见 [bench-rating.cjs.md](bench-rating.cjs.md)。
- 缓存启动次数 `service.ratingCache.starts` 是内部计数，只在测试中观察，不属于对外接口。
- 结果里的 `version` 是评分输入的内容摘要；两个不同输入算出相同结果时版本仍不同，这是刻意的内容寻址。

返回上一级：[`test/` 目录导航](README.md)。
