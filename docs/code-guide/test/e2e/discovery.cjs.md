# `test/e2e/discovery.cjs`：选赛界面与乱序防护

对应源码：[test/e2e/discovery.cjs](../../../../test/e2e/discovery.cjs)

## 1. 它解决什么问题

教练选赛时最容易出错的是"筛选结果与班级对不上"：快速切班、快速翻页时，旧请求的响应可能覆盖新结果，导致用 A 班的名单看了 B 班的比赛、甚至据此创建了对不上名单的草稿。这个脚本验证页面在这些操作下的行为。

## 2. 检查的行为

- 切换参赛班级后，旧筛选结果与翻页立即清空，搜索条件保留并提示重新搜索；
- 搜索与翻页请求都携带当前班级 ID；
- 旧请求（成功或失败）迟到时，不覆盖新结果，也不显示旧错误；
- 刷新后若班级名单/权限变化，仍要求重新搜索；
- 没有可管理班级时：不发 `discover` 请求、不创建草稿，提示"请先选择有权管理的参赛班级"；
- 创建训练时使用当前选择的班级。

## 3. 它在项目中的位置

- 使用 [ui.cjs](ui.cjs.md) 的模板渲染器；拦截 `discover` 请求后**先不回复**，把请求排进数组，再由脚本按想要的顺序手动回复，从而精确制造乱序（旧请求晚于新请求返回）。
- 与实现对应：页面侧 `invalidateDiscovery`、`discoveryCurrent`（见 [templates/cf_training_app.html.md](../../templates/cf_training_app.html.md)），服务端 `service.discover`（见 [lib/service.js.md](../../lib/service.js.md)）。

## 4. 怎样运行

```sh
cd <插件目录>
node test/e2e/discovery.cjs
```

需要 Edge + 可加载的 Playwright；不连数据库。预期退出码 0，且脚本结尾断言 `errors` 为空（页面无 JS 错误）、请求次数符合预期。本次未运行。

## 5. 容易误解的地方

- 这里的比赛与接触数据全是构造的，验证的是"页面把请求和结果绑定到正确的班级"，不是筛查算法本身；算法与索引一致性见 [test/discovery-scheduler.test.js.md](../discovery-scheduler.test.js.md)。
- 用例里的"慢请求"由拦截层人为延迟，不是网络性能测试。
- 手机/桌面布局断言在 375px 与默认宽度下执行，属于布局冒烟，不是视觉验收。

返回上一级：[`test/e2e/` 目录导航](README.md)。
