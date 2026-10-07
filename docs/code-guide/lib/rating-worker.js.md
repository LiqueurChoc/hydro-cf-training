# `lib/rating-worker.js`：在工作线程里执行评分

对应源码：[lib/rating-worker.js](../../../lib/rating-worker.js)

## 1. 它解决什么问题

评分重放可能持续几十秒。如果在 Hydro 进程的主线程里直接算，所有网页请求都会被卡住（事件循环被占满）。工作线程（worker thread）是同一进程里的"分身"，有自己的事件循环：主线程把输入交给它，算完再收结果，网页服务不受影响。

## 2. 它在项目中的位置

- 被谁启动：[lib/rating.js](rating.js.md) 的 `RatingCache.pump()` 用 `new Worker(this.workerFile, { workerData: task.input, resourceLimits: { maxOldGenerationSizeMb: 256 } })` 启动。
- 它调用谁：[lib/rating.js](rating.js.md) 的 `replayOriginal`（算法本体）与 [lib/core.js](core.js.md) 的 `referenceEngine`（构造参照引擎）。
- 运行位置：子线程。它**不自己读数据库**：需要某个参照快照的数据时，通过消息向父线程请求（`{ type: 'reference', id }`），由父线程用 [lib/rating.js](rating.js.md) 传入的读取函数（`loadReference`）读完再发回来。

## 3. 数据怎样经过它

```
父线程                                      worker
  │ new Worker(workerData = ratingInput)      │
  │                                           │ replayOriginal(input, askReference)
  │ ◄── { type: 'reference', id } ────────────┤ 需要某快照的参照数据
  │ ── { rows, type } ───────────────────────►│ 父线程从 cftrain_reference 读取
  │                                           │ 缓存引擎：同一 id 只构造一次
  │ ◄── { type: 'result', report } ───────────┤ 成功
  │ ◄── { type: 'error', error } ─────────────┤ 失败
```

- 输入：`workerData` 即 `ratingInput(state)` 的结果（固定起点 + 有效结算事件）。
- 输出：一条 `result` 或 `error` 消息，然后线程退出。
- 副作用：无数据库写入、无文件生成、无网络请求；全部是内存计算。
- 超时、退出由父线程的 `RatingCache` 处理，见 [lib/rating.js.md](rating.js.md)。

## 4. 源码怎么读

全文 16 行，顺序读：

1. `replayOriginal(workerData, async id => {...})`：第二个参数就是"要参照数据"的回调。
2. 回调里 `if (id !== lastId)` 的缓存：同一场重放里重复用到同一快照时，不重复跨线程取数据。
3. `parentPort.once('message', resolve)` 配合 `postMessage`：发出请求后等父线程回一条消息。
4. 最后 `.then(..., ...)` 把结果或错误消息发给父线程。

## 5. 怎样使用或验证

- **不能直接运行**：`node lib/rating-worker.js` 会因为 `workerData` 为 `undefined` 而在重放时报错；它只能在 `new Worker` 里运行。
- 本地验证：`node --test test/rating-computation.test.js`（其中"worker equals the original replay"用例直接对比 worker 结果与主线程原始实现）、`node --test test/rating-peak.test.js`（真实 worker 跑撤销/重算场景）。
- 意外退出会被观察：测试里把 `workerFile` 指向一个不返回结果的模块，验证父线程报"worker 提前退出"并能重试。

## 6. 容易误解的地方

- **它不是独立服务**：没有端口、不能被外部调用；生命周期由缓存任务管理。
- **它不访问 MongoDB**：这是刻意的设计——数据访问留在主进程，worker 只做计算，减少并发写风险。
- **内存上限 256 MiB 是每个 worker 的**：超出会以 worker 错误形式体现为"Rating 计算失败"。
- **算法改动要同时改** `replayOriginal`（主线程参照实现）与 `referenceEngine`（[lib/core.js.md](core.js.md)），并跑 `bench-rating.cjs` 对比两者结果。

返回上一级：[`lib/` 目录导航](README.md)。
