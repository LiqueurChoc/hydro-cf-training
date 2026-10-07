# T04 · 保留已发布训练的接触证据

先读[执行约定](README.md)及 T02、T03 交接。依赖：T02、T03。对应 F2。

## 目标

学生删除个人自报记录，不会抹去已发布训练保存的接触证据，也不会据此自动恢复本场 Rating 资格。

## 实施范围

检查发布检查快照、`seen/unsee`、`result` 的历史筛查和资格判定，以及 preview/settle。

结算保留发布快照中已确认的接触/参赛证据，并结合后来同步出的赛前证据。区分“已有证据”和“未知/过期”：一次 unknown 状态不能永久等同于接触过。明确发布后到开赛前新增的手工标记如何保留；学生删除再添加同一标记不能改变已经成立的本场证据。

为误报提供教练明确纠正入口，理由必填、记录操作者/时间及覆盖哪些证据；普通学生和受托班级管理员不能使用。纠正只作用于指定训练和学生，不顺带清空个人历史、签到、practice 或同步完备条件。已结算训练先撤销才能改变资格。

旧训练若有发布快照则使用已有证据；没有快照时只使用可核实记录并说明限制，不凭空制造证据。变更影响预览 token；遵循 T03 的缓存版本契约。

## 验收

- 发布前有标记，发布后删除，仍不具备 Rating 资格；公开提交证据同样保留。
- 发布后、开赛前新增再删除标记，不会清除本场已经记录的证据。
- unknown 在同步成功后可解除；不会被错误冻结为接触证据。
- 教练纠正有权限、理由及审计验证；不能顺带解除其他不合格原因。
- 预览后资格变化拒绝旧 token；撤销后重结算仍按证据/有效纠正处理。

## 交接

状态：已完成。

- 实际修改：新增 `lib/exposure.js`，统一发布证据、赛前自报/公开记录及纠正覆盖。`lib/service.js` 的发布筛查保存逐项证据，`result` 合并发布快照与当前证据；同步每页原子保留后来发现的赛前证据。`index.js` 的 seen/unsee 在同一 state 更新内留存本场证据，删除个人标记不再恢复本场资格。同一自报使用稳定事实 ID，删除再添加既不清除证据也不撤回既有纠正；unknown 不作为肯定证据冻结。新增教练专用 `correct_exposure` POST 和详情页入口，必须选择证据并填写理由；保存操作者、时间、理由、训练、学生和覆盖 ID。学生及受托管理员不可调用，已结算须先撤销；纠正不改变个人历史、签到、practice、历史完整性或扫描条件。README 与测试说明同步更新。未删除实质文件，保留所有前序任务改动；未改课程、评分算法、基线、事件版本和重放顺序。
- 数据/API 契约：`run.screening[].evidence` 为新发布快照的逐项事实；`run.exposureEvidence[uid]` 留存本场事实；`run.exposureCorrections[]` 和 `state.audit` 的 `correct_exposure` 记录 `id/uid/actor/at/reason/evidenceIds`（审计额外含 runId）。纠正仅抑制所选 ID，后续不同来源/提交 ID 的证据仍生效。API 参数 `id/uid/evidenceIds/reason`，理由为 1—500 字符，actor 取登录身份；通过 revision 条件写入避免检查后竞态。学生响应移除本任务新增的详细证据和纠正字段；既有字段的全面审查留给 T05。
- 验证：先执行 `node --test test/exposure-evidence.test.js`，在旧代码上复现发布快照有接触而 result 返回 eligible=true，修复后通过。最终本地 `node --test test/*.test.js`：42 通过、0 失败、14 跳过（13 Mongo、1 实时 CF）。在 WSL Docker `oj-backend` Node 22.23.2、独立随机 `cftrain_test_*` Mongo 库执行同一命令（`NODE_PATH=/usr/local/share/.config/yarn/global/node_modules`、`CFTRAIN_TEST_MONGO_URL=mongodb://oj-mongo:27017`）：55 通过、0 失败、1 跳过（实时 CF）。覆盖旧发布快照、自报删除/重加、发布时间后新增标记、开赛边界、公开提交/参赛、unknown 解除、无快照限制、教练/学生/受托管理员权限、必填理由和审计、不同训练隔离、并发修正拒绝、其他资格条件、旧 token、撤销重结算、同步与重新创建服务后的持久化。`node test/e2e/ui.cjs`、`node test/e2e/classes.cjs`、新增 `node test/e2e/exposure.cjs` 均通过；后者以真实模板和构造响应验证 375px 页面上的证据选择、理由必填、审计转义及已结算锁定。入口和变更模块语法、`git diff --check` 通过。中途两项新增测试的构造数据/选择器错误（非整数 CF 时间、不存在的 runs 导航）已修正并重跑通过。
- 环境与清理：最初 WSL Docker daemon 未运行；经用户明确允许连接 Docker/HydroOJ 测试后启动 daemon，原有容器按配置自动恢复运行。候选源码只复制至 `oj-backend:/tmp/cftrain-t04`，未安装到正式 addon、未执行 Hydro/PM2 重启命令、未修改正式业务数据。所有业务测试使用构造数据，Mongo 测试在 finally 删除各自临时库，并另行检查无剩余 `cftrain_test_*` 库。本任务容器源码副本及容器/本地打包文件在范围核对后清理。未调用远端 CF，未运行安装候选后的真实 Hydro HTTP 全流程；后者仍留待 T10。
- 兼容与恢复：旧快照有 attended/touched/accepted 时按其中已确认信息保留，不虚构来源；只有 unknown 时不推断接触。无快照只使用当前可核实记录，页面显示此前删除记录不可恢复。旧字段缺省为空；既有已结算 scoreSnapshot 保持冻结，撤销后按新规则处理。不增加集合、不需要批量迁移。回退会忽略本场证据及纠正，不能继续按旧版结算，应配合升级前数据库备份恢复；T01/T02 回退限制继续适用。
- 后续依赖：T05 须继续收紧学生 run 响应，保留本任务对新增敏感字段的过滤；教练界面需要 history 中 evidence/corrections/publicationMissing。T03 的评分缓存键保持不变，资格改变通过预览 event.inputs 影响评分，revision 与 rows 仍使旧 token 失效，即使评分缓存命中也不能跳过确认。T09/T10 打包须包含新增 exposure 模块。没有提交 commit，没有执行 T05 或其他下一任务。
