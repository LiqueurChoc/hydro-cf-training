# `zh.yaml`：中文翻译

对应源码：[locales/zh.yaml](../../../locales/zh.yaml)

```yaml
cf_training: CF 训练
cf_training_api: CF 训练接口

cf_training_student: 我的 CF 训练
cf_training_coach: CF 训练管理
perm_cf_training: CF 训练
Manage CF training: CF 训练管理（教练）
```

## 数据怎样经过它

- 输入：无。它是一份静态对照表，键是代码里写死的标识，值是显示文字。
- 输出：Hydro 渲染导航栏、页面标题、权限勾选界面时查这张表。
- 副作用：无；读取它不会访问网络或数据库。

## 源码怎么读

逐行读即可，共 6 行有效条目。重点看键名与 `index.js` 中 `ctx.Route`、`ctx.injectUI` 的第一个参数是否一致（见 [index.js.md](../index.js.md) 第 313–317 行附近的注册代码）。

## 怎样验证

修改后重启 Hydro 插件才会生效；本地不启动 Hydro 无法验证显示效果。要确认英文侧没漏，对照 [en.yaml.md](en.yaml.md)。

## 容易误解的地方

- `Manage CF training` 这个**键本身是英文句子**：它是 Hydro 权限注册时使用的显示键，中文文件把"键"映射成中文；`en.yaml` 里则保持原样。不要以为这是没翻译。
- 页面正文中的大多数提示不在这里，见[目录说明](README.md)。

返回上一级：[`locales/` 目录导航](README.md)。
