# `scripts/package.cjs`：生成候选包

对应源码：[scripts/package.cjs](../../../scripts/package.cjs)

## 1. 它解决什么问题

把插件交付给目标环境时，不能直接把整个工作目录打进去：里面可能有 `dist/`、`.test-output/`、本地凭据、`node_modules`。这个脚本维护一份**显式允许清单**，按清单生成 `.tar` 包、逐文件清单和整个包的 SHA-256 校验值。交付方与接收方各自核对同一份哈希，就能确认包没被改动。

## 2. 它在项目中的位置

- 被谁调用：人在命令行运行；[scripts/deploy.ps1](deploy.ps1.md) 用 `--list` 模式取同一份清单；[test/package.test.js](../test/package.test.js.md) 检查清单规则。
- 它调用谁：Node 内置 `fs`、`path`、`crypto`、`child_process`（调用系统 `tar`）。
- 运行位置：命令行（本地开发机），不连接任何服务。

## 3. 数据怎样经过它

`files(base)` 的清单规则：

- 固定包含根目录的 `package.json`、`index.js`、`README.md`、`docs/project-guide.md`、`docs/deployment-recovery.md`；
- 若存在则包含 `CHANGELOG.md`、`docs/release-trial.md`、`docs/user-guide.md`；
- 递归 `lib/`、`templates/`、`locales/`、`scripts/`、`test/`，只收 `.js .cjs .html .yaml .ps1 .md` 以及 `recovery-contract.json`；跳过名字以 `.` 开头的条目和 `node_modules`。

`pack(destination)`：

1. 读 `package.json` 的版本号，包名为 `hydro-cf-training-<版本>.tar`；
2. 已存在同名文件时**拒绝覆盖**（防止把旧包当新包交付）；
3. 调用 `tar` 打包清单内文件；
4. 生成 `<包名>.manifest.json`（版本、每个文件的字节数与 sha256）与 `<包名>.sha256`。

注意：`docs/code-guide/` 不在清单里，因此本指南不会进入部署包；清单只覆盖运行时文件、恢复脚本与测试。

## 4. 源码怎么读

全文 43 行，从上到下即可：

- `files`：唯一的清单来源。要新增交付文件，改这里而不是改 `.gitignore`。
- `inventory`：把文件列表变成"路径 + 大小 + 哈希"。
- `pack`：打包与写清单。
- 文件末尾：命令行入口，`--list` 打印清单；带一个参数时把包输出到该目录（默认 `dist`）。

## 5. 怎样使用或验证

在插件目录运行（本次实际执行过 `--list`，输出 62 行且不含 `docs/code-guide/`）：

```sh
node scripts/package.cjs --list
node scripts/package.cjs /tmp/cf-training-candidate
```

预期：第二条命令在新目录生成 `.tar`、`.manifest.json`、`.sha256` 三个文件；如果该目录已有同名包会报错。**不要**在仓库的 `dist*/` 目录上反复打包——那里是历史候选包。

验证清单规则：`node --test test/package.test.js`（检查运行时/恢复/测试文件在列，凭据与生成物不在列，且没有重复项）。

## 6. 容易误解的地方

- **`.gitignore` 不控制打包**：两套机制各自独立，见 [.gitignore.md](../.gitignore.md)。
- **哈希只代表这次打出的包**：代码或文档改动后必须重新打包，旧的 `.sha256` 不能继续用来声明"当前工作树已验证"。
- **`deploy.ps1` 不直接用这个 `tar`**：它用 `--list` 重新收集文件后自己打包，保证"验收目录"和"交付内容"用的是同一份清单。
- **改清单会影响验收范围**：新增运行时代码文件却忘了加入清单，部署包会缺文件；`deployment.cjs` 的必需文件检查能挡住核心文件缺失，但挡不住所有遗漏。

返回上一级：[`scripts/` 目录导航](README.md)。
