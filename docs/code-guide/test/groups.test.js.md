# `test/groups.test.js`：班级权限与班级榜

对应源码：[test/groups.test.js](../../../test/groups.test.js)（对应实现：[lib/groups.js](../../../lib/groups.js)、[lib/service.js](../../../lib/service.js)）

## 准备了什么场景

1. **空班与整批写入**：允许先建空班级再改名、加人；一次给两个班加人时，只要有一个班会超过 100 人，**整批失败且状态不变**（用 `structuredClone` 前后对比）。
2. **班级榜排序**：同域共享 Rating；同分并列（1、1、3）；没有 Rating 的学生列在最后且不编号；题数按"当前绑定账号的全部去重 AC"计算，同一题的大小写 index（`A` 与 `a`）合并，Gym 计入，非法 index 忽略，旧绑定记录不算。
3. **权限**：非成员、非管理员读取班级榜被拒（`GroupAccessDenied`）；管理员可以。
4. **不返回过期私有数据**：四种并发变化分别验证——成员被移出、管理员授权被撤销、账号换绑、班级被删除——都必须报错而不是返回旧数据。
5. **缓存后的二次授权检查**：即使 Rating 计算走缓存，读完之后仍要重新检查班级权限，防止"授权已撤销但缓存命中"绕过。

## 为什么值得检查

班级是权限的最小单位：普通学生也能被委托管理一个班。这些用例覆盖了最容易出错的组合——并发修改、缓存、换绑——它们对应真实事故类型（越权看榜、看到被移除成员的旧数据）。

## 怎样运行

```sh
cd <插件目录>
node --test test/groups.test.js
```

纯本地。测试用替身替换 `service.state`、`service.replay`、`service.records`，不会真的连 Mongo；验证的是 `groupLeaderboard` 与 `changeGroup` 的逻辑。

## 容易误解的地方

- 用例中的 `fixture()` 返回的 `service` 是"半个真实对象"：它调用真实的原型方法，但数据来自内存构造；因此能测权限与聚合，不能测数据库原子性。
- 真正的多班原子写入与租约在 [integration.test.js.md](integration.test.js.md) 里用真实 Mongo 验证。
- 浏览器侧（受托学生的界面边界）在 [e2e/classes.cjs.md](e2e/classes.cjs.md)。

返回上一级：[`test/` 目录导航](README.md)。
