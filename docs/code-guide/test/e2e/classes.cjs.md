# `test/e2e/classes.cjs`：班级管理浏览器回归

对应源码：[test/e2e/classes.cjs](../../../../test/e2e/classes.cjs)

## 1. 它解决什么问题

在真实模板上验证班级相关界面：教练编辑已有班级、批量把学生加入多个班、受托学生的受限管理入口、切班记忆、班级榜乱序保护、转让双向确认和手机布局。

## 2. 它在项目中的位置

- 用 [ui.cjs](ui.cjs.md) 的 `template()` 渲染真实页面；页面请求被拦截并返回构造数据。
- 班级权限判断使用**真实的** [lib/groups.js](../../../../lib/groups.js)（`require('../../lib/groups')`）来生成 dashboard 里各用户可见的班级视图，页面渲染与权限过滤因此与生产一致。
- 需要 Edge + Playwright；不连 Hydro/Mongo。

## 3. 数据怎样经过它

脚本为不同身份（教练 uid 7、受托学生 uid 2 等）各开一个页面，每个页面的 dashboard 响应由真实的 `groups.view(g, uid, root)` 过滤。POST 请求（改名、删班、加人、转让接受）在拦截层更新内存里的 `state`，并记录到 `posts` 数组供断言。

## 4. 检查的行为

- 受托学生能看到受限管理界面，但"删除班级"禁用、且保留自己的学生主页；
- 切换班级会保存偏好（localStorage），刷新后仍选中（脚本可注入读取失败场景）；
- 班级榜旧请求的迟到响应不会覆盖新班级的结果；
- 转让：确认按钮在未选择接收者时禁用，接受后所有者变为接收者、原所有者成为管理员（直接断言内存 state）；
- 375px 手机宽度下无横向滚动；
- 页面无 JS 错误。

## 5. 怎样运行

```sh
cd <插件目录>
node test/e2e/classes.cjs
```

预期：输出通过信息，退出码 0；截图写入 `.test-output/classes-coach.png`、`.test-output/classes-mobile.png`。本次未运行。

## 6. 容易误解的地方

- 班级**榜单数据**是构造的，班级**权限过滤**是真实的；两者结合用于页面行为验证，不代表数据库层并发正确。
- 截图输出目录被 gitignore，不会进仓库或部署包。
- 修改 [lib/groups.js](../../../../lib/groups.js) 的 `view()` 字段会影响这个脚本；同步修改前先看 [test/groups.test.js.md](../groups.test.js.md)。

返回上一级：[`test/e2e/` 目录导航](README.md)。
