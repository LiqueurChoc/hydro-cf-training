# `test/problem-stats.test.js`：题目统计的聚合与展示数据

对应源码：[test/problem-stats.test.js](../../../test/problem-stats.test.js)（对应实现：[lib/history.js](../../../lib/history.js)、[lib/core.js](../../../lib/core.js)、[lib/service.js](../../../lib/service.js)）

## 准备了什么场景

1. **全历史聚合的确定性**：同一题在不同时间、不同大小写 index、不同 rating/标签的记录，聚合后：
   - index 大小写合并（`a` 与 `A` 是同一题）；
   - 同秒提交取 ID 更大的那条作为"最近"；
   - 标签取"最近一组非空标签"，不是所有记录求并集；
   - Gym（`contestId >= 100000`）计入；非法 index、`contestId <= 0` 被忽略；
   - 把输入顺序反过来，输出不变（顺序无关）。
2. **难度与标签分布**：难度按 100 分一档，`null`/`0`/小数等无效 rating 计入 `unrated` 而不是丢掉；标签按"一题每个不同标签各计一次"计入分母；无标签题计入单独的 `unknown` 类别；空输入返回空结构。
3. **统计接口**：505 道题的构造历史一次批量读取题库（每次最多查 500 个 ID，共 2 次查询），题库字段按字段优先级覆盖提交里的回退值；未绑定学生返回空统计；账号在聚合期间换绑时报错。

## 为什么值得检查

页面上"已解决题目统计"的柱图、环图与分母文案都依赖这些规则。最容易被改错的两点：把标签分母当成题数（百分比就错了）、把无 rating 的题丢掉（总数对不上）。

## 怎样运行

```sh
cd <插件目录>
node --test test/problem-stats.test.js
```

纯本地；`studentProblemStats` 用替身提供 `state`、`allRecords`、`catalog`，不会访问真实 Mongo。

## 容易误解的地方

- 题库有值优先于提交记录，但"题库同步时间不代表每道题都是 CF 最新值"——这是产品口径，测试只固定字段优先级。
- 真实数据下的统计正确性另由 [e2e/ui.cjs.md](e2e/ui.cjs.md) 的浏览器用例核对图表渲染，不在这里。
- 这里的 `sub()` 是测试辅助函数，与实际 CF 返回结构相似但不完全相同。

返回上一级：[`test/` 目录导航](README.md)。
