# `en.yaml`：英文翻译

对应源码：[locales/en.yaml](../../../locales/en.yaml)

结构与 [zh.yaml.md](zh.yaml.md) 完全相同，只有 6 条：

```yaml
cf_training: CF Training
cf_training_api: CF Training API

cf_training_student: My CF Training
cf_training_coach: CF Training Management
perm_cf_training: CF Training
Manage CF training: Manage CF training (coach)
```

## 数据怎样经过它

Hydro 在英文界面环境下用这张表替换同名键。它与中文文件必须保持**键集合一致**：代码里用哪个键，两个文件都要有对应条目，否则某种语言下会直接露出键名。

## 怎样验证

与中文文件对比键名是否一一对应即可，无需运行环境。修改后需要重新加载插件，见[`locales/` 目录说明](README.md)。

## 容易误解的地方

- 本文件的值全是英文并不代表"未翻译"；它是英文语言包的正常内容。
- 插件只内置中英两种语言；新增语言的完整流程不在当前版本范围。

返回上一级：[`locales/` 目录导航](README.md)。
