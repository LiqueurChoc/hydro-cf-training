# 我的训练：已解决题目统计实施方案

日期：2026-09-24。状态：已实现并完成本机回归，真实账号长期同步与大班使用尚未验收。本文保留实施时的产品口径与工作树背景；后续验证记录见插件 README 和 [复查记录](../reviews/2026-09-24.md)。未发布 GitHub Issue。若后续要求发布，按项目 issue-tracker 配置发布到 LiqueurChoc/MyXCPCFile。

## 1. 目标与已确认范围

在学生“我的训练”页新增“已解决题目统计”，包含题目难度 Rating 柱状图和标签环形饼图。老师已确认以下选择，不要重新询问：

- 当前绑定 CF 账号的全部已同步历史 AC 题目，覆盖正式赛、练习、虚拟参赛和可识别 Gym；不限制为本站训练期间。相同 contestId 和大写 index 去重，不同比赛编号不自动合并。
- 一道题含多个标签时，每个不同标签各计一次。饼图分母为全部标签计数之和；未知标签类别每题计一次，也纳入分母。
- 只做统计展示、悬停/点击查看数值和完整图例，不做题目下钻、时间筛选、推荐或教练报表。
- Rating 每 100 分一档，按难度升序，中间空档补 0；未评级单列，不作为 0 分。
- 使用本地已同步数据；题目资料优先本地题库，缺失时回退到有效提交资料。不在打开页面时抓取远端历史，不改现有同步调度。
- 放在 CF 题目记录下方、本地 Rating 成长曲线上方。桌面并排，手机上下；标签保留 CF 英文名称，数量降序，完整图例可滚动。

参考 https://codeforces.com/profile/C10udz 。本次已通过 Chrome 目视确认浏览器插件展示的 Problem Ratings 柱状图（按难度着色）和 Tags Solved 环形图（配数量图例）。只参考可见外观，未核实插件内部统计算法，不要求复刻插件源码。

领域定义位于上课教案/CONTEXT.md。题目难度 Rating 与个人本地训练 Rating 必须区分。

## 2. 当前工作树与修改边界

本方案基于当前工作树，而非干净 HEAD。开始执行先阅读适用 AGENTS.md、插件 README 与 git diff；保留已有改动，不 reset、checkout 覆盖或删除未跟踪文件。规划时已有改动：README.md、index.js、lib/core.js、lib/service.js、两个模板、test/permissions.test.js；lib/history.js、test/history.test.js 为新增未跟踪文件。上课教案/CONTEXT.md 的术语是本次规划新增。

代码定位使用下列符号；行号可能随并行工作变化：

| 文件/符号 | 现状 | 本次处理 |
| --- | --- | --- |
| lib/core.js / ratingHistogram、tagPie | 已有未接入的统计函数 | 复用并补测试，必要时调整标签清洗与未知类别文案 |
| lib/history.js / problemHistory | 全量聚合后分页；没有 tags；rating 选择可能依赖输入顺序 | 提取可复用全量聚合，稳定选取资料，保持已有列表契约与状态语义 |
| lib/service.js / allRecords、studentProblems | 按当前 bindingId 取完整提交 | 新增 studentProblemStats，批量补本地题库资料 |
| index.js / TrainingApi.get | action=problems 使用登录 uid | 增加 action=problem_stats，同样限制本人 |
| templates/cf_training.html / ct-home | 学生账号、题目记录、本地曲线、训练列表 | 插入独立统计卡片与响应式样式 |
| templates/cf_training_app.html / refresh、loadProblems、renderRating | 页面刷新加载题目列表和曲线 | 增加独立统计请求和 SVG 渲染，隔离失败 |

standardProblemKey 专用于普通题，会排除 Gym，不能直接用于本次统计。保留它对组赛的原有限制。不要顺带修改非 AC 题目的 attempted/pending 分类、训练计分、评级重算或同步策略。

## 3. 聚合规则（执行 AI 不得自行改口径）

### 3.1 解题集合

