# `test/e2e/release-fixture.cjs`：仅测试用的控制面板

对应源码：[test/e2e/release-fixture.cjs](../../../../test/e2e/release-fixture.cjs)

## 1. 它解决什么问题

隔离验收需要一个"上帝视角"来操控合成环境：把开赛时间拨到过去、让 CF 把 AC 重判成 WA、临时撤销教练角色、重置数据。这些操作**绝不能存在于产品插件里**，所以它们被单独放在这个测试专用 addon 中，由 [release-environment.ps1](release-environment.ps1.md) 手动注入隔离容器。

## 2. 它在项目中的位置

- 运行位置：隔离容器内的 Hydro 进程，作为独立 addon 加载（`/tmp/cftrain-t10-fixture` 指向本文件）。
- 它调用谁：插件的 [lib/service.js](../../../../lib/service.js)（通过 `global.Hydro.model.cfTraining` 获取实例）、Hydro 的用户/域模型；并**替换** `service.client`，用合成响应代替真实 CF 请求。
- 被谁调用：[release.cjs](release.cjs.md) 通过 HTTP `POST /t10-fixture`（请求头带密码）触发；Hydro CLI 用它执行 `bootstrap`。

## 3. 防线（为什么它不会影响正式环境）

1. `guard()` 要求 `/root/.hydro/config.json` 的 `name` 是 `cftrain_test_t10_hydro_isolated`，且没有 `url`/`uri`，还要求 `CFTRAIN_ISOLATED_RELEASE=1`；
2. 所有命令（除 bootstrap）读取 `/tmp/cf-training-release.json` 的随机密码；
3. 合成 CF 客户端只响应 `user.info`/`user.rating`/`user.status`，其他方法直接报错；
4. `reset` 删除该域全部提交（`deleteMany({})`），因此 guard 必须保证这是专用库。

## 4. 提供的命令

| 命令 | 作用 |
| --- | --- |
| `bootstrap` | 建域、六个身份、域角色（教练含插件权限位）、合成参照榜/题目/目录，写会话文件 |
| `reset` | 清空本域档案与提交，重新准备两个学生账号与基线 |
| `advance` | 把指定训练的开赛时间改到 1 分钟前（模拟时间流逝） |
| `rejudge` | 改变合成判决（如 AC → WA） |
| `revoke` | 把教练角色降回默认，用于验证权限撤销 |

## 5. 怎样使用或验证

- 只能通过 [release-environment.ps1](release-environment.ps1.md) + [release.cjs](release.cjs.md) 的流程使用；手工执行需要显式设置隔离环境变量并确认容器身份。本次未执行。
- 它自身有 guard 与密码校验，不提供读取真实数据的接口。

## 6. 容易误解的地方

- **它不是产品代码**：打包清单包含它（用于候选包内验收），但候选插件不会自动加载它；生产 Hydro 的 `addon.json` 不会加入它，除非操作者手动添加。
- **`user.info` 固定返回 1600**：这是合成基线，不是真实 CF 数据。
- **脚本每次会重置隔离数据**：不能用于保留试训记录。

返回上一级：[`test/e2e/` 目录导航](README.md)。
