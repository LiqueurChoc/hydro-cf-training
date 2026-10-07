# `lib/student-response.js`：学生可见字段白名单

对应源码：[lib/student-response.js](../../../lib/student-response.js)

## 1. 它解决什么问题

同一场训练，教练能看到完整诊断（谁的历史不完整、扫描证明、接触证据、纠正记录），学生只能看到自己的成绩和别人公开的榜单。如果接口把内部对象整个返回，即使页面上不显示，浏览器开发者工具里也能看到——这算数据泄露。

这个文件是学生训练详情的**投影（projection）函数**：输入服务器内部的完整结果，输出一个只含允许字段的新对象。原则是"默认不给，逐字段允许"，而不是"默认都给再删"。

## 2. 它在项目中的位置

- 被谁调用：[index.js](../index.js.md) 的 `run` action（学生看已开赛的训练、赛前预览）以及 [test/e2e/student-response.cjs](../test/e2e/student-response.cjs.md)。
- 它调用谁：不引用其他模块，纯数据转换。
- 运行位置：服务器进程。

## 3. 数据怎样经过它

`studentRunResponse(result, uid, now = Date.now())`：

- 输入：`result`（含 `run` 与榜单 `rows`）、当前登录 `uid`、当前时间。
- 输出：`{ run, rows, hidden, absent }`。

允许对方看到的内容：

| 区块 | 字段 | 说明 |
| --- | --- | --- |
| `run` 基础 | `id`、`title`、`startAt`、`durationSeconds`、`status`、`rated`、`attendees` | `attendees` 只回"我是否签到"（`[uid]` 或空），不返回完整签到名单 |
| `run.rules` | CF：`type`、`decayMinutes`、`wrongPenalty`、`minimumFraction`；ICPC：`type`、`icpcPenalty` | 只挑有限数字字段；计分规则赛前也可见，因为它不属于题目信息 |
| `run.slots` | 仅开赛后：`index`、`points`、`actual` 的 `contestId/index/name` | **赛前整段不返回题目**（`hidden: true`），这是"赛前隐藏"的实现点 |
| `rows` | `uid`、`handle`、`rank`、`points`、`penalty`、`complete`、逐题 `{index, solved, points}` | 榜单公开信息 |
| 仅本人行 | `reason`（如"已有接触记录"）、`completionIssues`（为什么还不能结算） | 他人的资格原因和同步问题**不返回** |

明确不返回的内容（注释与 README 都强调）：接触历史、完整名单、`bindingId`、发布筛查、换题操作记录、内部快照、扫描证明、纠正审计。

## 4. 源码怎么读

全文 36 行：

1. 顶部注释"这是 API 边界，包含旧的冻结快照；永远不要在这里展开内部对象"。
2. `run` 的构造：注意 `attendees` 与 `rules` 的分支。
3. `if (now < source.startAt)`：赛前直接返回 `hidden: true` 且没有 `slots`——**不要**在别处补返回题目。
4. `rows` 的映射：先构造所有人共有的字段，再用 `if (row.uid === uid)` 追加私有解释。

## 5. 怎样使用或验证

- 不能单独运行；但它是纯函数，可以直接传对象调用。
- 本地测试：`node --test test/permissions.test.js` 中的"student run JSON whitelists every nesting level..."用例，检查序列化后的 JSON 在每个嵌套层级都没有内部字段；`test/e2e/student-response.cjs` 用真实模板渲染这个投影，验证赛前隐藏、赛中题目链接和本人原因显示。
- 它只处理"学生视角"；教练视角的数据在 `index.js` 的 `run` 分支里直接返回完整 `result`。

## 6. 容易误解的地方

- **只在页面上隐藏字段不算数**：必须在服务器投影里删除。这个文件就是那条防线。
- **裁判不是它**：它不判断"该不该看这场训练"（例如草稿、非成员），那是 `index.js` 在调用前做的；它只负责"能看的内容有哪些"。
- **新增字段的默认行为是不公开**：教练诊断类信息要留在教练接口里，不要往这里加。
- **旧结算快照也会经过它**：已结算比赛返回冻结成绩，但仍按同一白名单投影，保证历史数据也不会泄露。

返回上一级：[`lib/` 目录导航](README.md)。
