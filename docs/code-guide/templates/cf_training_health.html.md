# `templates/cf_training_health.html`：部署健康探测页

对应源码：[templates/cf_training_health.html](../../../templates/cf_training_health.html)

全文只有两行多：

```html
{% include "cf_training.html" %}
<!-- cf-training-build:{{ cfBuild }} -->
```

## 1. 它解决什么问题

部署脚本换上新代码后，需要确认"新代码真的被加载了、模板真的能渲染、数据库真的能读"。这个页面就是探针：它复用完整的训练页面模板，并在末尾打出当前构建的哈希标记。

## 2. 它在项目中的位置

- 谁渲染它：[index.js](../../../index.js) 的 `TrainingHealth.get`（路由 `/cf-training/health`）。请求必须带 `x-cf-training-probe` 头，值与安装时写入 `.deployment.json` 的随机密钥一致（`timingSafeEqual` 比较）；否则 403。
- 会被谁请求：[scripts/deployment.cjs](../scripts/deployment.cjs.md) 的 `health()` 在停机切换后请求它，并在返回 HTML 里查找 `cf-training-build:<本次候选的构建哈希>`。
- 它 include 谁：[cf_training.html](cf_training.html.md)（从而也包含 [cf_training_app.html](cf_training_app.html.md)）；`cfBuild` 由 `TrainingHealth` 从部署清单读出。

## 3. 数据怎样经过它

- 输入：HTTP 请求头里的探测密钥（无请求体）。
- 服务器侧步骤：校验密钥 → 查一次 `cftrain_state` 集合（`_id: '__cf_training_health_probe__'`，只投影 `_id`）确认数据库可读 → 渲染模板，返回 `{ cfCoach: false, cfToken: '', cfBuild: 构建哈希 }`。
- 输出：HTML（含构建标记）与响应体 JSON。
- 副作用：只读；不返回任何用户数据。

## 4. 源码怎么读

读它的两个使用方即可：[index.js](../../../index.js) 的 `TrainingHealth` 类（第 20–30 行）与 [scripts/deployment.cjs](../scripts/deployment.cjs.md) 的 `health` 函数（第 55–75 行）。理解"为什么构建标记必须出现在真实 HTTP 响应里"：静态检查可能通过，但部署的目录如果没换成功，页面标记仍是旧的，探测就会失败并触发回退。

## 5. 怎样使用或验证

- 不能单独运行，也不能用浏览器直接打开。
- 本地检查：`node --test test/permissions.test.js` 里的第一个用例会用假 Hydro 沙箱调用这个 Handler，验证缺失/错误密钥返回 403、正确密钥返回模板名与构建标记。
- 真实检查：只在**独立 Hydro 容器**里由 `test/e2e/deployment.cjs` 执行；它会故意制造加载失败与模板失败，验证回退后健康检查恢复。不要在正式实例上运行。

## 6. 容易误解的地方

- **不是公开接口**：没有密钥一律 403，它不参与业务，也不应该给它加公开数据。
- **`cfBuild` 为空时标记仍在**：模板会输出 `cf-training-build:`，部署脚本要求随后是本次候选的哈希，所以空值不会"碰巧通过"。
- **它 include 了整个应用**：因此部署校验顺带验证了完整模板能渲染；代价是探测响应比较大，但频率很低。

返回上一级：[`templates/` 目录导航](README.md)。
