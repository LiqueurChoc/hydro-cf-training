# `scripts/recovery-contract.json`：数据恢复契约

对应源码：[scripts/recovery-contract.json](../../../scripts/recovery-contract.json)

```json
{
  "epoch": 1,
  "collections": ["cftrain_state", "cftrain_submission", "cftrain_catalog", "cftrain_reference", "cftrain_job", "cftrain_lock"]
}
```

## 1. 它解决什么问题

部署与恢复脚本需要两个"约定值"：这批数据结构的世代（`epoch`）和该备份的集合范围。把约定写成一个独立文件，比散落在代码里更容易核对。

- `epoch`：数据结构兼容代号。部署脚本要求候选包的 epoch 与现场一致，否则默认拒绝（防止新代码处理不了旧数据）；升级 epoch 意味着必须做数据迁移与恢复演练。
- `collections`：插件的六个集合。备份工具按它确定要导出哪些集合；[storage-manifest.cjs](storage-manifest.cjs.md) 按它做名称映射。

## 2. 数据怎样经过它

- 谁读：`scripts/deployment.cjs` 的 `validate`（校验候选 epoch 必须是 1）；`scripts/database-backup.cjs`（集合名单）；`scripts/storage-manifest.cjs`（映射来源）；`test/database-recovery.test.js`。
- 输入/输出：无运行时输入；它是静态配置。
- 副作用：无。

## 3. 源码怎么读

JSON 两行，读注释即可。真正要理解的是"改它的后果"：

- 改 `epoch`：所有既有备份与现场数据默认被视为不兼容，必须走维护流程；
- 改 `collections`：备份/恢复范围变化，可能漏掉或误加数据。

## 4. 怎样验证

- `node --test test/package.test.js` 检查该文件在候选包清单里；`node --test test/deployment.test.js` 与 `test/database-recovery.test.js` 会实际读取它。
- 文件本身不提供命令。

## 5. 容易误解的地方

- **不是数据库 schema**：它不定义字段结构，只定义脚本的兼容约定。
- **六个集合是插件的全部持久状态**：增删集合必须同步此文件与恢复文档，否则恢复会不完整。
- **epoch 不能随手改小或改回**：它保护的是"代码 ↔ 数据"的兼容关系。

返回上一级：[`scripts/` 目录导航](README.md)。
