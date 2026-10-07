# `test/database-recovery.test.js`：备份格式与六集合恢复

对应源码：[test/database-recovery.test.js](../../../test/database-recovery.test.js)（被测对象：[scripts/database-backup.cjs](../../../scripts/database-backup.cjs)、[scripts/storage-manifest.cjs](../../../scripts/storage-manifest.cjs)）

## 准备了什么场景

1. **无 Mongo 的格式测试**：用假数据库对象构造一个带"日期条件"的索引，备份后检查 EJSON 里保留 `$date`，再恢复到一个假库，断言索引条件恢复后仍是 `Date` 而不是字符串。这验证格式 2 的核心改进。
2. **真实 Mongo 的往返测试**（需要 `CFTRAIN_TEST_MONGO_URL`）：
   - 用 `storage-manifest` 建立映射（其中一个集合故意映射成 `mapped_state`、其余带 `school.` 前缀），写入占位数据并建普通索引与部分索引；
   - 数据里包含 `Long`（超出安全整数）、`Date`、`ObjectId`、`Binary` 等 BSON 类型，用来验证类型不丢；
   - `backup` 后 `restore`，要求恢复库名不等于原库、六个集合的**数据与索引**逐一相等、原库未被修改；
   - 篡改备份文件后恢复必须报"checksum mismatch"。

## 为什么值得检查

备份文件是最后的保险。如果 `Long` 变成字符串、索引条件丢类型、恢复覆盖原库，保险就失效了。测试用真实数据往返证明"备份可读、可校验、可恢复且不碰原库"。

## 怎样运行

```sh
cd <插件目录>
node --test test/database-recovery.test.js
# 含真实 Mongo 用例：
CFTRAIN_TEST_MONGO_URL=mongodb://oj-mongo:27017 node --test test/database-recovery.test.js
```

- 第一种用例纯本地，会创建并清理系统临时目录（名字形如 `cftrain-index-test-*`）。
- 第二种会建随机 `cftrain_test_*` 库；结束时删除原库与恢复库。它只操作自己创建的库。

## 容易误解的地方

- 它不会按"生产恢复"的步骤运行（那需要停写、清单生成与人工核对）；命令与注意事项见 [scripts/database-backup.cjs.md](../scripts/database-backup.cjs.md) 和 [部署与恢复](../../../docs/deployment-recovery.md)。
- 恢复验证通过只说明"数据能导出来、能导进一个干净库"，不说明业务逻辑在新库上已验证。
- 备份格式版本 1 也可读，但旧格式的索引条件类型需要新格式重新备份才能完整恢复（源码注释写明）。

返回上一级：[`test/` 目录导航](README.md)。
