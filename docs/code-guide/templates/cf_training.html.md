# `templates/cf_training.html`：页面骨架与样式

对应源码：[templates/cf_training.html](../../../templates/cf_training.html)

## 1. 它解决什么问题

这是学生页和教练页共用的 HTML 骨架：Hydro 把数据填进模板，生成浏览器收到的页面。它同时决定了页面上有哪些标签页、表单和弹窗，以及整页的 CSS 样式。

## 2. 它在项目中的位置

- 被谁渲染：[index.js](../../../index.js) 的 `TrainingPage.get`（`this.response.template = 'cf_training.html'`）与 [cf_training_health.html](cf_training_health.html.md)（include 本文件）。
- 它调用谁：`{% include "cf_training_app.html" %}` 把浏览器脚本嵌进页面；CSS 全部内嵌，不依赖外部样式表。
- 运行位置：服务器端渲染一次，之后浏览器只执行其中的脚本。

## 3. 数据怎样经过它

模板只使用两个变量：

| 变量 | 来源 | 用途 |
| --- | --- | --- |
| `cfCoach` | [index.js](../../../index.js) 按教练权限计算 | 决定标题、显示哪些标签页、教练专属表单 |
| `cfToken` | 登录会话里的 CSRF token | 写入页面根元素 `data-token`，供脚本发 POST 时携带 |

页面根元素是理解数据流的入口（第 3 行）：

```html
<div id="cf-training"
     data-coach="{{ 'true' if cfCoach else 'false' }}"
     data-entry="{{ url('cf_training') }}"
     data-api="{{ url('cf_training_api') }}"
     data-token="{{ cfToken }}" ...>
```

- `data-api`：接口地址（由 Hydro 生成，带域前缀，**不要写死路径**，否则跨域会失效）。
- `data-entry`：通用入口，供页面发现"身份变了"时跳转。
- 页面区域用 `<section id="ct-...">` 划分：`ct-home`（我的训练）、`ct-coach`（学生管理）、`ct-select`（选赛组赛）、`ct-classes`（班级管理）、`ct-history`（Rating 记录）、`ct-detail`（训练详情）。哪个显示由脚本切换 `ct-hidden` 类。
- 学生专属区域用 `{% if not cfCoach %}` 包住（账号绑定、题目记录、统计、成长曲线）；教练专属区域用 `{% if cfCoach %}` 包住。服务端的权限检查仍然独立执行——页面隐藏只是体验，不是安全措施。

## 4. 源码怎么读

1. 第 4–42 行：`<style>` 里的 CSS。不用逐行读；只需知道 `ct-card`、`ct-pill`、`ct-error`、`ct-chart` 等类名的视觉含义，后面读脚本遇到时可以回查。
2. 第 43–45 行：标题、通栏布局、导航标签按钮（`data-tab`）。
3. 第 47–61 行：六个 `<section>`，对应不同页面；注意每个区域里的按钮都有 `id` 或 `data-*` 属性，脚本靠它们绑定事件。
4. 第 63 行：`<dialog id="ct-class-dialog">`，班级管理弹窗的容器。
5. 第 65 行：把脚本 include 进来。

修改这个文件时，常见任务是"加一个按钮/表单项"。步骤是：在对应 section 加元素（带 `id` 或 `data-*`）→ 在 [cf_training_app.html](cf_training_app.html.md) 的事件处理里加分支 → 在 [index.js](../../../index.js) 增加/复用 action → 同步补测试。

## 5. 怎样使用或验证

- 不能单独打开：里面有 `{% extends %}`、`{{ }}` 等 Nunjucks 语法，直接用浏览器打开只会看到源码。
- 静态检查：`node -e "..."` 这类模板编译检查在 [scripts/deployment.cjs.md](../scripts/deployment.cjs.md) 的 `validate` 里（nunjucks 编译全部 `.html`、渲染两种角色变体、用 `vm.Script` 检查内嵌脚本语法）。
- 浏览器回归：`node test/e2e/ui.cjs` 等脚本会先剔除模板标记再交给 Edge 渲染，用构造数据检查布局与交互，见 [test/e2e/README.md](../test/e2e/README.md)。

## 6. 容易误解的地方

- **`{% raw %}` 只包住 `<style>`**：样式里的 `#cf-training` 等 CSS 选择器不会被模板引擎误解析；不要把脚本区域也放进 `{% raw %}`，脚本里没有会与 Nunjucks 冲突的写法。
- **页面上的隐藏不等于权限**：真正的判断在 [index.js](../index.js.md) 和 [lib/groups.js](../lib/groups.js.md)。
- **改样式不要引入外部 CDN**：插件在离线内网环境也要能显示。
- **元素的 `id` 是脚本的契约**：改 `id`/`data-*` 属性必须同步改脚本与浏览器回归测试，否则页面静默失效。

返回上一级：[`templates/` 目录导航](README.md)。
