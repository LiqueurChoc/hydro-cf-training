# `lib/history.js`：把提交记录整理成题目列表

对应源码：[lib/history.js](../../../lib/history.js)

## 1. 它解决什么问题

CF 返回的原始数据是一条条提交：`{id, creationTimeSeconds, problem: {contestId, index, name, rating, tags}, verdict, ...}`。学生在"我的 CF 题目记录"里看到的却是**按题目去重**的列表：这道题我 AC 过没有、交过几次、最近一次什么时候交的。这个文件负责从原始提交聚合出题目行，并支持分页与"已通过/尝试过"筛选。

## 2. 它在项目中的位置

- 被谁调用：[lib/service.js](service.js.md) 的 `studentProblems`、`studentProblemStats`（统计需要每题的 rating 和 tags）。
- 它调用谁：[lib/core.js](core.js.md) 的 `integer`（分页校验）。
- 运行位置：服务器进程；不访问网络、不直接读写数据库（记录由 `service` 查好后传入）。

## 3. 数据怎样经过它

### `aggregateProblemHistory(records)`

把提交数组聚合成题目行数组。每行的字段：

| 字段 | 含义 |
| --- | --- |
| `key` | `contestId/INDEX`，index 统一大写；`contestId` 非法或 index 格式不对的记录直接跳过 |
| `ac` / `submissions` | AC 次数 / 总提交次数 |
| `lastSubmittedAt` | 最近提交时间（毫秒），用于排序 |
| `name` / `rating` / `tags` | 从"最近的有效提交"里取：name 取最近一条带名字的；rating 取最近一个正整数；tags 取最近一组非空标签（**不是所有记录的并集**） |

排序规则 `compareNewest`：先按时间倒序，同一秒按提交 ID 倒序。题目按 `lastSubmittedAt` 降序、key 升序排列。

### `problemHistory(records, options)`

在聚合结果上分页和筛选：

- `status` 只允许 `all` / `solved`（有 AC）/ `attempted`（无 AC 但有提交）；其他值抛"未知题目状态"。
- `page` 与 `pageSize` 都走 `core.integer` 校验；页码超出总页数时自动收敛到最后一页。
- 返回 `{ rows, counts: {all, solved, attempted}, page, pages, status }`。`counts` 是**未筛选前**的统计，所以页面上的"全部（N）"和当前标签页数量总是自洽的。
- Gym 题目（`contestId >= 100000`）也会被聚合（项目口径包含可识别的 Gym）；`contestId <= 0`、index 不是字母数字的脏数据被忽略。

### 辅助函数

`validRating`（正整数或 null）、`cleanTags`（去重、去空、只保留字符串）。统计接口还会用这个聚合结果算难度分布和标签饼图，见 [lib/core.js.md](core.js.md)。

## 4. 源码怎么读

从上到下顺序即实现顺序：`validRating`/`cleanTags`/`subTime`/`compareIds`/`compareNewest` → `aggregateProblemHistory` → `problemHistory`。聚合函数里"先累积 `_records`，过后再统一挑元数据"的写法值得注意：这样一轮扫描即可，不必对每条提交反复查找。

## 5. 怎样使用或验证

- 最小示例（**自造数据**，本次可运行）：

```js
const { problemHistory } = require('./lib/history');
const rows = [
  { problem: { contestId: 2000, index: 'A' }, verdict: 'WRONG_ANSWER', creationTimeSeconds: 1 },
  { problem: { contestId: 2000, index: 'A' }, verdict: 'OK', creationTimeSeconds: 2 },
];
console.log(JSON.stringify(problemHistory(rows).counts));
// 实际输出：{"all":1,"solved":1,"attempted":0}
```

- 正式测试：`node --test test/history.test.js`（分组、分页、当前绑定隔离、读取中途换绑报错）；`node --test test/problem-stats.test.js` 验证元数据挑选规则（同秒提交取大 ID、标签取最近非空组）。
- 需要真实数据的路径：本地同步测试需要 Mongo，见 [test/integration.test.js.md](../test/integration.test.js.md)。

## 6. 容易误解的地方

- **"尝试过"不等于"不会"**：只表示有提交记录且没有 AC，包括编译错误和未评测。页面文案也明确它不能推断掌握程度。
- **改名/评级不是实时值**：题目资料优先使用本地题库，缺失时才回退到提交记录里的字段；题库同步时间不代表每道题都是 CF 最新值（`service.studentProblemStats` 的注释与 README 都说明了这一点）。
- **换绑账号后看的是新账号的历史**：聚合按 `bindingId` 隔离；读取过程中账号被换掉会报"账号已更换"，见 [lib/service.js.md](service.js.md)。
- **不要在这里做权限判断**：它只是数据整理函数；"谁能看哪份记录"由 `service` 和 `index.js` 决定。

返回上一级：[`lib/` 目录导航](README.md)。
