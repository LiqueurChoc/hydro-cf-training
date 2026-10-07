# 部署与恢复（1.0 候选）

1.0 技术验收与真实试训分开记录，正式发布仍须明确授权。以下命令涉及实际安装时，应在获准维护的环境执行；自动化演练只使用独立容器和构造数据。

## 可追溯候选包

在插件根目录运行 `node scripts/package.cjs dist`，生成版本命名的 tar、`.manifest.json` 和 `.sha256`。清单记录每个文件的字节数与 SHA-256，来源明确为当前未提交工作树；相同文件名不覆盖已有包。`scripts/package.cjs --list` 与部署脚本共用白名单，包含运行模块、worker、测试、恢复与试训文档，排除凭据及生成文件。

收到包后先核对整个 tar 哈希，解包到新的空目录，再逐项核对清单中的文件哈希；不要在已有插件目录解包。以该目录运行部署，可确保安装已验收内容：

```powershell
.\scripts\deploy.ps1 -Container <获准的容器名> -SourceDirectory <已核验的解包目录>
```

构建探针的 build 是部署工具对文件内容生成的标识，与整个 tar 的 SHA-256 不同，二者都应记录。源码版号、内容或包内文档发生变化时须重打包并重新核对、安装验证实际候选。测试结果与包哈希保存在仓库 T10 交接及独立验收记录中，避免把包自身哈希写进包内造成循环。

## 安装与兼容升级

Windows **PowerShell 7**、WSL Ubuntu、运行中的目标 Docker 容器；容器内需要 Node >=22、Hydro 5.x、PM2 中名为 `hydrooj` 的进程及 Hydro 自带的 Nunjucks/MongoDB 驱动。脚本不自动启动 Docker。容器必须显式指定，开始时显示目标、持久化插件路径和健康 URL。

```powershell
.\scripts\deploy.ps1 -Distribution Ubuntu -Container <获准的容器名>
```

健康 URL 默认为**容器内** `http://127.0.0.1:8888`，可用 `-HealthUrl` 调整 origin；不是 Windows 的反向代理端口。`-TimeoutSeconds` 默认 60、范围 1—300。单次 HTTP 最多 3 秒，PM2 命令最多 30 秒，因此最后一次检查可能比等待窗口多至约 34 秒；命令、启动与恢复都有有限等待。

打包包含入口、全部 lib（含 rating worker）、模板、语言包、部署工具和验证源码；不含 `.test-output`、`.workbuddy`、`node_modules`、会话 JSON、数据库备份及本地输出。测试源码随包保留，T07/T10 可继续使用。候选先复制到同一持久化目录下的唯一暂存目录，检查所有 JS/CJS 语法、模板编译/加载、两种角色渲染及内联脚本语法，再碰已安装目录。静态检查用 Hydro 外层布局替身；启动后的 HTTP 检查使用真正的 Hydro 布局。

安装前生成 `/root/.hydro/cf-training-backups/<备份编号>/`：

- `plugin/`：旧版完整目录副本，包含版本标识；`addon.json`：原始配置字节。
- `backup.json`：旧版是否存在、兼容性、候选构建哈希；`result.json`：成功、已回退或恢复失败及原因。
- `previous/`：切换时移出的旧目录；失败时将其移回；`failed-candidate/` 保留失败候选。

脚本停止 Hydro 后再切换目录，避免旧文件残留。只向 addon 数组添加本插件路径，不调用会重写其他项的 addon 命令。异常恢复原始配置前先检查它未被其他工具改动；遇到并发修改保留现场并停机报错。部署锁阻止脚本并发；异常断电留下锁时，先确认无部署进程、核对现场及备份，再手动移除空 `deployment.lock` 目录，不要直接重试覆盖现场。

