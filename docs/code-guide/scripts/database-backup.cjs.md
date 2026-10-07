# `scripts/database-backup.cjs`：离线备份与隔离恢复

对应源码：[scripts/database-backup.cjs](../../../scripts/database-backup.cjs)

## 1. 它解决什么问题

页面上的"导出训练档案 JSON"只包含档案的一部分（不含全量提交与参照池），不能当数据库备份用。这个工具把插件的六个集合**原样**导出成文本文件（含 BSON 类型与索引定义），并支持把备份导入一个**全新的随机数据库**做核对；它**绝不自动覆盖**真实库。

## 2. 它在项目中的位置

- 被谁调用：运维人员在维护窗口手动运行；[test/database-recovery.test.js](../test/database-recovery.test.js.md) 用真实临时 Mongo 验证往返一致。
- 它调用谁：`mongodb` 驱动（由目标环境提供，Hydro 容器里通常要设 `NODE_PATH`）、[scripts/recovery-contract.json](recovery-contract.json.md)、`scripts/storage-manifest.cjs`（运维先用它拿到物理集合名）。
- 运行位置：命令行；会读写数据库文件与本地备份目录。

## 3. 数据怎样经过它

### 备份（`backup`）

- 输入：Mongo 客户端、存储清单（逻辑名 → 物理名）、目标目录。
- 前置：所有 Hydro/CLI 写入者必须停止；命令行用 `--writers-stopped` 显式确认。
- 每个集合写一个 `<逻辑名>.ejson` 文件：逐行 Extended JSON（`relaxed: false`，保留 `Long`、`Date`、`ObjectId`、`Binary` 等类型）；同时记录每行内容的 SHA-256、条数、索引定义（索引也用 EJSON 保存，避免日期等条件丢失）。
- 目标目录必须不存在（`mkdir` 非递归，绝不覆盖旧备份），权限 0700。
- 输出：`backup.json`（格式版本、时间、清单、每个文件的哈希与索引）。

### 恢复（`restore`）

1. 校验备份清单：集合数量、文件名、逻辑名与物理名一一对应；
2. 逐文件核对 SHA-256，不一致直接拒绝；
3. 创建新库 `cftrain_restore_<随机 UUID>`；若库已存在则报错（防止污染）；
4. 按备份恢复集合、数据、索引；
5. 重新计算恢复后的数据哈希，与备份比对；数量不一致或哈希不符就删除这个临时库并报错；
6. 返回新库名，由人工核对。**永远不会写入原库。**

## 4. 源码怎么读

1. 第 8–12 行：`mapping` 校验存储清单（六个逻辑集合都要有且物理名互不相同）。
2. 第 13–38 行：`backup`。注意"目标目录不可已存在"和 `EJSON.stringify(..., { relaxed: false })`。
3. 第 39–75 行：`restore`。逐条校验 → 新库 → 恢复 → 复算哈希。
4. 第 77–88 行：CLI。`CFTRAIN_BACKUP_MONGO_URL` 从环境变量读取；模式只允许 `backup` 与 `restore-isolated`。

## 5. 怎样使用或验证

- 前置：能连到目标 MongoDB、能加载 `mongodb` 驱动、已通过 [storage-manifest.cjs.md](storage-manifest.cjs.md) 生成清单文件。
- 命令形态（**运维操作，本次未执行**）：

```sh
# 备份（先停掉所有写入者）
CFTRAIN_BACKUP_MONGO_URL=<地址> node scripts/database-backup.cjs backup <备份目录> <manifest.json> --writers-stopped
# 恢复到独立随机库并打印库名
CFTRAIN_BACKUP_MONGO_URL=<地址> node scripts/database-backup.cjs restore-isolated <备份目录>
```

- 本地验证（不需要真实 Mongo）：`node --test test/database-recovery.test.js` 的第一个用例用假数据库验证索引的 BSON 类型往返；真实 Mongo 用例需要 `CFTRAIN_TEST_MONGO_URL`，会建临时库并在结束时删除，同时验证"备份文件被篡改后拒绝恢复"。
- 操作步骤与注意事项引用 [部署与恢复](../../../docs/deployment-recovery.md)，本文不额外发明流程。

## 6. 容易误解的地方

- **备份不是快照**：必须在没有写入者时进行，否则可能拿到不一致的中途状态；脚本用 `--writers-stopped` 提醒这一点。
- **恢复不自动覆盖**：想真正恢复生产，需要人工确认后另行处理；这是防止"为了救急反而清掉现场"。
- **只覆盖插件六集合**：Hydro 自身用户、域、题目等数据不在里面。
- **版本 1 的备份仍可读**：格式 2 把索引保存为 EJSON；恢复旧版备份时，非原始类型的索引条件需要重新备份一次才能完整恢复（源码注释与测试都有说明）。

返回上一级：[`scripts/` 目录导航](README.md)。
