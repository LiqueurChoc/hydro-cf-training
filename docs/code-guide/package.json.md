# `package.json`：插件身份卡

对应源码：[package.json](../../package.json)

## 它是什么，为什么需要

Hydro 加载一个 addon 时，会先读这个目录的 `package.json`，就像快递员先看包裹上的面单。它回答三个问题：这个插件叫什么、入口文件是哪个、对运行环境有什么要求。

```json
{
  "name": "hydro-cf-training",
  "version": "1.0.0-preview.2",
  "private": true,
  "description": "Codeforces replay training, history screening and local ratings for Hydro",
  "main": "index.js",
  "engines": { "node": ">=22" },
  "scripts": { "test": "node --test test/*.test.js" },
  "peerDependencies": { "hydrooj": ">=5.0.0 <6" }
}
```

| 字段 | 含义 | 谁读它 |
| --- | --- | --- |
| `name` | 包名，也是部署目录名 `cf-training` 的来源 | 开发者、部署脚本 |
| `version` | 当前版本号。本仓库现在是 `1.0.0-preview.2`（内部预览，不是正式 1.0） | `scripts/package.cjs` 用它命名 `.tar` 包；发布记录 |
| `private: true` | 声明不发布到 npm 公共仓库 | npm 工具 |
| `main` | 入口文件，Hydro 据此加载 `index.js` 并调用 `apply` | Hydro addon 加载器 |
| `engines.node` | 要求 Node ≥ 22。这是声明范围，不代表所有 22+ 版本都做过实机验证 | 开发者 |
| `scripts.test` | 等价于在插件目录运行 `node --test test/*.test.js` | 开发者（`npm test`） |
| `peerDependencies.hydrooj` | 兼容的 Hydro 主版本：`>=5.0.0 <6`。同样只是声明范围，仓库运行时记录主要针对 Hydro 5.0.7 | 安装者 |

## 容易误解的地方

- **这里没有 `dependencies`**：`hydrooj`、`mongodb` 驱动、`playwright` 都由 Hydro 容器提供，插件包自身不带第三方依赖。所以克隆仓库后不需要 `npm install` 就能运行纯逻辑测试（前提是 Node 版本够）。
- **改 `version` 不会自动升级任何东西**：它影响打包产物的文件名（`hydro-cf-training-1.0.0-preview.2.tar`）与部署记录；真正的部署动作见 [scripts/deploy.ps1.md](scripts/deploy.ps1.md)。
- **`engines` 是提示，不是拦截**：没有安装脚本强制检查；用低版本 Node 运行会以 `require` 错误等方式表现出来。

验证：在插件目录执行 `node scripts/package.cjs --list`，应看到 `package.json` 在清单里（本次运行为 62 个文件）；执行 `npm test` 与 `node --test test/*.test.js` 效果相同。

返回上一级：[根目录导航](README.md)。
