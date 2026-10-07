# `test/`：自动化测试目录

`test/` 里的文件回答一个共同问题：**改了代码之后，怎么知道没有弄坏别的东西？** 它们按"需要什么环境"分成五档，越往下越接近真实服务。

## 五档测试（先记住这个区分）

| 档位 | 需要什么 | 代表文件 | 能证明什么 |
| --- | --- | --- | --- |
| 1. 纯逻辑/替身测试 | 只要 Node | [core.test.js](core.test.js.md)、[history.test.js](history.test.js.md) 等 | 函数算得对、权限判断正确 |
| 2. 真实 MongoDB 临时库 | Mongo 地址（会自动建随机库并删除） | [integration.test.js](integration.test.js.md)、[settlement-coverage.test.js](settlement-coverage.test.js.md) | 并发、CAS、分页、扫描证明在真实数据库上成立 |
| 3. 真实 CF API | 网络 + `CFTRAIN_LIVE_TEST=1` | [live-cf.test.js](live-cf.test.js.md) | 能从 CF 导入题库与参照榜 |
| 4. 浏览器模板回归 | 本机 Edge + Playwright | [e2e/](e2e/README.md) 下的 `ui.cjs` 等 | 页面逻辑与布局（构造数据，不连真实服务） |
| 5. 真实 Hydro 验收 | 独立 Hydro 容器 | [e2e/release.cjs](e2e/release.cjs.md)、[e2e/deployment.cjs](e2e/deployment.cjs.md) | 真实 HTTP、权限、重启、部署回退 |

**"测试通过"必须说明是哪一档。** 第 1 档全绿不等于真实环境可用；第 5 档只能在专门准备的隔离环境运行。

## 怎么运行

```sh
# 在插件目录执行
node --test test/*.test.js

# 真实 Mongo（把地址换成你环境里的 Mongo；会建 cftrain_test_* 随机库，结束后删除）
CFTRAIN_TEST_MONGO_URL=mongodb://oj-mongo:27017 node --test test/integration.test.js

# 真实 CF（需要网络，且同时设置 Mongo）
CFTRAIN_LIVE_TEST=1 CFTRAIN_TEST_MONGO_URL=mongodb://oj-mongo:27017 node --test test/live-cf.test.js

# 性能对照（构造数据，不连任何服务）
node test/bench-rating.cjs

# 浏览器模板回归（需要 Edge 与可加载的 Playwright）
node test/e2e/ui.cjs
```

未设置对应环境变量时，第 2、3 档用例会**明确跳过**（输出 `SKIP`），跳过不等于通过。Hydro 容器里通常需要 `NODE_PATH=/usr/local/share/.config/yarn/global/node_modules` 才能加载 `mongodb` 与 `playwright`。

## 本次实际运行结果

在插件目录运行 `node --test test/*.test.js`（Node v22.18.0，未配置 Mongo/CF 环境）：共 88 项测试，68 通过、0 失败、20 跳过。跳过项全部是第 2、3 档。本次**没有**运行浏览器回归与真实 Hydro 验收。

## 文件一览

