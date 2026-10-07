# `test/e2e/release.cjs`：独立容器中的完整候选验收

对应源码：[test/e2e/release.cjs](../../../../test/e2e/release.cjs)

## 1. 它解决什么问题

这是第 5 档验收：在**专门搭建的隔离 Hydro 容器**（固定名 `cftrain-t10-hydro`、独立数据库 `cftrain_test_t10_hydro_isolated`、端口 18888）里，用真实 HTTP、真实 MongoDB、真实 PM2 进程重启，把候选插件从权限到结算走一遍。它回答"这个候选包在真实 Hydro 上能不能用"，而不是"页面画得对不对"。

## 2. 硬性防呆（先看这段）

源码开头就检查：

- 环境变量 `CFTRAIN_ISOLATED_RELEASE=1` 必须显式设置；
- 配置域名必须匹配 `cftrain-e2e-*`；
- 脚本只对 `base`（默认 `http://127.0.0.1:18888`）操作。

配套的 [release-environment.ps1](release-environment.ps1.md) 只创建带 `cftrain.task=t10` 标签的专属容器，不会碰普通容器。**没有隔离环境时不要运行。**

## 3. 它依赖的合成设施

- [release-fixture.cjs](release-fixture.cjs.md) 提供 `/t10-fixture` 控制接口：重置数据、推进开赛时间、改变判决、撤销教练角色；
- 六个临时身份：域 root、教练、另一个教练（无本域权限）、学生、受托学生管理员、域外用户；
- 合成参照榜与题目数据（比赛 99001，两道题）。

## 4. 检查的行为（四组）

| 组 | 覆盖 |
| --- | --- |
| 角色与边界 | 教练/受托学生/域管理员的可见范围；跨域注入；CSRF 缺失被拒；切班；学生不能改班、不能组赛；无权限教练不能操作 |
| 组赛与结算 | 创建草稿 → 排错（改期）→ 换题 → 发布 → 赛前隐藏 → 签到 → 触发完整同步 → 预览 → 结算 → 重复结算被拒 → 撤销 → 重判后重结算；接触证据留存与纠正；学生原始 JSON 不含私有字段（脚本直接检查） |
| 换绑与统计 | 有草稿时换绑被拒；取消后换绑成功、重新同步与确认；题目记录/统计按新绑定；导出 |
| 重启与并发 | 真实 `pm2 restart hydrooj` 后：持久化的全窗同步继续完成、多会话读取、评分缓存重建；30 个并发 dashboard 请求 |

每段成功后向 `checks` 数组追加描述，最后打印 `{ passed: true, fixture, checks, concurrentReadsMs }`。页面 JS 错误会让测试失败。

## 5. 怎样运行

按 [test/e2e/README.md](../../../../test/e2e/README.md) 的步骤：

```powershell
.\test\e2e\release-environment.ps1 -Mode Setup -SourceDirectory <解包目录>
$env:CFTRAIN_ISOLATED_RELEASE='1'
node test/e2e/release.cjs
# 以及包内同一套单测（真实临时 Mongo + CF + 运行时校验）
.\test\e2e\release-environment.ps1 -Mode Cleanup
```

前置：Windows + WSL Ubuntu + Docker、`oj-mongo`、本地 `docker-oj-backend` 镜像、Playwright/Edge。本次说明**未运行**，命令与验收范围直接引用现有文档。

## 6. 容易误解的地方

- **合成训练不是真实学生整场试训**：它推进的是合成时钟与合成 CF 响应；真实小班试训另见 [试训记录](../../../../docs/release-trial.md)。
- **通过它不代表可以发布 1.0**：它还要求包哈希核对与独立环境；版本边界见 [接手指南](../../../../docs/project-guide.md)。
- **每次运行会重置隔离域的合成数据**；绝不能把 `CFTRAIN_ISOLATED_RELEASE` 指到真实实例。
- 失败时也必须执行 Cleanup，删除容器、独立库与本地凭据。

返回上一级：[`test/e2e/` 目录导航](README.md)。
