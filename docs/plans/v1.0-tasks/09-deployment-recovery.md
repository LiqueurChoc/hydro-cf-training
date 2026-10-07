# T09 · 完善部署检查与失败回退

先读[执行约定](README.md)及 T01—T08 的兼容/恢复交接。依赖：T01—T08。

## 目标

部署在验证候选包后才替换已安装版本；启动或健康检查失败时有可执行、经过隔离演练的回退流程。

## 实施范围

检查 `scripts/deploy.ps1`、安装文档、插件打包范围，以及前序任务新增的数据字段或集合。给部署工具增加暂存校验、明确错误退出、备份标识和恢复入口。

打包覆盖运行需要的全部文件，排除凭据与本地测试产物；静态检查覆盖所有产品 JS/worker 文件及模板加载，而非只检查入口。替换避免残留旧版文件；保留原插件与 addon 配置，恢复时不会污染其他 addon。

启动检查区分 PM2 命令成功、进程存活和插件实际可用；仅验证登录跳转不足以证明插件服务/模板成功加载。设置有界等待和明确失败原因。失败恢复旧包/配置后再次检查，回退失败也必须如实报告。

数据备份按 Hydro collection prefix/map 和实际新增存储更新清单。定义代码回退与数据恢复的边界：不得在真实服务继续写入后自动用旧数据库备份覆盖新数据。不能兼容旧代码的数据变更应在部署前阻止不安全回退并说明迁移方案。

## 验收

- 在临时目录、模拟命令或独立测试容器演练：校验失败、复制失败、插件加载失败、健康超时、成功升级和失败回退。
- 验证旧插件、addon 列表和其他 addon 不受错误恢复影响，错误有非零退出码。
- 在独立数据库恢复备份，核对配置、提交、参照池、结算和前序新增数据；单纯列出命令不算恢复演练。
- 脚本默认目标清晰，测试过程不替换/重启现有正式 Hydro。若缺隔离环境，交付已验证部分并将真实恢复演练记为待外部验证。

## 交接

状态：已完成。

