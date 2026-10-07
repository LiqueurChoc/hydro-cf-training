# `test/integration.test.js`：真实 MongoDB 下的并发与恢复

对应源码：[test/integration.test.js](../../../test/integration.test.js)（对应实现：[lib/service.js](../../../lib/service.js)、[lib/groups.js](../../../lib/groups.js)、[lib/rating.js](../../../lib/rating.js)）

## 准备了什么场景

**需要 `CFTRAIN_TEST_MONGO_URL`**；每个用例建随机 `cftrain_test_*` 库，`finally` 里删除。它验证"单进程替身测试测不到"的东西：多实例 CAS、数据库原子条件写入、真实租约。

| 用例 | 场景 | 检查什么 |
| --- | --- | --- |
| 旧空页/旧末页/旧失败不能清掉新请求 | 旧扫描被阻塞时发起新的全窗口请求 | 旧请求完成后，账号状态与新请求范围都不被覆盖；提交集合没有旧页写入 |
| 新旧判决的写入顺序 | 旧租约与新请求分别写同一条提交 | 新判决（OK）胜出；`from` 参数说明没有重复读页 |
| 租约恢复 | 一个实例"死"在任务中间；另一个实例接管 | 过期 `running` 任务被重新排队；分页从保存的 `cycle.since` 继续；最终 `done`、账号 `ready` |
| 并发排队与重启 | 两次 `queueSync` 竞争写同一任务；重启实例 | 最新请求（generation 2、since 1000）保留；旧 generation 的 `done` 不会掩盖新请求 |
| 多班并发成员合并与班级榜 | 两个 UID 并发加入同一批班 | 名单不丢；班级榜同分并列；换绑后题数按新绑定归零；越权与跨域被拒 |
| 评分版本随原子状态迁移 | 老结算记录缺起点 → `init()` 补 `legacy` 起点；撤销、重结算、重启 | 各实例/重启后版本与结果一致；撤销后 rating 回到起点；重结算后变化 |
| 分页与结算全链路 | 501 条提交分页（500 + 1）、失败重试、租约竞争、预览/结算/撤销 | 游标 476、评分起点取 `user.info`、绑定只能一次、换绑保留起点、已结算成绩冻结、撤销后重放顺序正确 |

## 为什么值得检查

这些场景都对应"事故型 bug"：两个教练同时点同步、服务在分页中途重启、CF 重新判题。单机替身无法暴露数据库层面的顺序问题，只有真实 Mongo 的原子操作与索引能证明修复有效。

## 怎样运行

```sh
cd <插件目录>
CFTRAIN_TEST_MONGO_URL=mongodb://oj-mongo:27017 node --test test/integration.test.js
```

**只能指向测试/开发 Mongo**。用例会在随机库名上写入并删除；脚本不会清理其他库。Hydro 容器里通常需要 `NODE_PATH`（见 [README.md](README.md)）。

## 容易误解的地方

- 文件里大量"先阻塞、再释放"的 Promise 是为了制造确定性交错，不是真实网络延迟。
- 测试期望 `ratingStatus: 'computing'` 然后手动 `replay` 等待——这反映产品行为：班级榜首次读取可能先返回"计算中"。
- 旧结算记录的 `legacy` 起点固定 1400，是迁移兼容规则；不要把它当成"新学生默认 1400"（新学生取 CF rating，未评级才有 `unrated-default` 标记）。
- 真实 CF 网络不在本文件覆盖范围；见 [live-cf.test.js.md](live-cf.test.js.md)。

返回上一级：[`test/` 目录导航](README.md)。
