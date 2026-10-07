# `lib/permissions.js`：注册教练权限

对应源码：[lib/permissions.js](../../../lib/permissions.js)

## 1. 它解决什么问题

Hydro 的权限系统用**二进制位**表示能力：权限常量是 `1n << n` 这样的 BigInt（JavaScript 支持任意精度整数），每个插件家族占用不同的位，用户角色的权限就是若干位的组合。管理员在"管理域 → 权限"里勾选"CF 训练管理（教练）"，实际就是给这个角色加上第 100 位。

这个文件只做一件事：把第 100 位注册进 Hydro 的权限表，让它在管理界面里可见、可勾选；插件卸载时把注册项移除。

## 2. 它在项目中的位置

- 被谁调用：只有 [index.js](../index.js.md) 的 `apply` 开头调用 `registerCoachPermission(ctx, global.Hydro.model.builtin)`。
- 它调用谁：不引用项目模块，只使用传入的 Hydro `builtin` 对象。
- 运行位置：服务器进程。副作用：修改 Hydro 进程内的权限数组（内存），卸载时恢复。

## 3. 数据怎样经过它

- 输入：Hydro 的 `ctx`（用于注册卸载回调）与 `builtin`（包含 `PERM`、`PERMS`、`PERMS_BY_FAMILY`、`Permission` 工厂）。
- 检查冲突：如果某个已有权限常量或已注册权限项占用了第 100 位，直接抛错，**拒绝启动**——防止两个插件抢同一个位导致授权混乱。
- 注册：创建 `{ family: 'perm_cf_training', key: 1n << 100n, desc: 'Manage CF training' }`，推入 `PERMS` 与 `PERMS_BY_FAMILY.perm_cf_training`。
- 卸载：`ctx.on('dispose')` 时从两个数组里移除；家族空了就删除家族键。
- 输出：`PERM_CF_TRAINING_COACH` 常量，供 [index.js](../index.js.md) 的 `coach(this)` 判断使用。

## 4. 源码怎么读

全文 23 行，按顺序读：常量声明 → 冲突检查 → 注册 → dispose 清理。注释"Persistent domain-role bit: never allocate dynamically or change after deployment"是核心约束：**这个位一旦部署就不能改**，因为数据库里已授权的角色记录的是这个位的数值，换位等于作废全部授权。

## 5. 怎样使用或验证

- 不能单独运行。
- 本地验证：`node --test test/permissions.test.js` 的第一个用例真实调用 `registerCoachPermission`，验证注册可见、重复注册报错、dispose 后清理干净，以及"其他插件占用同一位"也会报错。
- 真实使用：管理员在域角色界面勾选后，`index.js` 的 `coach(this)`（内部调用 `this.user.hasPerm(PERM_CF_TRAINING_COACH)`）即可通过；普通学生没有这一位，相关接口返回 403。

## 6. 容易误解的地方

- **教练权限 ≠ 域管理员**：域管理员沿用 Hydro 的 `PERM_EDIT_DOMAIN`（见 [index.js](../index.js.md) 的 `domainAdmin`）；班级所有者/管理员是**单班授权**，不等于教练，见 [lib/groups.js.md](groups.js.md)。
- **它不是"权限检查"文件**：检查散落在 `index.js`（接口）和 `groups.js`（班级）里；这里只负责"把权限位造出来"。
- **升级后原先只有普通比赛编辑权限的教练不会自动获得教练权限**：仓库 README 记录了这一迁移要求，需要管理员重新授权。

返回上一级：[`lib/` 目录导航](README.md)。
