# `test/e2e/bootstrap.cjs`：创建真实 Hydro 测试域与账号

对应源码：[test/e2e/bootstrap.cjs](../../../../test/e2e/bootstrap.cjs)

## 1. 它解决什么问题

要在真实 Hydro 上做一次端到端验证，先得有一套独立的身份：一个测试域、一个教练、一个学生。手工点界面容易残留数据，这个脚本自动创建并在 `/tmp/cf-training-e2e.json` 里保存凭据（权限 0600），供 `seed.cjs`、`browser.cjs`、`cleanup.cjs` 使用。

## 2. 它在项目中的位置

- 运行位置：**已安装本插件的 Hydro 环境**里，通过 Hydro CLI 执行（`require('hydrooj')` 提供 `UserModel`、`DomainModel`）。
- 它调用谁：Hydro 的用户与域模型；写一个本地临时文件。
- 后续链路：`bootstrap` → `seed` → `browser`（浏览器回归）→ `cleanup`（必须执行）。流程说明见 [test/e2e/README.md](../../../../test/e2e/README.md)。

## 3. 数据怎样经过它

- 生成随机后缀：域名 `cftrain-e2e-<10位hex>`，两个用户名同样带后缀；
- 密码：一次随机 48 位 hex，两个账号共用；
- 创建教练（成为域所有者）与学生（默认角色）；
- 输出 `{ domain, coachId, studentId }`，并把包含账号、密码、UID 的信息写到 `/tmp/cf-training-e2e.json`。

## 4. 源码怎么读

全文 15 行，逐行读即可。注意它**只创建**，不删除；删除在 [cleanup.cjs.md](cleanup.cjs.md)。

## 5. 怎样使用或验证

- 典型调用（容器内）是在已有 Hydro 的临时域上执行本模块；具体命令以 [test/e2e/README.md](../../../../test/e2e/README.md) 与既有流程为准。本次说明未执行。
- 校验方式：运行后文件存在、域名符合 `cftrain-e2e-*`，且 Hydro 里能看到两个用户。

## 6. 容易误解的地方

- **它不检查是否重复执行**：重复运行会创建新域（随机后缀），旧域需由 cleanup 或人工处理。
- **凭据是临时的**：文件权限 0600；不要复制到仓库或共享目录。
- **只能对测试环境执行**：它创建真实用户与域；不要在生产域上跑。

返回上一级：[`test/e2e/` 目录导航](README.md)。
