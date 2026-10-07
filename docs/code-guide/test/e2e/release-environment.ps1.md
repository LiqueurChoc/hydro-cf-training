# `test/e2e/release-environment.ps1`：搭建/清理隔离验收环境

对应源码：[test/e2e/release-environment.ps1](../../../../test/e2e/release-environment.ps1)

## 1. 它解决什么问题

第 5 档验收要求"与正式环境完全隔离"。这个 PowerShell 脚本负责创建/删除一个固定身份的验证容器，使验收测试有干净且可复现的宿主。

## 2. 它做什么

### `-Mode Setup`

1. 用 `docker run` 创建容器 `cftrain-t10-hydro`，带标签 `cftrain.task=t10`，接入 `docker_default` 网络，映射 `127.0.0.1:18888:8888`，镜像为本地 `docker-oj-backend`；同名容器已存在时 Docker 直接报错（不会复用或改动正式容器）；
2. 在容器内写独立配置：数据库名 `cftrain_test_t10_hydro_isolated`、`addon.json` 仅含基础 UI；
3. 启动 Hydro，并调用 [scripts/deploy.ps1](../../scripts/deploy.ps1.md) 安装候选包（`-SourceDirectory` 指向已解包目录）；
4. 通过 Hydro CLI 执行 [release-fixture.cjs](release-fixture.cjs.md) 的 `bootstrap`，要求输出 `T10_FIXTURE_OK`；
5. 把 fixture 注册为附加 addon 并重启；把生成的临时凭据复制到 `.test-output/release-session.json`（不回显密码）。

### `-Mode Cleanup`

先校验容器标签必须是 `t10`，否则拒绝；然后停止 Hydro、用独立的 Node 脚本确认配置指向隔离库后 `dropDatabase`、删除容器及卷、删除本地凭据文件。

## 3. 数据怎样经过它

- 输入：`-Mode`、`-SourceDirectory`（Setup 必填）。
- 输出：一个监听 `127.0.0.1:18888` 的隔离 Hydro + 本地凭据文件。
- 副作用：创建/删除 Docker 容器与数据库；只操作固定名称与标签的资源。

## 4. 源码怎么读

1. 第 1–13 行：参数与 Docker 封装函数。
2. 第 14–32 行：Cleanup 分支。注意标签校验与数据库名校验。
3. 第 33–63 行：Setup 分支。依次看容器创建 → 配置写入 → 部署 → fixture 注入 → 凭据复制。

## 5. 怎样使用或验证

前置：Windows + WSL Ubuntu、Docker、`docker_default` 网络、`oj-mongo` 服务、本地 `docker-oj-backend` 镜像、已解包的候选目录。命令见 [test/e2e/README.md](../../../../test/e2e/README.md)。**本次未运行**；Setup 前先确认独立库名未被其他工作占用。

## 6. 容易误解的地方

- **它不会部署到 `oj-backend`**：候选只进隔离容器，这是设计红线。
- **Cleanup 需要标签校验通过**：如果你手工改过容器标签，脚本会拒绝清理——这是保护，不是故障。
- **Setup 之后必须配对 Cleanup**：否则容器、独立库与凭据会长期残留。
- 脚本不负责跑测试；测试由 [release.cjs](release.cjs.md) 与包内单测执行。

返回上一级：[`test/e2e/` 目录导航](README.md)。
