# `lib/groups.js`：班级授权与名单变更

对应源码：[lib/groups.js](../../../lib/groups.js)

## 1. 它解决什么问题

一个教练带多个班，班里还有助教；有时学生本人也被授权管理自己班。权限规则如果只在页面上做，换个请求就能绕过。这个文件把"谁能看见哪个班、谁能改哪个班"做成服务器端规则，并处理：

- 新建班级（默认创建者是所有者）、改名、增删学生；
- 添加/撤销班级管理员；
- 转让班级（发起、取消、接收、拒绝）；
- 域管理员指定或恢复所有者；
- 删除班级。

## 2. 它在项目中的位置

- 被谁调用：[index.js](../index.js.md) 的 POST 分支（`groups.changeGroup` 在 `service.change` 的 CAS 回调里执行）以及 GET 的 `dashboard`/`group_leaderboard` 过滤。
- 它调用谁：[lib/core.js](core.js.md) 的 `integer`（UID 校验）与 `fail`；`randomUUID` 生成班级 ID。
- 运行位置：服务器进程；不直接碰数据库，修改的是传入的 state 对象。

## 3. 权限模型（先看这张表）

| 概念 | 判断函数 | 含义 |
| --- | --- | --- |
| 所有者 `ownerId` | `owns(g, actor)` | 创建者或受让者；能删除班级、转让、管理管理员 |
| 管理员 `adminIds` | `manages(g, actor, root)` | 所有者 + 受委托人 + 域管理员（`root`）；能改名、改成员、看榜单 |
| 可见 | `sees(g, actor, root)` | 管理者或班级成员 |
| 域管理员 | 传入的 `root` 参数 | 由 `index.js` 用 `PERM.PERM_EDIT_DOMAIN` 判定；可管理全部班级 |

普通学生被设为管理员后仍保留学生主页；班级授权**不会**赋予组赛、结算、账号确认等全域教练能力（教练权限见 [lib/permissions.js.md](permissions.js.md)）。

## 4. 数据怎样经过它

`changeGroup(s, a, { actor, coach, root, validateUser })`：

- 输入：state `s`、请求对象 `a`（`a.action` 区分操作）、操作者与权限标志、`validateUser`（校验目标 UID 是当前域有效用户）。
- 动作列表：`group`（新建/保存）、`group_rename`、`delete_group`、`group_members`（可一次给多个班加/删学生）、`group_admin`、`group_claim`（域管理员指定所有者）、`group_transfer`、`group_transfer_cancel`、`group_transfer_accept`、`group_transfer_reject`。
- 并发控制：班级带 `version`，改名/保存时请求要带上读到的版本，不一致抛"班级已被修改，请刷新后重试"。外层还有 `service.change` 的整体档案 CAS。
- 可重复执行：`group_members` 先算出每个班的新名单再统一写入，某个班超员（>100 人）时整批失败，不会写一半。
- 输出：`{ id }`；副作用：修改 `s.groups`，并向 `s.audit` 追加一条操作记录（操作者、班级 ID、时间，换绑类操作还记 UID）。
- `view(g, actor, root)` 生成**给页面看的副本**：没有权限的字段直接不进对象（例如非管理者看不到 `adminIds`，非成员看不到名单）；`GroupAccessDenied` 是"拒绝访问"的专用错误，在 `index.js` 里转成 403。

## 5. 源码怎么读

1. 第 5–21 行：`GroupAccessDenied`、四个判断函数和 `view`。先弄清"谁能看到什么"。
2. 第 22 行注释："授权检查永远基于最新 state 重跑"——因为函数可能在 CAS 重试里执行多次。
3. `changeGroup` 的两个阶段：先定位班级、准备目标用户和名单（`target`/`checkMembers`），再按 `action` 分支修改。
4. 分支里的关键设计：`group_admin` 撤销时**不校验目标用户是否存在**（离域用户也要能撤销）；`group_transfer_accept` 要核对 `transfer.id`、接收者与当前所有者，防止旧邀请被重放；每次变更后统一 `version + 1` 并写审计。
5. 第 104–107 行：批量操作会给每个被改动的班记审计。

## 6. 怎样使用或验证

- 不能单独运行。
- 本地测试：`node --test test/groups.test.js`（空班创建、超员整批失败、班级榜权限、成员被移除后不返回旧数据、并发修改拒绝）；`node --test test/permissions.test.js` 覆盖转让邀请与旧班级指定归属；真实 Mongo 用例 `test/integration.test.js` 验证多班原子写入与并发合并。
- 浏览器回归：`node test/e2e/classes.cjs`（受托学生的受限管理界面、转让双向确认、手机布局）。
- 真实 HTTP：独立容器中的 `test/e2e/release.cjs` 覆盖角色、CSRF、跨域与班级切换。

## 7. 容易误解的地方

- **"教练"和"班级管理员"是两套东西**：本文件只管班级；`PERM_CF_TRAINING_COACH` 才能组赛、结算、确认账号。
- **删除班级不影响已创建训练**：训练保存的是创建时的成员快照，不引用班级名单。
- **委托管理员能改名和改名单，但不能删除/转让**（`ownerOnly`）。
- **保存班级是"整体替换名单"**：页面上保存已有班级时，以提交的名单为准；课堂批量加人是另一个增量接口。
- **修改这里要同步看**：`index.js` 的 GET 过滤、[test/permissions.test.js.md](../test/permissions.test.js.md)、[test/groups.test.js.md](../test/groups.test.js.md)、[test/e2e/classes.cjs.md](../test/e2e/classes.cjs.md)。

返回上一级：[`lib/` 目录导航](README.md)。
