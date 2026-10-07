# `test/deployment.test.js`：部署事务与回退的故障注入

对应源码：[test/deployment.test.js](../../../test/deployment.test.js)（被测对象：[scripts/deployment.cjs](../../../scripts/deployment.cjs)）

## 准备了什么场景

测试在系统临时目录里搭一个"假 Hydro"：一个 `addon.json`、一个旧插件目录、一个候选目录，然后注入不同的 `io` 适配器模拟故障：

| 注入点 | 模拟的真实情况 | 断言 |
| --- | --- | --- |
| `validation` / `copy` | 候选代码静态检查失败 / 复制失败 | 直接失败，**没有**任何 stop/start 调用，旧代码与配置原样 |
| `load` | 新代码启动时报错 | 回退旧目录、恢复 addon.json、重新健康检查旧版 |
| `timeout` | 新代码健康检查一直不通过 | 同上，并报告失败 |
| `rollback` | 回退时健康检查也失败 | 报"recovery failed"，Hydro 保持停止，给出备份编号 |
| `concurrent` | 回退前 `addon.json` 被并发修改 | 不覆盖并发修改，失败退出 |
| 正常升级 | —— | 旧文件被清理，新文件就位；显式 `restore` 能换回旧代码，且保留后来新增的其他 addon |
| 旧包（无兼容标记） | epoch 不匹配 | 默认拒绝且不停机；维护模式失败时恢复文件但保持停止 |
| 首次安装失败 | 之前没有插件 | 恢复 addon 列表并检查基础 Hydro 健康 |

## 为什么值得检查

部署脚本的代码路径平时几乎不执行，却决定"出错时网站还能不能起来"。用假 `io` 可以穷举失败分支，而不需要真的搭 Docker。修改 [scripts/deployment.cjs](../scripts/deployment.cjs.md) 后必须让这组用例全绿。

## 怎样运行

```sh
cd <插件目录>
node --test test/deployment.test.js
```

纯本地；所有目录都在系统临时目录并自动清理，不接触真实容器。

最后一个用例需要 `CFTRAIN_DEPLOY_RUNTIME=1`，它复制整个插件目录做真实静态检查（语法、模板渲染），并故意制造语法/模板错误验证能被发现。默认跳过。

## 容易误解的地方

- 假 `io` 不会真的启动 Hydro，因此它验证"调用顺序与状态恢复"，不验证真实 PM2/HTTP 行为；后者见 [e2e/deployment.cjs.md](e2e/deployment.cjs.md)。
- "Hydro 保持停止"是有意为之：宁可人工接管，也不让旧代码处理不兼容数据。
- 测试里的 `addon.json` 是简化格式（字符串数组），真实 Hydro 也支持对象数组；生产校验由 `deployment.cjs` 承担。

返回上一级：[`test/` 目录导航](README.md)。
