# `test/e2e/seed.cjs`：写入合成比赛数据

对应源码：[test/e2e/seed.cjs](../../../../test/e2e/seed.cjs)

## 1. 它解决什么问题

真实 CF 数据依赖网络且不可控，浏览器回归需要确定性的数据：一场已发布的比赛、一道题、一个参照榜、一个学生和两条提交。这个脚本把这些写进**临时测试域**，并给出一条可以直接同步的假 CF 客户端。

## 2. 它在项目中的位置

- 必须在 [bootstrap.cjs](bootstrap.cjs.md) 之后运行（读取 `/tmp/cf-training-e2e.json` 的域名与账号）。
- 直接使用插件的 [lib/service.js](../../../../lib/service.js) 与 [lib/core.js](../../../../lib/core.js)，写成和真实部署一致的数据结构。
- 之后由 [browser.cjs](browser.cjs.md) 通过页面验证，最后由 [cleanup.cjs](cleanup.cjs.md) 删除。

## 3. 数据怎样经过它

1. 安全校验：域名必须匹配 `cftrain-e2e-[a-f0-9]+`，否则拒绝；
2. 删除该域旧档案、任务、该绑定的提交、旧参照快照，以及带 `AUTOMATED TEST FIXTURE` 名字的目录条目；
3. 写入合成参照快照（三人：1800/1400/1000 分）与题库条目：原题 `99001/A`、替换题 `99002/A`（比赛名都标 `AUTOMATED TEST FIXTURE`）；
4. 写入域档案：固定起点 1600、学生账号（`approved/verified`，但 `historyComplete: false`）、一场 5 小时前已发布的比赛（已签到）；
5. 替换 `svc.client` 为假 CF：`user.rating` 返回空、`user.status` 返回两条合成提交（AC 与编译错误）；
6. 调一次 `syncPage`，把两条提交按"覆盖开赛时间"的方式写入并生成扫描证明。

## 4. 源码怎么读

按执行顺序读；重点看第 8 行的域名断言（防误伤）与最后 `syncPage` 的参数 `since: run.startAt / 1000`（为浏览器回归准备可结算状态）。

## 5. 怎样使用或验证

- 前置：已完成 bootstrap；Hydro 容器内可加载插件模块。命令形式见 [test/e2e/README.md](../../../../test/e2e/README.md)。本次未执行。
- 返回 `{ seeded: true, domain }`；浏览器脚本随后登录该域。

## 6. 容易误解的地方

- 它**不是**真实训练数据生成器：所有名字带 `AUTOMATED TEST FIXTURE`，只允许在隔离测试域使用。
- 重复执行会先清掉本域旧数据，因此不能用于保留证据的场景。
- 假 CF 客户端只在本次进程内存在；其他进程访问网络仍会真的请求 CF（测试域不应触发这些路径）。

返回上一级：[`test/e2e/` 目录导航](README.md)。
