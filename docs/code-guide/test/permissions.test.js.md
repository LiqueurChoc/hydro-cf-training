# `test/permissions.test.js`：接口权限、CSRF 与字段白名单

对应源码：[test/permissions.test.js](../../../test/permissions.test.js)（被测对象：[index.js](../../../index.js)、[lib/student-response.js](../../../lib/student-response.js)、[lib/permissions.js](../../../lib/permissions.js)）

## 准备了什么场景

这个文件用 Node 的 `vm` 模块搭了一个**假 Hydro 沙箱**：给 [index.js](../../../index.js) 注入假的 `hydrooj`（假的 Handler、UserModel、DomainModel、ForbiddenError），真实执行 `apply(ctx)`，然后直接实例化路由类调用 `get()`/`post()`。因此它不需要启动 Hydro，却能测真实的接口逻辑。

覆盖的用例（简化概括）：

| 用例 | 检查什么 |
| --- | --- |
| 权限注册 | 注册可见、重复注册报错、卸载后清理、别的插件抢占同一位报错 |
| 健康检查 | 无/错密钥 403 且不读库；正确密钥读一次库并渲染真实模板；数据库错误如实抛出 |
| dashboard / preview / export | 评分未就绪时不返回旧值、不提供 token；评分版本在读取期间变化时拒绝 |
| 学生 JSON 白名单 | 赛前隐藏题目、只返回本人签到；已发布与已结算（冻结快照）各嵌套层级都不含 `bindingId`、`screening`、`history`、`scanProof`、`submissionId` 等内部字段；受托班级管理员也不能多看；投影不修改持久化数据 |
| 计分规则投影 | 只保留所选赛制的**有限数字**参数（`Infinity`、字符串、未来新字段都不返回） |
| 后台任务标签 | 学生只能看到自己的同步任务，且目标标签不泄露旧绑定；教练看到聚合标签；缺 payload 时显示"目标信息不可用" |
| 成员/域校验 | 请求参数里的 `uid` 不能冒充他人；跨域 403；草稿对学生 403；班级管理员身份不能读比赛 |
| 角色路由 | 普通/仅比赛编辑权限 → 学生页；教练权限 → 教练页；权限撤销后访问教练页 403；未登录 403 |
| 班级授权 | 无授权用户不能管理训练或班级；班级批量写入原子；转让要接受方确认；旧班级只能由域管理员指定归属 |
| 自报与纠正接口 | `seen`/`unsee` 保留本场事实；`correct_exposure` 必须带理由，操作者取登录身份 |
| 题目统计 | 只读且固定按登录学生过滤，`uid` 参数无效 |
| 草稿接口 | 取消/改期带审计；终态拒绝编辑；改期后发布重新筛查 |

## 为什么值得检查

- **字段白名单**：这是防止学生看到他人资格信息和内部诊断的最后一道服务器防线。用例逐层检查 JSON，新增字段如果误入学生响应会立刻失败。
- **`uid` 参数不是身份**：用例专门验证伪造 uid、跨域、草稿、非成员都拿不到数据。
- **权限撤销后立即生效**：刷新页面、重新请求都会被拒。

## 怎样运行

```sh
cd <插件目录>
node --test test/permissions.test.js
```

纯本地沙箱。文件末尾还有若干 Mongo 用例（多班授权、转让等），它们在没有 `CFTRAIN_TEST_MONGO_URL` 时跳过。

## 容易误解的地方

- 沙箱里的 `hydrooj` 是测试替身，不包含真实 Hydro 的全部行为；真正的 HTTP/权限验收是第 5 档，见 [e2e/release.cjs.md](e2e/release.cjs.md)。
- 沙箱通过 `handler(name, permBit)` 直接给用户设权限位，绕过真实角色配置；角色配置本身的界面验证不在这里。
- 修改 `index.js` 的响应字段时，先更新这里的期望字段列表，再改实现——这是"先写需求再改代码"的实践。

返回上一级：[`test/` 目录导航](README.md)。