PM2 restart 返回成功只是第一步。随后检查所有同名进程 online、有 PID；带本次随机密钥请求 `/cf-training/health`，验证数据库读取、插件已 apply、真正学生模板及包含模板渲染成功、返回的构建哈希正确。302 登录跳转不算通过。健康响应只有空页面外壳与构建标记，不含用户数据；缺失/错误密钥被拒绝。密钥保存在权限 0600 的 `.deployment.json`，不打印到日志。

兼容候选失败时自动停止失败进程，恢复旧目录和配置，再启动并检查**旧版本**标识；仍以非零退出码报告本次部署失败。回退也失败则报告 `recovery failed`，不得把旧代码已复制等同于服务恢复。首次安装失败恢复无插件状态，只检查基础 Hydro HTTP 和进程，并明确此时不存在旧插件。

## 按编号恢复代码

```powershell
.\scripts\deploy.ps1 -Container <获准的容器名> -Restore <备份编号>
```

恢复也经过暂存校验、备份当前版本、启动与健康检查；恢复过程失败仍可回到操作前版本。保留当前 addon 中后来添加的其他插件，不盲目覆盖历史 addon 配置。此入口只接受相同 `recovery-contract.json` epoch（当前为 1）、含旧插件的备份；首次安装及无兼容标记的旧版备份不能用这个入口直接启用。

epoch 表示已审查的数据/业务恢复边界，不是 package 版本号。以后若改变数据语义而旧代码不能安全使用，必须改 epoch、补迁移和恢复方案，不能为了让脚本通过手动给旧包添加标记。旧版可能恢复学生字段泄露、同步竞争或错误结算，即使 Mongo 能读其字段也不算安全兼容。

## 首次从 T09 之前版本升级

旧包无兼容标记，普通部署会在停止/替换前拒绝升级。T01/T02 的代次和覆盖证明、T04 的证据/纠正以及 T07 的 cancelled 状态均不能交给不理解它们的旧代码继续处理。

先关闭外部流量及所有写入进程，记录实际集合映射，做离线备份并在独立库验证恢复；保留升级前源码/配置。完成这些维护准备后才运行：

```powershell
.\scripts\deploy.ps1 -Container <获准的容器名> -LegacyMaintenance
```

此参数明确接受维护停机流程，**不是数据库恢复或安全回退声明**。成功后复核候选再开放流量；失败恢复旧代码/配置，但保持 Hydro 停止并非零退出。优先修复候选前进恢复。如果决定退回旧版，先保存升级后的数据库以保留可能发生的初始化/后台写入，在独立库核对升级前备份与新增数据，再由操作者批准离线恢复。脚本永不自动用旧数据库覆盖当前数据。

## 数据清单与离线备份

页面 JSON 导出不是完整备份。插件目前仍只有六个集合；T03 Rating cache/worker 为进程内状态，重启后重建，不要当作权威备份。

| 逻辑集合 | 必须保留的数据 |
| --- | --- |
| `cftrain_state` | 班级归属/授权、绑定、syncGeneration/syncRequest/syncAttempt/cycle、scanProofs、训练及取消/改期、screening.evidence、exposureEvidence/exposureCorrections、audit、ratingBaselines、ledger/event inputs/scoreSnapshot |
| `cftrain_submission` | 全部公开提交及 verdict、绑定/代次/尝试编号 |
| `cftrain_catalog` | 比赛、题库与同步元数据 |
| `cftrain_reference` | 冻结参照池及 snapshot ID，重放不可缺失 |
| `cftrain_job` | 队列、分页任务、代次及租约 |
| `cftrain_lock` | worker 锁；恢复后按既有租约超时接管 |

**不要猜集合名。** Hydro 5.0.7 先应用 `prefix + '.' + logical`，再应用 `collectionMap`。在停止 Hydro 前，通过 Hydro CLI 读取驱动实际解析的命名空间并保存为 JSON；命令不会输出连接凭据：

```sh
hydrooj cli execute "return require('/root/.hydro/addons/cf-training/scripts/storage-manifest.cjs')();"
```

