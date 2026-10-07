# `test/e2e/deployment.cjs`：真实 Hydro 上的部署/回退演练

对应源码：[test/e2e/deployment.cjs](../../../../test/e2e/deployment.cjs)

## 1. 它解决什么问题

[test/deployment.test.js](../deployment.test.js.md) 用假 `io` 验证部署逻辑的分支；这个脚本在**独立 Hydro 容器**里做真实演练：故意做一个加载就报错的候选、再做一个模板缺失的候选，确认部署脚本能回退到旧代码并恢复服务，最后验证正常升级与显式恢复。

## 2. 硬性防呆

源码第 10–11 行要求：

- `CFTRAIN_ISOLATED_DEPLOY=1`；
- `/root/.hydro/config.json` 的数据库名以 `cftrain_test_` 开头，且没有 `url`/`uri`。

否则直接抛错。**只能在隔离容器里运行**，绝不能在正式实例上跑（脚本会故意制造插件加载失败与重启）。

## 3. 检查的行为

1. 先健康检查当前安装；
2. 无探测密钥与错误密钥访问 `/cf-training/health` 都必须非 200，且响应不含当前构建标记；
3. **加载失败场景**：复制当前插件目录并追加 `throw`，部署应失败并回退；断言 addon 列表与 `.deployment.json` 与开始前一致，旧插件健康；
4. **模板失败场景**：让健康模板只在真实构建下缺标记，同样回退且旧版健康；
5. **正常升级与恢复**：加一个多余文件到旧目录 → 部署新候选（多余文件被清理）→ 显式 restore（多余文件回来）→ 删除临时文件；
6. 无论成败清理临时目录。

## 4. 它在项目中的位置

- 调用 [scripts/deployment.cjs](../../scripts/deployment.cjs.md) 的 `deploy` 与 `adapter`（真实 PM2 与 HTTP）。
- 与 [test/e2e/release.cjs](release.cjs.md) 并行属于第 5 档；一个验部署事务，一个验业务全流程。

## 5. 怎样使用或验证

命令示例（[test/e2e/README.md](../../../../test/e2e/README.md)）：

```sh
wsl -d Ubuntu -u root -e docker exec -e ... -e CFTRAIN_ISOLATED_DEPLOY=1 cftrain-t10-hydro \
  node /root/.hydro/addons/cf-training/test/e2e/deployment.cjs
```

前置：隔离容器已由 [release-environment.ps1](release-environment.ps1.md) 建好并安装了候选。本次说明**未运行**。

## 6. 容易误解的地方

- 它**不验证数据库恢复**：只验证代码目录切换与健康探测；数据备份见 [scripts/database-backup.cjs.md](../../scripts/database-backup.cjs.md)。
- 失败注入是刻意的：出现"部署失败"日志是预期结果，脚本最终以是否回退成功与退出码判断。
- 不要在普通开发验证里指向正式实例；`guard` 只是最后一道保险，不是许可。

返回上一级：[`test/e2e/` 目录导航](README.md)。
