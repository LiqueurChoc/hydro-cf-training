# `test/bench-rating.cjs`：评分性能对照（基准脚本）

对应源码：[test/bench-rating.cjs](../../../test/bench-rating.cjs)

## 它做什么

这不是 `node --test` 套件的一部分，而是一个**手工运行的基准脚本**。它构造：

- 20,946 名参照选手的模拟参照池；
- 100 名学生 × 10 场结算的评分输入；
- 用真实的 [lib/rating.js](../../../lib/rating.js)、[lib/rating-worker.js](../../../lib/rating-worker.js) 重放，并在旁边挂一个 10 ms 定时器观察事件循环是否被长时间卡住。

输出一次 JSON：Node 版本、系统信息、参照/学生/场次规模、冷读耗时（应返回 `computing`）、后台重建耗时、热读耗时、定时器执行次数与最大间隔、worker 启动次数，以及"完整结果与原始串行实现一致"的断言。

**自造数据、只占内存**：不连接 Hydro、MongoDB 或 CF。

## 为什么值得检查

它证明"评分搬到 worker 后，网页请求不再被长计算卡住"，并给出可对照的数字。修改 [lib/rating.js](../../../lib/rating.js) 的缓存/线程策略后，重跑它可以看出冷读、重建、热读与事件循环停顿的变化。

## 怎样运行

```sh
cd <插件目录>
node test/bench-rating.cjs
```

预期：进程在数十秒内结束，退出码 0，打印一段 JSON。若 `originalReplayEqual` 为 `false` 或抛出断言错误，说明 worker 结果与原始实现不一致——这是必须修复的问题，而不是"性能差异"。

本次实际运行（2026-09-27，本机时区；WSL Linux，Node v22.18.0，i7-13620H，约 15 GiB 内存）：冷读 5.6 ms、后台重建 53.7 秒、热读 0.6 ms；重建期间 10 ms 定时器执行 5,279 次、最大间隔 16.8 ms；`workerStarts: 1`、`originalReplayEqual: true`。这是本机一次运行的记录，不是容量承诺；换机器或与仓库 README 中的历史数字（Windows/Node 24，重建约 47.4 秒）对比时应以各自环境为准。

## 容易误解的地方

- **它不是验收**：脚本自己写明"这是 service 构造基准，不是正式 Hydro HTTP 或真实大班容量验收"。仓库 README 中记录的具体数字来自历史机器环境（2026-09-24，Windows/Node 24），换机器后数字会不同。
- **不要把它写进常规测试命令**：`node --test test/*.test.js` 不会执行 `.cjs` 文件（模式是 `*.test.js`），避免日常开发被长基准拖慢。
- **它比较的是"结果一致性 + 响应特征"**，不是"算法总计算时间缩短"：worker 只是让请求线程不被占用。
- 若要复现大规模问题，注意内存占用与 CPU 时间；脚本结束时会关闭 worker。

返回上一级：[`test/` 目录导航](README.md)。