旧插件还没有工具时，可把候选源码放到临时目录并从那里 require。CLI 自身会初始化 Hydro/插件，必须在备份停写之前运行。从返回结果保存纯 JSON 为 `/secure/cftrain-storage.json`（不要将 CLI 日志混入）。JSON 包含 `database` 和逻辑名到物理名的 `collections` 映射。

停掉所有共享此数据库的 Hydro 实例、后台任务、CLI 写入者；仅停止一个 PM2 实例不保证多机环境无写入。以下工具是**离线**流式 EJSON 备份，不声称提供在线一致性快照：

```sh
export NODE_PATH=/usr/local/share/.config/yarn/global/node_modules
# 通过安全环境注入 CFTRAIN_BACKUP_MONGO_URL，不写入仓库、日志或命令历史。
node /candidate/scripts/database-backup.cjs backup /secure/cftrain-before /secure/cftrain-storage.json --writers-stopped
node /candidate/scripts/database-backup.cjs restore-isolated /secure/cftrain-before
```

目录必须不存在；备份包含六集合文档、索引、空/不存在集合状态、实际映射、数量与 SHA-256。格式 2 将索引定义逐项保存为严格 EJSON，和文档一样保留 Date、Long、ObjectId、Binary 等 BSON 类型。格式 1 的旧备份仍可恢复其中的普通索引，但其 JSON 索引元数据可能已经丢失 BSON 类型；含自定义 BSON 条件的索引必须重新执行格式 2 备份后恢复。仅在完整导出后写 `backup.json`；不完整目录不能恢复。带自定义 collection options 的部署会明确拒绝，应使用 MongoDB 原生备份工具并针对选项另行演练。

恢复工具先校验备份，再创建随机 `cftrain_restore_*` 库，导入后逐集合核对文档哈希/数量；出错只删除本次创建的库。不允许指定原库覆盖。成功打印新库名，由操作者复核配置、提交、参照池、结算和新增字段；演练结束后只删除这个已核对名称的临时库。权限/账号/域属于 Hydro 本身，插件备份不替代整个 Hydro 数据库、存储文件及配置备份；旧代码对应的旧数据备份才有业务恢复意义。

需要实际离线恢复到原数据库时，先备份当前状态并复核新增写入；将**已核验的独立恢复库**用 `mongodump --db <独立库> --out <新目录>` 导出，再用原生 `mongorestore --nsInclude '<独立库>.*' --nsFrom '<独立库>.*' --nsTo '<原库>.*' --drop <新目录>` 导入六个物理集合。仅在明确授权的数据恢复窗口执行，核对真实数据库/映射，原备份中不存在的集合须另行核对清除，不能遗留新旧混合状态。不得对 Hydro 全库使用 drop。其他 Hydro 集合保持不变，账号/域引用仍须一致；完成数据及旧包兼容核对后才能启动。备份和独立库含个人数据，应保存到受控位置并按保留策略处理。

## 验证入口与限制

`node --test test/deployment.test.js test/database-recovery.test.js test/permissions.test.js`：临时目录故障注入、健康权限、映射/BSON/索引/篡改备份恢复。设置 `CFTRAIN_DEPLOY_RUNTIME=1` 才运行真实运行时静态校验，设置 `CFTRAIN_TEST_MONGO_URL` 才连接随机测试库；缺环境明确跳过。

`CFTRAIN_ISOLATED_DEPLOY=1 node test/e2e/deployment.cjs`：仅可在新建独立容器执行，脚本要求 Hydro `config.name` 为 `cftrain_test_*` 且无 URI 覆盖。会重启该容器的 Hydro 并注入加载/模板失败，核对旧版健康回退、成功升级和显式恢复。操作前仍必须确认容器及数据库确实独立，该前缀检查不是创建隔离环境的替代品。

T10 使用同一候选复验上述恢复路径，并补真实 Hydro HTTP、真实 CF、构造负载验证；具体命令见 [E2E 说明](../test/e2e/README.md)，结果以 T10 交接为准。本工具不发版、不推标签、不自动执行下一任务。
