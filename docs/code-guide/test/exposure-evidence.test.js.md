# `test/exposure-evidence.test.js`：接触证据的留存、纠正与恢复

对应源码：[test/exposure-evidence.test.js](../../../test/exposure-evidence.test.js)（对应实现：[lib/exposure.js](../../../lib/exposure.js)、[lib/service.js](../../../lib/service.js)）

## 准备了什么场景

大部分用例用内存态 `service` 替身（第 1 档），最后一个用例需要真实 Mongo（第 2 档）。

| 用例 | 场景 | 检查什么 |
| --- | --- | --- |
| 自报删除后证据仍在 | 发布时保存过 `notice`，之后学生删掉自报 | 仍判定"已有接触记录"，资格不变 |
| 旧快照兼容 | `screening` 只有聚合字段；`unknown`；`attended` 存在；`screening` 整个缺失 | `unknown` 不阻塞资格；旧的 attended 保留；缺快照时标记 `publicationMissing` 且不凭空造证据 |
| 发布筛查留存 | 发布时看到公开提交（WA + 虚拟参赛），之后本地记录被清空 | 发布快照仍能证明参赛与接触 |
| 纠正边界 | 空理由、伪造证据 ID、正确纠正另一场不受影响、纠正后仍受练习/未确认/缺签到/缺扫描证明约束、旧 token 失效 | 纠正"只覆盖所选证据"，不能豁免其他条件 |
| 迟到的公开证据 | 纠正自报后同步出新提交；撤销结算后重新纠正并重新结算 | 新证据独立生效；撤销/重结算不丢纠正记录 |
| 删除再添加自报 | `notice:100/A` 纠正后删除、重新添加 | 纠正仍有效（证据 ID 语义） |
| 并发纠正 | 组装证据后 state 被改（练习标记） | 报"档案已变化"，不写入审计 |
| 同步页留存 | 一页同步写入赛前提交 | 即使之后历史不再包含该提交，证据仍在 |
| 真实 Mongo：重启后仍在 | 同步写入证据 → 删除原始提交记录 → 新建 `TrainingService` 实例 | 证据与纠正跨重启保留，纠正后资格恢复 |

## 为什么值得检查

这是"防洗白"机制的核心：删除自报、清库、重启都不能改变已确认事实；反过来，教练纠正必须精确、可审计，而且不能顺手绕过签到、同步等独立条件。任何一个环节松动，都会导致"做过题的学生拿到 rating"。

## 怎样运行

```sh
cd <插件目录>
node --test test/exposure-evidence.test.js
# 含真实 Mongo 用例：
CFTRAIN_TEST_MONGO_URL=mongodb://oj-mongo:27017 node --test test/exposure-evidence.test.js
```

Mongo 用例会创建随机临时库并删除，不会碰正式数据。

## 容易误解的地方

- 证据 ID 不是"日志行号"：`submission:<提交ID>:problem` 与 `submission:<提交ID>:contest` 是两条不同证据，纠正一条不影响另一条。
- "纠正"不等于"删除"：页面仍显示已纠正项（禁用勾选），审计保留理由、时间与操作者。
- 已结算训练必须先撤销才能纠正——测试里也验证了这一点。
- 页面表单行为（理由必填、已纠正项禁用、文本转义）在 [e2e/exposure.cjs.md](e2e/exposure.cjs.md)。

返回上一级：[`test/` 目录导航](README.md)。
