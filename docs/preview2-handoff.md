# 给后续 AI 的提示词：只完成 preview.2 外部验收

请接手 `plugins/hydro-cf-training` 的 `1.0.0-preview.2`，只做候选的外部环境复验，不再做全项目设计、不加功能、不重构。

用户已决定：首轮一个真实小班、1–2 名教练；真实绑定、成绩和本地 Rating 保留，明确标记的测试数据可以清理。已授权的五项局部修复均已落地：选赛接触索引、繁忙队列到期刷新、只读计分规则、任务目标标签、模板测试等待。阅读本目录审阅报告 `reviews/1.0-preview-final-review-2026-09-26.md`、`../README.md`、`deployment-recovery.md`、`../test/e2e/README.md`，核对实际文件，不重新实现已有修改。

当前证据：Windows Node 24 + 独立 MongoDB 8.2.6 全套 88 项中 86 通过、0 失败、2 跳过；七套 Edge 构造模板 E2E 通过。两项跳过为实时 CF、Hydro 运行时；真实 Hydro HTTP 也尚未在新候选重跑。旧 rc.2 的通过记录不能充当 preview.2 本轮结果。

执行范围：

1. 核对 `dist/hydro-cf-training-1.0.0-preview.2.tar`、相邻 manifest 和 sha256，以及当前源码逐文件哈希。工作树已有修改，不得 reset、覆盖或忽略；后续若源码有变化，重新确认候选。
2. 只在获准的独立 Hydro 5.0.7 / Node 22 / MongoDB 7 环境测试。当前本机 Docker daemon 停止，原 `oj-backend`、`oj-judge`、`oj-mongo` 都配置为自动启动；不要擅自启动 daemon，避免连带启动真实服务。优先使用现成的获准测试主机；没有环境则说明缺口，不伪造验收通过。
3. 在全新解包目录上按 `test/e2e/README.md` 的 T10 独立环境流程执行。创建前确认固定测试库 `cftrain_test_t10_hydro_isolated` 未用于其他工作。运行候选安装目录中的 `node --test test/*.test.js`，设置 `CFTRAIN_TEST_MONGO_URL`、`CFTRAIN_DEPLOY_RUNTIME=1`；实时 CF 测试按文档单独运行或设置 `CFTRAIN_LIVE_TEST=1`。运行 `CFTRAIN_ISOLATED_RELEASE=1 node test/e2e/release.cjs`，验证角色/CSRF/训练生命周期/结算/撤销/重启与并发读取。
4. 沿用现有校验脚本，不绕过 namespace、容器标签和恢复检查。只对明确的隔离测试容器启动/重启，完成后执行 Cleanup，清除本轮测试凭据及临时库。不要输出凭据，不修改真实学生数据。
5. 如发现回归，只修复与这五项变更相关的确定缺陷，补最小回归。源码改变就递增 preview 版本、重打包、重核哈希，并复验新的同一个候选。没有问题则无需改代码或制造新版本。
6. 把本轮环境、命令、通过/失败/跳过及候选校验值追加到审阅报告。真实小班整场训练另填 `release-trial.md`，AI 合成测试不能替代。不自动打正式 tag、推送或部署到正式 Hydro。

交付只需说明候选能否进入小班试训、真实验收结果和剩余限制。不做推荐系统、报表、归档、在线备份平台或服务拆分。
