# T05 · 收紧学生比赛响应字段

先读[执行约定](README.md)及 [T04 交接](04-exposure-evidence.md)。依赖：T04。对应 F3。

## 目标

普通学生只能收到其页面功能需要的比赛资料；其他学生的接触历史、内部身份和教练操作审计不通过 API 返回。

## 实施范围

检查 `index.js` 中 run 查询及序列化。建立学生专用字段白名单，不展开内部 run、scoreSnapshot 或其他内部对象。覆盖 T04 新增证据与纠正记录。

以真实前端需求确定白名单：必要比赛信息、开赛后实际题目、允许查看的榜单、本人必要状态。赛前仍隐藏题目；只有参赛成员可读；班级受托管理员若没有教练权限，仍按学生边界处理。教练需要的内部诊断保留在教练响应。

## 验收

- 分别检查赛前、赛中、已结算原始 JSON，不能包含其他学生 screening/history、bindingId、纠正理由/审计等内部内容。
- 学生伪造 uid、跨域参数、非成员访问和受托管理员身份均不能扩大权限。
- 学生题目、签到状态和榜单正常，教练检查与纠正功能正常。
- 回归针对对象实际序列化结果，不仅验证页面把字段隐藏。

## 交接

状态：已完成。

- 实际修改：新增 `lib/student-response.js`，由 `index.js` 的学生 run 查询统一投影赛前、赛中和已结算响应；所有嵌套对象显式选择字段，不展开内部 run、榜单或逐题结果。赛前不读取计分结果且隐藏题目，attendees 只含本人。开赛后保留实际题目、模拟说明和公开榜单，reason/completionIssues 仅在本人行返回。移除学生响应中的 screening、members、bindingId、edits、内部快照/哈希、接触证据、纠正审计、扫描证明和未签到他人明细；未来新增内部字段默认不返回。教练完整响应及纠正入口不变。README 与浏览器回归说明已同步；未删除实质文件，保留已有工作树改动，未修改课程材料。
- 数据/API 契约：无新存储字段。学生结果顶层为 `run/rows/hidden/absent`（absent 固定空）；run 为 `id/title/startAt/durationSeconds/status/rated/attendees`，开赛后增加 `slots` 及可选字符串 `warnings`。slots 仅 `index/points/actual`，actual 仅 `contestId/index/name`。rows 仅 `uid/handle/rank/points/penalty/complete/problems`，problems 仅 `index/solved/points`，本人行另含 `reason/completionIssues`。身份取当前登录 UID，不能用参数替换；受托管理员仍须是参赛成员且不能看草稿。service 读取后再次检查返回 run 的成员及草稿边界。
- 验证：先运行 `node --test --test-name-pattern='student run JSON|run membership' test/permissions.test.js`，旧代码原始 JSON 泄露 screening、edits、内部 ID 及嵌套字段，正式回归按期望失败；修复后 `node --test test/permissions.test.js` 12 项通过。完整本地 `node --test test/*.test.js`：44 通过、0 失败、14 跳过（13 Mongo、1 实时 CF）。WSL Docker `oj-backend` 使用 `NODE_PATH=/usr/local/share/.config/yarn/global/node_modules`、`CFTRAIN_TEST_MONGO_URL=mongodb://oj-mongo:27017` 执行同一套测试：57 通过、0 失败、1 跳过（实时 CF）。JSON 测试包含赛前、赛中、真实 service 已结算快照分支、额外未知字段、伪造 uid、跨域、草稿、非成员、受托管理员、本人签到和教练诊断；T04 纠正权限与业务测试保持通过。`node test/e2e/student-response.cjs`、`exposure.cjs`、`ui.cjs`、`classes.cjs` 四套真实模板构造数据回归通过。新增学生模板测试首次因误写 DOM ID 超时，修正为 `ct-run-body` 后重跑通过。入口、新模块和新增测试语法及 `git diff --check` 通过。
- 环境与清理：沿用已运行的 Docker/Hydro 环境，仅复制源码到 `oj-backend:/tmp/cftrain-t05` 运行隔离测试；未安装候选 addon、未重启 Hydro、未修改正式业务数据。Mongo 测试在 finally 删除各自随机临时库，并额外确认无 `cftrain_test_*` 库剩余；本任务容器临时源码及容器/本地 tar 包已清理。未调用远端 CF；真实 Hydro HTTP 候选验收仍待 T10，不能将本轮模板与路由构造测试等同于实际部署验收。
- 兼容与恢复：旧 run 和 scoreSnapshot 在读取时投影，不迁移或改写已有数据，不改变计分、Rating 基线、事件版本和重放顺序。旧快照缺少 completionIssues 时本人按空数组处理。回退此项代码会重新暴露内部字段，不建议回退响应边界；此前 T01—T04 的数据恢复限制继续适用。
- 后续依赖：T07 调整草稿生命周期时保持赛前隐藏、成员检查及白名单；T09/T10 打包须包含 `lib/student-response.js`，并在真实候选 HTTP 流程复查原始 JSON。其他客户端不得再依赖学生响应中的内部 run/scoreSnapshot 字段；教练契约未变。无提交 commit，未执行 T06 或其他下一任务；T10 通过前仍为候选。