提交来源是当前域中登录用户当前绑定的 bindingId 对应全部 records，不是题目列表的 50 条分页结果。数据库按 bindingId:submissionId 存储，分页同步的重叠记录不会额外新增。

有效身份：contestId 为正安全整数，index 匹配当前历史模块的字母开头字母数字规则；index 转大写。同一身份任一提交 verdict 严格等于 OK 即计入；AC 后又 WA 不取消通过。未 AC、非法身份、自报接触记录不计入。不根据题名合并，不额外排除 Gym，也不推断团队提交能证明独立完成。

以数据库当前保存的 verdict 判断：若重测已同步并使某题没有任何 OK，该题不再计入。早期重测可能尚未被增量扫描覆盖，因此不得宣称与 CF 实时完全一致。

### 3.2 难度与标签资料

对每道已解决题目，按字段分别选择：本地 catalog 的有效值优先；缺失时取该题所有提交中最新的有效值。最新顺序由 creationTimeSeconds 降序、submission id 降序决定，不能依赖数据库返回顺序。缺失字段不能抹掉较旧的有效字段。

- 有效 rating：正的有限安全整数；空值、0、负值和非法值视为缺失。不要用个人 rating、比赛基础分填补。
- 标签：仅接收字符串，trim 后剔除空串并去重；保留原始英文，不任意改变大小写或翻译。不把对象强制 String 后当成标签。
- 优先选清洗后非空的题库标签集合，否则回退到最新非空的提交标签集合；不要跨多个版本求标签并集。
- 都没有有效 rating：计入未评级。都没有标签：内部保留独立 unknown 类型，显示“无标签/标签未知”，避免与真实标签同名时错误合并。
- catalog 不含 Gym 时直接使用提交资料，不能因此丢弃 Gym 题目。

可提取 aggregateProblemHistory(records) 提供全量去重行，problemHistory 继续做原有排序/筛选/分页；另用纯函数生成统计。为统计补资料可在其独立路径完成，不要求本次改变题目列表资料来源。避免重复写一套 AC/题目身份逻辑。

### 3.3 输出及守恒

桶下界 min=floor(rating/100)*100，上界 max=min+99。API 可以只返回非零桶，前端从最小到最大桶每隔 100 补零，不固定最高 3500。横轴显示下界，tooltip 显示完整范围。

- rating.bins 的 count 总和 + rating.unrated = solvedTotal。
- tagDistribution.total = 所有标签计数 + 无标签/标签未知题数。
- 每个标签百分比 = count / tagDistribution.total × 100；显示一位小数，允许四舍五入后合计略偏离 100%。
- 柱图若显示百分比，分母是 solvedTotal（包含未评级），必须标明；未知评级不使用段位色。
- 标签 count 降序，同数按固定英文字符串顺序排序，结果不受提交遍历顺序影响。

## 4. 服务与 API 契约

新增 GET action=problem_stats，使用现有 api helper 与 ok/result 外层结构。方法 studentProblemStats(domainId, uid)，uid 只能来自 this.user._id。忽略客户端传入的 uid/handle/status/page，不开放其他学生查询；保留登录和域边界检查。只返回聚合数据，不返回原始提交、全班资料或凭据。

result 字段固定如下（这是结构约定，不是真实数据）：

```js
{
  account: null, // 或 { handle, bindingId, historyComplete, status, lastSyncAt }
  catalogSyncedAt: null, // 毫秒时间戳或 null
  solvedTotal: 0,
  rating: { bins: [], unrated: 0 }, // bins: [{ min, max, count }]
  tagDistribution: {
    total: 0,
    rows: [] // [{ kind: 'tag'|'unknown', tag: string|null, count }]
  }
}
```

未绑定返回 account:null 和上述零值。已绑定的 status 沿用 queued/syncing/ready/failed，lastSyncAt 无有效值时为 null。bindingId 是区分换绑的内部版本标识，前端不展示。