| 文件 | 档位 | 覆盖主题 | 什么时候最该跑它 |
| --- | --- | --- | --- |
| [`core.test.js`](../../../test/core.test.js) | 1 | 解析、计分、排名、接触判断、评分算法、CF 客户端限速 | 改 [lib/core.js](../lib/core.js.md)、[lib/cf.js](../lib/cf.js.md) |
| [`history.test.js`](../../../test/history.test.js) | 1 | 题目聚合、分页、当前绑定隔离 | 改 [lib/history.js](../lib/history.js.md)、换绑相关逻辑 |
| [`groups.test.js`](../../../test/groups.test.js) | 1 | 班级权限、原子批量写入、班级榜 | 改 [lib/groups.js](../lib/groups.js.md)、班级榜 |
| [`problem-stats.test.js`](../../../test/problem-stats.test.js) | 1 | 题目元数据挑选、难度/标签分布、统计接口分页读取 | 改统计与图表数据 |
| [`discovery-scheduler.test.js`](../../../test/discovery-scheduler.test.js) | 1 | 接触索引与全量结果一致、选赛筛选、自动刷新调度 | 改选赛或自动同步调度 |
| [`draft-lifecycle.test.js`](../../../test/draft-lifecycle.test.js) | 2 | 草稿取消/改期、并发发布、换绑锁定 | 改草稿生命周期 |
| [`exposure-evidence.test.js`](../../../test/exposure-evidence.test.js) | 1+2 | 证据留存、旧快照兼容、误报纠正、撤销重结算 | 改 [lib/exposure.js](../lib/exposure.js.md)、资格规则 |
| [`rating-computation.test.js`](../../../test/rating-computation.test.js) | 1 | 缓存、任务合并、版本、worker 退出、预览 token | 改 [lib/rating.js](../lib/rating.js.md)、预览/结算 |
| [`rating-peak.test.js`](../../../test/rating-peak.test.js) | 1 | "有效训练历史最高"与撤销/重算口径 | 改成长曲线统计 |
| [`settlement-coverage.test.js`](../../../test/settlement-coverage.test.js) | 2 | 扫描证明、重测、失败重试不缩窗 | 改同步/结算完备性 |
| [`integration.test.js`](../../../test/integration.test.js) | 2 | 多实例租约、并发写入、分页恢复、评分联动 | 改同步代次、CAS、队列 |
| [`permissions.test.js`](../../../test/permissions.test.js) | 1 | 接口权限、CSRF、字段白名单、健康检查、班级授权 | 改 [index.js](../index.js.md) 或响应字段 |
| [`package.test.js`](../../../test/package.test.js) | 1 | 候选包清单规则 | 改 [scripts/package.cjs](../scripts/package.cjs.md) |
| [`deployment.test.js`](../../../test/deployment.test.js) | 1 | 部署失败注入与回退、恢复、旧包拒绝 | 改 [scripts/deployment.cjs](../scripts/deployment.cjs.md) |
| [`database-recovery.test.js`](../../../test/database-recovery.test.js) | 1+2 | 备份格式与 BSON 类型、六集合往返恢复 | 改备份工具或集合结构 |
| [`live-cf.test.js`](../../../test/live-cf.test.js) | 3 | 真实 CF 题库、Hello 2024 参照榜、提交结构 | 排查 CF API 兼容性 |
| [`bench-rating.cjs`](../../../test/bench-rating.cjs) | 无（基准） | 构造规模下的冷读/重建/热读耗时与事件循环停顿 | 评估评分性能 |

各文件的详细说明见同名 `.md`。测试浏览器脚本见 [e2e/README.md](e2e/README.md)。

## 改动范围 → 优先验证（实用对照）

| 改动范围 | 先跑哪些 |
| --- | --- |
| 计分、接触、历史聚合 | `core.test.js`、`history.test.js`、`problem-stats.test.js` |
| 同步、结算、并发 | `integration.test.js`、`settlement-coverage.test.js`、`discovery-scheduler.test.js`（后两者需 Mongo） |
| 权限、学生可见数据 | `permissions.test.js`、`groups.test.js`、`e2e/student-response.cjs`、`e2e/classes.cjs` |
| 资格纠正、草稿生命周期 | `exposure-evidence.test.js`、`draft-lifecycle.test.js`、`e2e/exposure.cjs`、`e2e/draft-lifecycle.cjs` |
| Rating 重算、缓存、峰值 | `rating-computation.test.js`、`rating-peak.test.js`、`bench-rating.cjs` |
| 打包、部署、恢复 | `package.test.js`、`deployment.test.js`、`database-recovery.test.js` |

## 容易误解的地方

- **测试文件不是"示例代码"**：它们会替换模块、注入假数据，直接抄进产品代码会引入测试依赖。
- **不要为了变绿而放宽断言**：特别是结算覆盖、权限白名单、字段投影这三类测试，它们对应真实发生过的问题。
- **测试会创建临时资源**：Mongo 用例建 `cftrain_test_*` 随机库并在 `finally` 里删除；浏览器回归输出到 `.test-output/`（已被 gitignore）。
- **真实环境验收不能由本地测试替代**：第 5 档才验证"真实 Hydro + 重启 + 权限撤销"，见 [e2e/README.md](e2e/README.md)。

返回上一级：[根目录导航](../README.md)。
