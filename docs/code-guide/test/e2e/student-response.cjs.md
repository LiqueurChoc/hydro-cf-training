# `test/e2e/student-response.cjs`：学生视角的赛前隐藏与赛中榜单

对应源码：[test/e2e/student-response.cjs](../../../../test/e2e/student-response.cjs)

## 1. 它解决什么问题

学生看到的训练详情必须遵守"赛前不泄露题目、赛后只显示允许的字段"。这个脚本用**生产的投影函数** `studentRunResponse` 处理构造的内部数据，再喂给真实学生模板，验证整条链路。

## 2. 检查的行为

- **赛前**：显示"题目将在开赛后显示"，页面没有任何题目链接，计分规则文字可见（CF 的衰减/扣分/最低比例）；
- **赛中/赛后**：题目链接指向正确的 CF 地址（`/problem/100/A`）；榜单显示两人的名次、得分与逐题结果；
- 本人看到自己的资格原因（如"教练设为练习"），他人的私有原因不出现；
- ICPC 规则文案正确（例如罚时 20 分钟）；
- 页面无 JS 错误。

## 3. 它在项目中的位置

- 与 [lib/student-response.js](../../../../lib/student-response.js) 直接对接：脚本 `require('../../lib/student-response')`，确保"真实投影 + 真实模板"组合下没有字段残留。
- 使用 [ui.cjs](ui.cjs.md) 的 `template(false)` 渲染学生视角页面；拦截 `dashboard`、`run`、`attend`、`problems` 等接口。
- 服务器端更完整的字段白名单断言（包含已结算冻结快照分支）在 [permissions.test.js.md](../permissions.test.js.md)。

## 4. 怎样运行

```sh
cd <插件目录>
node test/e2e/student-response.cjs
```

需要 Edge + Playwright；不连数据库。预期退出码 0。本次未运行。

## 5. 容易误解的地方

- 脚本构造的 `row.history = { touched: ['SECRET'] }` 故意放"内部字段"，用来证明投影会删掉它——不是真实响应格式。
- 投影函数在服务器调用；本脚本在浏览器测试里调用同一函数，是为了让测试数据与生产一致，而不是让浏览器做安全检查。
- 没有覆盖真实登录身份与该不该看这场训练的判断；那部分见 [permissions.test.js.md](../permissions.test.js.md) 与 [release.cjs.md](release.cjs.md)。

返回上一级：[`test/e2e/` 目录导航](README.md)。
