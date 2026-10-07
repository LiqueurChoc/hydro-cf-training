# T11 · 修复最后检查问题并复验

先读[执行约定](README.md)、[T10 交接](10-release-verification.md)和[2026-09-25 最后检查](../../reviews/1.0-final-review-2026-09-25.md)。本任务处理该检查新增的 F1、F2、S1，不修改历史审查结论。

## 目标

消除完整刷新失败后的旧成绩结算风险、训练详情跨场操作错配和自定义索引恢复类型失真，并对同一份 `1.0.0-rc.2` 源码完成可重复回归。

## 实际修改

- **F1 同步重试范围：** `lib/service.js` 的 `queueSync` 在账号尚未回到 ready 时继续合并失败请求或未完 cycle 的最早 `since`，包括首个请求失败且尚无 cycle 的情况。普通“同步/刷新历史”和重启后重试都会继续扫描完整比赛窗口；完成后的新扫描证明替代旧证明。
- **F2 训练详情乱序：** `templates/cf_training_app.html` 增加 `runSeq`，加载详情时立即移除旧操作控件和 preview token，迟到响应被序号检查丢弃；离开详情也使待处理请求失效。写操作仅存在于实际渲染的训练详情中，预览、候选题和表单保存目标上下文。
- **S1 索引 BSON 保真：** `scripts/database-backup.cjs` 使用备份格式 2，把每个索引定义保存为严格 EJSON，恢复时还原 Date、Long、ObjectId 等条件。格式 1 旧备份仍可读取普通索引；含 BSON 条件的旧备份必须重新执行格式 2 备份后再恢复。
- 新增 `test/e2e/run-race.cjs`；`test/settlement-coverage.test.js` 补首请求失败、分页中失败、重启与普通重试回归；`test/database-recovery.test.js` 同时覆盖无 Mongo 的格式 2 类型保真和真实 Mongo 的 partial index。
- README、部署恢复说明、E2E 说明与 CHANGELOG 同步新行为；版本提升为 `1.0.0-rc.2`。没有改变计分算法、Rating 版本、业务集合或恢复 epoch 1。

## 验证

- Windows Node v24.19.0：`node --test test/*.test.js` 82 项，62 通过、0 失败、20 跳过（无外部服务项）。
- WSL Docker `oj-backend`、Node 22、MongoDB 7：同一全量命令设置 `CFTRAIN_TEST_MONGO_URL` 和 `CFTRAIN_DEPLOY_RUNTIME=1` 后 82 项，81 通过、0 失败、1 跳过；跳过项为单独执行的实时 CF。
- 真实 CF API：`test/live-cf.test.js` 1/1 通过，Hello 2024 导入 20,946 人参照池、9 题并完成预测。
- Edge 模板回归：`ui/classes/discovery/exposure/student-response/draft-lifecycle/run-race` 七项全部通过；新回归确认 A/B 迟到详情不会覆盖当前画面，取消请求目标为实际显示的 B 场。
- 真实临时 Mongo 回归覆盖失败首请求、分页中失败、服务重启、普通重试读取 WA、成功后窄刷新仍保留旧场证明，以及含 Date partialFilterExpression 的索引恢复一致。
- 隔离 Hydro 5.0.7 / Node 22 / MongoDB 7 对最终候选包运行 `release.cjs` 通过，覆盖角色/班级/跨域/CSRF、训练生命周期、隐私、完整同步、结算防重/撤销/重测、换绑、进程重启及 30 并发 HTTP 读取。安装目录全量测试 81 通过、1 跳过（实时 CF 另行通过）；`deployment.cjs` 的加载失败回退、模板失败回退、成功升级和显式恢复均通过。
- 临时容器源码 `/tmp/cftrain-fixes` 已删除。测试随机库由各测试 finally 清理；收尾发现一个恢复演练留下的 `cftrain_restore_*` 库，核对固定前缀和内容后删除，并删除本地 `.test-output/session.json` 测试凭据。最终不存在 `cftrain_test_*` 或 `cftrain_restore_*` 库。没有安装候选到 `oj-backend` addon、没有重启正式 Hydro 或修改真实学生数据。

## 兼容与恢复

业务数据字段和集合不变，旧账号/任务沿用既有代次与扫描证明。备份格式 2 只改变离线备份元数据编码；格式 1 旧备份仍可恢复普通索引，但不能证明自定义 BSON 索引条件未丢失，必须重新备份。回退到不保留失败请求范围、详情序号或 EJSON 索引的版本仍需配合升级前数据库备份。

## 候选交付

- 版本：`1.0.0-rc.2`。
- 包：`dist-final/hydro-cf-training-1.0.0-rc.2.tar`。
- SHA-256：`3ab8995fbd6ada543dbd3dfde1e5d894d399a28c0c6ffe8f02ca5cb3c7084f33`。
- 隔离安装构建探针：`740e4094524ad9cc405a00baeaf75c23dd955ee42470f085405dd4a31bde77b7`。
- 清单：59 个文件；包内逐文件哈希、当前源码清单和解包后内容核对一致。
- JS/CJS 语法 45 个文件、两份 PowerShell 脚本解析通过；变更文档本地链接通过。

## 后续依赖

`1.0.0-rc.2` 技术验收通过，真实小班整场试训仍待执行/记录。未取得发布授权时不设置正式 `1.0.0`、不推送标签或正式部署。没有提交 commit。
