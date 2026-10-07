# `scripts/storage-manifest.cjs`：查询集合的真实物理名

对应源码：[scripts/storage-manifest.cjs](../../../scripts/storage-manifest.cjs)

## 1. 它解决什么问题

插件代码里用的集合名是**逻辑名**（`cftrain_state` 等）。Hydro 可以在部署时给集合加前缀或做映射，所以数据库里实际看到的可能是 `hydro.cftrain_state` 这类名字。备份、恢复、排障前必须先查清真实映射，猜名字是很危险的。

## 2. 它在项目中的位置

- 被谁调用：运维人员通过 Hydro CLI 执行（`require` 后再调用），或者把它的输出交给 [database-backup.cjs](database-backup.cjs.md)；测试 [database-recovery.test.js](../test/database-recovery.test.js.md) 也直接调用它。
- 它调用谁：`./recovery-contract.json`（集合名单）；默认参数是 `require('hydrooj').db`，所以**必须在 Hydro 环境里运行**。
- 运行位置：命令行 / Hydro CLI。

## 3. 数据怎样经过它

```js
const manifest = require('./scripts/storage-manifest.cjs')(db);
// { database: 'hydro', collections: { cftrain_state: 'cftrain_state', ... } }
```

- 输入：一个 Hydro 数据库对象（含 `db.databaseName`、`collection(name).collectionName`）。
- 输出：`{ database, collections }` 两个字段，正好是 [database-backup.cjs](database-backup.cjs.md) 需要的清单格式。
- 副作用：无（只读元信息）。

## 4. 源码怎么读

全文 7 行：注释说明"必须在 Hydro CLI 里跑"；导出函数遍历契约里的六个集合，把逻辑名映射到物理名。

## 5. 怎样使用或验证

- 在 Hydro 环境（容器内）执行，把结果存成文件：

```sh
node -e "require('fs').writeFileSync('/tmp/manifest.json', JSON.stringify(require('./scripts/storage-manifest.cjs')(), null, 2))"
```

- 本地（没有 Hydro）不能运行它的默认参数；但测试里注入了假数据库对象，所以 `node --test test/database-recovery.test.js` 可以在本地验证映射逻辑。
- 记住它是**只读**的：任何清理或修改都不应该加在这个文件里。

## 6. 容易误解的地方

- **集合名不要写死在运维命令里**：物理名可能因部署配置不同而变化。
- **六个集合缺一不可**：备份工具会拒绝 `collections` 不完整的清单。
- **它不检查权限或数据内容**：只输出名字。

返回上一级：[`scripts/` 目录导航](README.md)。
