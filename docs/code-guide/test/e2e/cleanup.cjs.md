# `test/e2e/cleanup.cjs`：清理测试域与账号

对应源码：[test/e2e/cleanup.cjs](../../../../test/e2e/cleanup.cjs)

## 1. 它解决什么问题

真实 Hydro 回归会留下测试域、用户、提交、参照快照和目录条目。这个脚本负责全部删除，并保留防误删校验。

## 2. 它在项目中的位置

- 在 [browser.cjs](browser.cjs.md) 之后运行（读取 `/tmp/cf-training-e2e.json`）。
- 它直接操作 Hydro 的数据库集合：删除域、`cftrain_*` 里的本域数据、合成目录条目，然后删除两个用户（清权限、删 token、删域内成员关系与用户记录），最后删除本地凭据文件。

## 3. 安全校验（为什么它不会误删正式数据）

1. 域名必须匹配 `cftrain-e2e-[a-f0-9]+`；
2. 删除用户前，先查 `user` 集合确认 `_id + uname + 邮箱` 三者与记录一致，否则拒绝；
3. 目录清理只删 `_id` 属于合成集合且 `data.name === 'AUTOMATED TEST FIXTURE'` 的条目。

## 4. 源码怎么读

全文 29 行，按执行顺序读。注意删除顺序：先域与插件数据，再用户与凭据，最后返回删除摘要。

## 5. 怎样使用或验证

- 前置：bootstrap 生成的 `/tmp/cf-training-e2e.json` 存在。命令形式见 [test/e2e/README.md](../../../../test/e2e/README.md)。本次未执行。
- 预期输出 `{ removedTestDomain, removedTestUsers }`；执行后配置文件中列出的域与用户在 Hydro 中不再存在。

## 6. 容易误解的地方

- **必须运行**：不运行会留下真实可登录账号（密码在临时文件里）。
- 它不会删除 CF 上的任何东西（测试从未使用真实 CF 账号），也不会删除其他域。
- 如果手工改过合成条目名字，安全校验会让删除跳过这些条目——宁可残留也不误删。

返回上一级：[`test/e2e/` 目录导航](README.md)。