- 实际修改：`scripts/deploy.ps1` 改为必须显式指定容器、打印目标、按文件类型白名单打包；包含全部 worker/新增业务模块、验证源码及恢复文档，排除会话 JSON、本地产物。新增 `scripts/deployment.cjs` 实现同文件系统暂存、全部 JS/CJS/模板/内联脚本校验、构建哈希、持久化编号备份、停机切换、故障回退和 `-Restore`。备份保留完整旧包与 addon 原始字节；配置并发改动时停止恢复而不覆盖其他 addon，显式恢复保留当前其他 addon（包括重复项）及旧插件启用/禁用状态。`index.js` 与 `templates/cf_training_health.html` 增加带随机密钥的只读健康探针，检查数据库读取和实际 Hydro/学生模板渲染，返回构建标识；不接受登录跳转作为成功。PM2 命令、HTTP、等待窗口均有界；部署/恢复失败非零退出并记录原因。无业务数据字段或集合新增，无实质文件删除，既有工作树改动保留。
- 备份与文档：新增 `recovery-contract.json` 声明当前恢复 epoch 1 和六集合；`storage-manifest.cjs` 从实际 Hydro 驱动读取 prefix/map 后的命名空间；`database-backup.cjs` 离线流式导出 BSON 保真的 EJSON、索引、数量和哈希，只恢复到随机独立库并核对数据，拒绝覆盖备份及篡改文件。新增 [部署与恢复](../../deployment-recovery.md)，同步插件 README、E2E 说明和 `.gitignore`。数据库工具不替代整个 Hydro 的账号/域/文件备份；自定义 collection options 明确要求原生工具另行验证。
- 验证：检查原脚本确认其直接覆盖目标、只检查 index.js、未验证插件启动且无失败恢复。正式 `test/deployment.test.js` 覆盖暂存复制/校验失败、插件加载失败、健康超时、恢复失败、成功升级清除旧文件、显式恢复、配置并发修改、其他 addon/禁用状态保留、旧版阻断、维护失败停机、首次安装回退及 CLI 非零退出；实际运行时另验证破坏 worker 和模板会拒绝候选。`test/permissions.test.js` 验证健康密钥、无用户数据、数据库失败不伪报成功。`test/database-recovery.test.js` 在独立随机库构造六集合，包含 prefix/映射、索引、Long/ObjectId/Date/Binary、配置、提交/参照、结算/基线、同步代次/任务/证明、接触证据/纠正、取消和审计；恢复至不同随机库后逐项文档、索引一致，篡改备份拒绝，源数据未改动。
- 回归结果：本地 `node --test test/*.test.js` 共 78 项，60 通过、0 失败、18 跳过（16 Mongo、1 实时 CF、1 容器运行时静态检查）；Docker Node 22.23.2 / MongoDB 7，设置 `NODE_PATH=/usr/local/share/.config/yarn/global/node_modules`、`CFTRAIN_TEST_MONGO_URL=mongodb://oj-mongo:27017`、`CFTRAIN_DEPLOY_RUNTIME=1`，同一命令 77 通过、0 失败、1 跳过（实时 CF）。`node test/e2e/ui.cjs` 通过，`git diff --check` 通过。新增内联脚本校验曾发现模板 fixture loader 返回 null，改为 Nunjucks Loader 并断言渲染标记后全套复跑通过；不将该失败轮次算通过。
- 真实隔离演练：新建独立 `cftrain-t09-hydro` 容器（本地 `docker-oj-backend` 镜像、Hydro 5.0.7），无正式卷/端口映射，使用独立 `cftrain_test_t09_hydro_isolated` 库。实际运行 `.\scripts\deploy.ps1 -Container cftrain-t09-hydro -TimeoutSeconds 20` 完成安装和升级，验证包包含新增模块、worker、T07 测试及恢复文档，无会话/本地产物。运行 `CFTRAIN_ISOLATED_DEPLOY=1 node test/e2e/deployment.cjs`，实际 PM2/HTTP 注入插件加载失败和只在真实构建渲染时缺失健康标记，均恢复旧包/配置并验证旧构建健康；成功升级与按编号恢复也通过，缺少/错误密钥被拒绝。实际 Hydro CLI 核对 storage manifest 输出；未执行学生整场业务流程或远端 CF。
- 环境与清理：开始时 Docker daemon 未运行，启动 daemon 后既有容器按原配置恢复；没有安装候选到现有 `oj-backend` 的 addon、没有对其执行 PM2 重启或恢复正式数据。现有容器只在 `/tmp/cftrain-t09` 运行随机库测试。所有测试库在 finally 清理，独立 Hydro 容器及其完整临时库、容器/本地源码 tar 和临时源码目录已按明确路径删除；额外检查剩余 `cftrain_test_*` / `cftrain_restore_*` 为零。保留本地 `.test-output/t09-*.log` 和既有 UI 截图供复查，无临时账号凭据。
- 兼容与恢复：T01/T02/T04/T07 的旧版限制继续适用。无兼容标记的旧包默认在替换前阻断；完成维护备份/恢复验证后可显式用 `-LegacyMaintenance` 升级，失败恢复旧包但保持 Hydro 停止，必须核对新写入/数据恢复后人工恢复服务。相同 epoch 的自动/显式回退只换代码和本插件注册，不回写数据库；任何场景都不自动用旧备份覆盖升级后数据。已有业务字段保持前序默认值和重建策略，Rating 缓存不备份，最高值继续采用 T08 的 A 口径。
- 后续依赖：T10 继续使用候选状态，按恢复文档搭建独立环境，保留带密钥健康检查及所需 worker/测试打包。T09 的运行时与恢复演练不等于完整真实 Hydro 业务 HTTP、真实 CF 或大班容量验收；这些仍归 T10。没有创建 Issue、提交 commit、推送标签或发布；未执行下一任务。
