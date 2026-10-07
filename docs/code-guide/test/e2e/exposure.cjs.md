# `test/e2e/exposure.cjs`：接触证据纠正表单回归

对应源码：[test/e2e/exposure.cjs](../../../../test/e2e/exposure.cjs)

## 1. 它解决什么问题

教练纠正误报时，表单必须：只能勾选具体证据、理由必填、已纠正的证据不能再选、已结算训练整体锁定、审计文字安全转义。这个脚本在 375px 手机上用真实模板验证这四点。

## 2. 检查的行为

- 展示两条证据（自报 `notice:100/A` 与公开提交 `submission:77:problem`）；
- 理由输入框带 `required`；
- 勾选并提交后：请求体含 `evidenceIds: ['notice:100/A']` 与当前学生 `uid`，是 POST；
- 提交后已纠正项变为禁用，未纠正项仍可选；
- 纠正记录里的文本（构造的恶意 HTML）以文本显示，页面没有产生 `<img>` 等元素（转义生效）；
- 已结算训练下表单按钮为空（锁定）。

## 3. 它在项目中的位置

- 使用 [ui.cjs](ui.cjs.md) 的模板渲染器；`correct_exposure` 请求被拦截记录。
- 与实现对应：[templates/cf_training_app.html](../../../../templates/cf_training_app.html) 的"本场接触证据与误报纠正"区块；服务端 [lib/service.js](../../../../lib/service.js) 的 `correctExposure`（真实规则、审计与并发在 [test/exposure-evidence.test.js.md](../exposure-evidence.test.js.md) 验证）。

## 4. 怎样运行

```sh
cd <插件目录>
node test/e2e/exposure.cjs
```

需要 Edge + Playwright；不连数据库。预期退出码 0。本次未运行。

## 5. 容易误解的地方

- 页面限制"只能选具体证据"不等于服务器限制；服务器会再次核对证据 ID 是否存在（见 [lib/exposure.js.md](../../lib/exposure.js.md)）。
- 构造的恶意文本只用于验证转义，不代表真实数据里存在这类内容。
- 权限检查（只有全域教练能纠正）不在本脚本，见 [permissions.test.js.md](../permissions.test.js.md) 与 [release.cjs.md](release.cjs.md)。

返回上一级：[`test/e2e/` 目录导航](README.md)。