服务先聚合解题身份，再用 catalog _id=problem:contestId/index 批量查询，仅查相关题；分批大小可定为 500，禁止每题一次查询。读取 meta.syncedAt。不新增数据库集合或持久化统计缓存，不逐页调用 CF API，不改数据索引，除非验证证明必要并单独说明。

本功能允许同步中展示部分数据，不要求事务快照。请求结束前重新确认当前 bindingId；若已经换绑，拒绝旧结果并提示刷新重试，不把旧账号数据伪装成新账号。前端使用请求序号丢弃较早完成的过期请求。

## 5. 页面与交互

在学生 ct-home 插入“已解决题目统计”卡片，标题下显示当前 handle、已解决题目总数、上次成功同步时间。注明“基于已同步公开提交；一题可计入多个标签，标签占比以标签计数总和为分母”。无标签类别附上“不表示没有算法知识点”的简短说明。

两个子图标题分别为“已解决题目难度分布”和“已解决题目标签分布”。CSS Grid 在宽度充足时两列，建议 900px 以下单列；手机仍保持饼图与图例可读。

- 沿用本地 SVG 模式，不引入 CDN 或新图表框架。新函数/DOM ID 使用独立 stats 命名，避免覆盖已有 ratingSnapshot、tooltip、resize 处理。
- 柱图纵轴从 0 开始，只显示整数题数；CF 分色复用现有 bandOf 的分界与配色。未评级为中性色、单独类别，不接续成 rating 数值。
- 最小桶到最大桶展示完整 100 分序列；档位多时仅图表容器横向滚动，页面不横向溢出，建议每档至少 28px。
- 饼图使用环形，固定标签到颜色的映射，排序变化不改变同一标签颜色；unknown 用中性色。完整图例列出标签、题数、占比，最多约 300px 高后滚动，不合并“其他”，不做隐藏扇区或重新计算分母的图例开关。
- 0 个样本不绘图，显示明确空态；单类别 100% 使用完整圆环，不能依赖起终点重合的单段 SVG arc。中心可标“标签计数”及 total，不能误标“解题数”。
- 悬停、点击、键盘聚焦均可显示数值；Enter/Space 固定提示，Escape/点击外部关闭。图例和柱图的文字明细提供可访问的数值读法；tooltip 不超出容器。
- 标签、handle 等外部文字走 esc/textContent；不要插入未转义 HTML。缺失数值不能显示 NaN、Infinity。

状态处理：

| 状态 | 展示 |
| --- | --- |
| 未绑定 | 提示绑定并同步，不画零数据图 |
| historyComplete=false | 醒目标注“统计尚不完整”，已有部分结果可显示；零条也不声称账号从未 AC |
| ready 且完整，solvedTotal=0 | “已同步记录中暂无已解决题目” |
| queued/syncing 且已有完整历史 | 保留统计，标注正在更新及上次成功时间 |
| failed | 显示当前可用数据并注明“更新失败，统计可能不完整或过期” |
| 统计接口失败 | 卡片内提示加载失败/重试；不影响列表、成长曲线、训练场次 |

refresh 成功取 dashboard 后，学生端独立调用 loadProblemStats；它与 loadProblems 分别捕获错误。只在首次进入与既有刷新操作时请求，不增加自动轮询。翻页/切换题目状态仅更新列表，不修改统计。

保留旧图仅限同一个 bindingId；换绑或未绑定必须清除旧统计和 tooltip。如果统计接口失败且无法确认仍为同一绑定，清空旧图并展示失败提示，不能冒险保留前一个账号的图。

## 6. 建议实施顺序

1. 核对工作树，阅读现有 history 与统计函数测试；确认没有其他任务正在修改同一代码。
2. 提取全量去重逻辑、确定性资料选择和纯统计函数，复用 ratingHistogram/tagPie。先验证核心数据用例，不要改变列表现有返回字段与状态约定。
3. 实现服务批量查题库、状态返回、换绑保护，接入本人只读 API，补服务与权限测试。
4. 加学生卡片、两张 SVG 图、状态提示与数值交互，接入刷新；回归原列表和本地 Rating 曲线。
5. 更新 README 的学生主页说明，明确分母、Gym、数据时效和未知资料含义；运行测试并验证桌面/手机真实模板。
6. 提交交付摘要：修改文件、实际执行的检查、跳过检查及原因、残余限制。未经另行要求，不部署、不提交 git、不发布 Issue/PR。

