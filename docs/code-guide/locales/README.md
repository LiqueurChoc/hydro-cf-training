# `locales/`：界面翻译文件

这个目录很薄，只有两个文件；它决定 Hydro 导航栏和权限管理界面显示的中英文文字。

| 文件 | 说明 |
| --- | --- |
| [`zh.yaml`](../../../locales/zh.yaml) | 中文翻译。见 [zh.yaml.md](zh.yaml.md)。 |
| [`en.yaml`](../../../locales/en.yaml) | 英文翻译。见 [en.yaml.md](en.yaml.md)。 |

## 这个目录整体负责什么

Hydro 的界面文字（导航项、页面标题、权限名）使用 `键: 值` 的 YAML 格式配置，每种语言一个文件。本插件注册了这些键：

| 键 | 对应位置 |
| --- | --- |
| `cf_training` | 导航栏"CF 训练"（由 `index.js` 里 `ctx.injectUI('Nav', 'cf_training', ...)` 使用） |
| `cf_training_student` / `cf_training_coach` | 学生页 `/cf-training/student`、教练页 `/cf-training/coach` 的标题 |
| `cf_training_api` | 接口页面的名称（主要用于内部显示） |
| `perm_cf_training` | 权限家族名"CF 训练" |
| `Manage CF training` | 教练权限的具体名称，出现在"管理域 → 权限"勾选列表里 |

## 为什么放在一起

Hydro 约定：addon 目录下的 `locales/*.yaml` 会被自动扫描作为翻译资源，不需要在代码里手动加载。这两个文件只做翻译，不含逻辑，所以可以放心对照修改。

## 它和其他目录的关系

- `index.js` 注册路由和导航时用的**键名**必须与本目录的键一致，否则界面会显示原始键名而不是文字。
- **页面里的中文文案大多不在这里**：训练列表、按钮、提示语等写在 [templates/cf_training.html.md](../templates/cf_training.html.md) 与 [templates/cf_training_app.html.md](../templates/cf_training_app.html.md) 里。想改页面上的一句话，通常应改模板而不是 yaml。
- 语言文件不参与打包过滤以外的任何运行逻辑，打包清单会包含 `locales/` 下的 `yaml` 文件（见 [scripts/package.cjs.md](../scripts/package.cjs.md)）。

## 容易误解的地方

- 只有两个文件，不是"国际化系统重构"：新增语言才需要新增文件；日常改文案改模板即可。
- 权限名修改只影响显示，不影响权限本身；权限的位与检查逻辑在 [lib/permissions.js.md](../lib/permissions.js.md)。

返回上一级：[根目录导航](../README.md)。
