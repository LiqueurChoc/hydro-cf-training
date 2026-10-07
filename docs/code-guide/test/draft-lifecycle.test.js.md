# `test/draft-lifecycle.test.js`：草稿生命周期（真实 Mongo）

对应源码：[test/draft-lifecycle.test.js](../../../test/draft-lifecycle.test.js)（对应实现：[lib/service.js](../../../lib/service.js)）

## 准备了什么场景

**需要 `CFTRAIN_TEST_MONGO_URL`**，每个用例建一个随机 `cftrain_test_*` 库，结束时删除。它验证两个草稿细节：

1. **过期草稿、取消与换绑的相互作用**
   - 学参与一个已过期草稿时，教练换绑被拒绝；
   - 取消草稿后可以换绑；重复取消**不增加审计、不改变 revision**；
   - 已取消草稿不能计算榜单（`result`）、不能预览结算（`preview`）；
   - 一个"取消"与一个"发布"并发执行时，最终只能是其中一个结果，且后续换绑是否被拒与实际终态一致——用 `Promise.allSettled` 断言"两个操作只有一个成功"。
2. **过期草稿改期**
   - 改期只改 `startAt`，题目与参赛名单不变；
   - 旧的 `screening` 与 `configHash` 被清除（发布时要重新筛查）；
   - 审计记录保留改期前后时间；
   - 已发布的比赛不能再改期或取消。

## 为什么值得检查

"草稿过期"是真实会发生的：教练建了草稿但学生临时没空，一周后才用。产品规则是"改到未来、重新核查、重新发布"，而不是让过期草稿静默失效。并发用例则防止"取消"和"发布"同时成功造成状态错乱。

## 怎样运行

```sh
cd <插件目录>
CFTRAIN_TEST_MONGO_URL=mongodb://oj-mongo:27017 node --test test/draft-lifecycle.test.js
```

没有该环境变量时用例跳过。**不要指向正式库**：测试会写入并删除自己的随机库（名字形如 `cftrain_test_<32位 hex>`）。

## 容易误解的地方

- 取消草稿不删除档案，仍占用单域 200 场上限——这是产品决定，测试固定了"取消后仍可查询、审计只记一次"。
- 用例里直接 `service.change` 构造状态，字段比真实流程少；它测的是规则分支，不是完整页面流程。
- 浏览器侧的改期/取消按钮行为见 [e2e/draft-lifecycle.cjs.md](e2e/draft-lifecycle.cjs.md)。

返回上一级：[`test/` 目录导航](README.md)。