## 7. 验收用例

以下均为构造测试数据，不是真实账号记录。

固定样本：A 题两次 AC、rating=1200、tags=[dp,math,dp]；B 题 AC 后 WA、rating=1400、tags=[math]；C 为 Gym AC、无 rating/标签；D 只有 WA。预期 solvedTotal=3；1200 桶=1、1400 桶=1、unrated=1，前端 1300 桶=0；math=2、dp=1、unknown=1，标签分母=4，对应 50%、25%、25%。

| 层次 | 必须验证 |
| --- | --- |
| 纯聚合 | 多次 AC 去重、WA→AC、AC→WA、无 AC 排除、非法身份过滤、index 大小写合并、不同 contest 分开、Gym 保留 |
| 资料 | 题库优先、字段分别回退、最新缺失时旧有效值可用、同时间按 id 决胜、打乱 records 顺序结果一致、重复/空白/非字符串标签 |
| 守恒 | 各 rating 桶+未评级=解题总数，标签分母正确，所有题都未知时成立，空输入成立 |
| 服务 | 超过 50 道 AC 仍全量统计、不逐题查库、不发远端请求、题库为空可用、当前绑定隔离、请求中换绑拒绝旧结果 |
| API | 登录 uid 固定、伪造 uid/handle 无法越权、跨域及未登录拒绝、只返回本人聚合资料 |
| UI | 0/1/多题、单标签 100%、全未评级、全无标签、很多档位/长标签、部分同步/失败、换绑、重复刷新过期响应、标签 HTML 字符作为文本显示 |
| 回归 | 列表分页和筛选不改变图表，本地 Rating 曲线和训练场次正常，教练端不渲染统计卡片 |

测试落点：扩展 test/history.test.js；核心统计可新增 test/problem-stats.test.js；service 可用现有 prototype+mock 风格验证绑定和批量查询；扩展 test/permissions.test.js 的 TrainingService mock 与路由断言。真实 Mongo 相关测试沿用 test/integration.test.js 临时数据库机制，不操作真实学生资料。

运行 `node --test test/core.test.js test/history.test.js test/permissions.test.js test/problem-stats.test.js`（只在新增文件实际存在后），再运行 `npm test`；报告真实通过/失败/skip 数量。Mongo/CF 环境未配置导致 skip，不等于通过真实集成测试。无远端交互变更，不要求为了这次图表强制调用 live CF。

浏览器使用真实模板和构造数据验证约 1280px 桌面与 375px 手机宽度，检查页面无横向溢出、仅柱图区必要时滚动、tooltip/点击/键盘、环形图与图例可读；如测试环境可用，再按 test/e2e/README.md 做独立测试域回归。不要把纯演示页截图写成真实学生验收。

## 8. 已知限制与方案完成标准

- 公开提交覆盖之外的题目、尚未同步的 AC、早期尚未刷新到的重测、无法识别身份的题目不保证统计到。
- 本地题库资料可过期；meta.syncedAt 只代表题库同步时间，不证明每道题均为 CF 最新资料。
- 不自动识别不同比赛编号的共用题；标签分布只说明练习记录，不能推断掌握程度。
- 按现有规模从本地读全量提交，暂不新增缓存；大账号耗时必须记录，若出现性能瓶颈再提出具体优化，不能用分页截断冒充全量。

本计划无需新 ADR：本次为可逆展示与统计扩展，尚无同时满足难以逆转、需解释背景、真实重大取舍的架构决定。实施验收以第 7 节为准；老师已确认的产品口径不得由执行 AI 静默替换。
