# `scripts/deploy.ps1`：Windows 部署入口

对应源码：[scripts/deploy.ps1](../../../scripts/deploy.ps1)

## 1. 它解决什么问题

开发在 Windows，Hydro 跑在 WSL（Windows 里的 Linux 子系统）的 Docker 容器里。这个 PowerShell 脚本是"过河的桥"：把插件目录打包、传进容器、在容器里执行部署逻辑，并保证无论成功失败都清理临时文件。

## 2. 它在项目中的位置

- 被谁调用：运维人员（PowerShell 7）；测试环境脚本 `test/e2e/release-environment.ps1` 也会调用它。
- 它调用谁：`wsl.exe -d <发行版> -u root -e docker ...`（用 root 在 WSL 里执行 Docker 命令）、系统 `tar.exe`、容器内的 [scripts/deployment.cjs](deployment.cjs.md)。
- 运行位置：你的 Windows 终端；实际改动发生在容器内。

## 3. 参数与数据流

| 参数 | 必填 | 含义 |
| --- | --- | --- |
| `-Distribution` | 否 | WSL 发行版名，默认 `Ubuntu` |
| `-Container` | 是 | 目标 Docker 容器名；`deploy.ps1` 本身不指定，必须由操作者提供 |
| `-HealthUrl` | 否 | 健康检查地址，默认 `http://127.0.0.1:8888` |
| `-TimeoutSeconds` | 否 | 健康等待秒数（1–300，默认 60） |
| `-SourceDirectory` | 否 | 用指定目录（例如已解包的候选目录）代替当前插件根目录 |
| `-Restore` | 否 | 回退到某次部署备份的编号 |
| `-LegacyMaintenance` | 否 | 升级无兼容标记的旧包时使用；失败会保持服务停止 |

流程：校验容器名与备份编号格式 → `node package.cjs --list` 收集文件 → `tar.exe` 打包到 Windows 临时文件 → 转成 WSL 路径 → 在容器里解包到 `/tmp/cf-training-deploy-<随机>` → 执行 `node scripts/deployment.cjs /root/.hydro <候选目录> <恢复编号或-> <健康地址> <超时毫秒> <模式>` → `finally` 中删除容器内临时目录和本地临时包。

## 4. 源码怎么读

1. 第 1–9 行：参数定义。看 `$Restore` 与 `$LegacyMaintenance` 如何传给容器。
2. 第 11–17 行：输入校验与临时路径命名（每次一个随机 id，避免并发互相覆盖）。
3. 第 26–46 行：核心流程。注意 `NODE_PATH` 环境变量：容器里 Hydro 自带的模块（如 mongodb）通过它才能被 `deployment.cjs` 找到。
4. 第 47–54 行：清理。注释强调只删除本次的随机目录，恢复备份保留。

## 5. 怎样使用或验证

- 前置条件：Windows + PowerShell 7 + 可用的 WSL Ubuntu + 目标容器在运行 + 容器内有 Hydro 部署。**普通开发机上通常不具备**。
- 只读检查（本次实际验证过其一）：`node scripts/package.cjs --list` 是否成功；`Get-Content scripts/deploy.ps1` 阅读参数。真正部署属于维护操作，本次未执行。
- 正式操作步骤、备份要求与恢复命令以 [部署与恢复](../../../docs/deployment-recovery.md) 为准；不要在未获准的实例上运行。
- 相关自动化测试：`node --test test/deployment.test.js`（在临时目录验证失败回退逻辑，不碰真实容器）。

## 6. 容易误解的地方

- **它不是通用安装器**：不会安装 Hydro、不会创建容器、不会初始化数据库；它只把插件代码换进去。
- **不要手写容器名试跑**：脚本会把 `addon.json` 改掉并重启 PM2 进程；错误的容器意味着业务中断。
- **`-LegacyMaintenance` 是逃生门**：用于没有兼容标记的旧包升级；文档明确要求先做离线数据库备份与恢复演练。
- **失败信息会带备份编号**：看到"Deploy failed ... backup <编号>"时先保留现场，按恢复文档处理，不要删除备份目录。
- **脚本清理临时目录但不清理恢复备份**：备份在 `/root/.hydro/cf-training-backups/<编号>/`，由运维按容量策略处理。

返回上一级：[`scripts/` 目录导航](README.md)。
