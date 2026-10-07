# 浏览器回归

## T10 完整候选验收

`release-environment.ps1` 只创建固定名 `cftrain-t10-hydro`、带 `cftrain.task=t10` 标签的独立容器，使用 `cftrain_test_t10_hydro_isolated` 库及 loopback 18888 端口；同名容器存在时拒绝创建。需已有 WSL Ubuntu、Docker `docker_default` 网络、`oj-mongo` 和本地 `docker-oj-backend` 镜像。不会部署到 `oj-backend`。请先核对独立库名没有用于其他工作。

```powershell
# SourceDirectory 指向已核验候选 tar 的全新解包目录。
.\test\e2e\release-environment.ps1 -Mode Setup -SourceDirectory <解包目录>
$env:CFTRAIN_ISOLATED_RELEASE='1'
node test/e2e/release.cjs
# 包内同一测试套件（运行于候选安装目录），包含真实临时 Mongo、CF 与运行时校验：
wsl -d Ubuntu -u root -e docker exec -e NODE_PATH=/usr/local/share/.config/yarn/global/node_modules -e CFTRAIN_TEST_MONGO_URL=mongodb://oj-mongo:27017 -e CFTRAIN_LIVE_TEST=1 -e CFTRAIN_DEPLOY_RUNTIME=1 -w /root/.hydro/addons/cf-training cftrain-t10-hydro sh -c 'node --test test/*.test.js'
wsl -d Ubuntu -u root -e docker exec -e NODE_PATH=/usr/local/share/.config/yarn/global/node_modules -e CFTRAIN_ISOLATED_DEPLOY=1 cftrain-t10-hydro node /root/.hydro/addons/cf-training/test/e2e/deployment.cjs
.\test\e2e\release-environment.ps1 -Mode Cleanup
```

`release.cjs` 使用六个临时身份，覆盖普通学生、教练、无本班授权教练、受托学生管理员、所有者、域管理员及权限撤销。覆盖实际切班、跨域、CSRF、组赛/替换/改期/取消、发布/赛前隐藏/签到、队列完整同步、证据留存/纠正、预览版本检查、结算/防重/撤销重测、换绑/统计/导出，以及实际 PM2 重启后同步恢复和 30 个并发 HTTP 读取。直接检查学生原始 JSON；页面 JS 错误使测试失败。`release-fixture.cjs` 仅由隔离环境另行启用，限定固定测试库及显式环境变量，用独立 addon 注入合成 CF 响应和受随机凭据保护的时间/角色控制；候选插件不自动启用此 addon，运行模块保持原样。角色撤销在服务器进程通过 Hydro DomainModel 执行，不借助 CLI 的跨进程缓存通知来推断权限结果。

脚本每次重置此隔离域的合成训练数据，不能针对正式库运行。临时凭据保存在 `.test-output/release-session.json`，不输出密码；Cleanup 校验容器标签与库名，停止独立服务、删除整个独立库和容器（含其临时账号/会话/备份）及本地凭据。失败时也必须运行 Cleanup。没有真实学生参与；试训记录见 [release-trial](../../docs/release-trial.md)。

`node test/bench-rating.cjs` 另作 10 场 × 100 人 × 20,946 人参照池的构造结果对照与事件循环基准。它与 30 请求的 HTTP 检查分别记录，不能合称真实大班长期负载验收。

部署恢复专项见 [部署与恢复](../../docs/deployment-recovery.md)。`deployment.cjs` 是只用于**独立 Hydro 容器**的 Node HTTP/PM2 演练，要求 `CFTRAIN_ISOLATED_DEPLOY=1`、独立 `cftrain_test_*` Hydro 库；它故意注入插件加载/模板失败、重启和回退，不能在现有正式实例运行。配套 `test/deployment.test.js` 覆盖临时目录故障和其他 addon 保护，`test/database-recovery.test.js` 在独立库校验六集合、索引、BSON 类型及 T01—T08 字段恢复。T09 通过不等于 T10 全业务 HTTP 验收。

无需 Hydro 的模板回归（本机需安装 Edge，Node 可加载 `playwright`）：

```sh
node test/e2e/ui.cjs
node test/e2e/classes.cjs
node test/e2e/discovery.cjs
node test/e2e/exposure.cjs
node test/e2e/student-response.cjs
node test/e2e/draft-lifecycle.cjs
node test/e2e/run-race.cjs
```

此测试渲染插件真实模板，以拦截的构造 API 数据检查列表慢请求隔离、分类响应乱序、换绑清理、柱图/环图、键盘提示、桌面/手机布局、手动标记删除和班级删除。不访问真实账号或数据库，不能替代下面的 Hydro 集成回归。

T08 的 `ui.cjs` 检查“有效训练历史最高”卡片、撤销后可能下降的说明与无有效结算时的固定起点，并沿用桌面/375px 布局检查。`node --test test/rating-peak.test.js` 将真实 worker/cache 重放结果送入生产统计渲染函数，覆盖撤销早期结算、后续成绩重算、重新结算、冷/热缓存与初始化；另用构造的 1400 → 1500 → 撤销场景验证产品口径 A。

T03 另验证学生与教练的 Rating 计算中、失败、恢复状态；计算期间不展示旧曲线或误报为空历史。API 的主页、班级榜和预览现在可能返回 `ratingStatus: computing / busy / failed`，完成为 `ready`；未完成的预览 `token` 为 `null`，应稍后再次预览，不可直接确认。导出未完成时返回明确错误，稍后重试。`browser.cjs` 已按此契约等待 ready，构造小参照池最多等待 15 秒；本次只核对脚本语法，真实 HTTP 候选流程仍待 T10。其他客户端也不能假定首次请求已完成评分；评分本身和确认令牌校验由 worker/Mongo 回归覆盖。

`classes.cjs` 另覆盖已有班级编辑、多班级批量添加、学生受托管理入口、切班记忆、班级榜乱序响应隔离、转让接收及手机布局；班级写入使用实际班级模块，页面数据为构造数据。截图输出为 `.test-output/classes-coach.png` 和 `.test-output/classes-mobile.png`。

`discovery.cjs` 覆盖教练选赛的切班清理、搜索和翻页请求绑定当前班级、草稿创建班级、慢旧请求成功或失败不覆盖新结果、刷新后名单或权限变化及无可管理班级提示；用真实模板与构造响应检查桌面和 375px 手机布局，不访问 Hydro 数据库。

`exposure.cjs` 在 375px 宽度使用真实模板和构造响应，检查教练选择具体接触证据、理由必填、审计文字转义、已纠正项禁用和已结算训练锁定。权限、资格、旧 token、撤销重结算及同步持久化另由 `permissions.test.js`、`exposure-evidence.test.js` 覆盖。纠正 API 为教练专用 POST `correct_exposure`，参数为 `id`、`uid`、`evidenceIds` 数组和非空 `reason`（最长 500 字符）；操作者取登录身份，客户端不能指定。

`student-response.cjs` 用生产 `studentRunResponse` 投影构造数据，再送入真实学生模板，验证赛前隐藏、签到按钮、赛中实际题目链接、榜单和结算后显示。`permissions.test.js` 在实际路由上检查序列化后的 JSON，覆盖顶层、run、slot、actual、榜单行和逐题嵌套字段，已结算使用真实 service 的冻结快照分支；验证伪造 uid、跨域、草稿、非成员及受托管理员边界。仅本人收到资格原因与同步说明，教练诊断与纠正响应保留。以上不是已安装候选版本的真实 Hydro HTTP 验收。

`run-race.cjs` 用真实模板与构造响应重放训练详情请求乱序，确认迟到详情不覆盖当前画面，取消操作仍指向实际渲染的比赛。

`draft-lifecycle.cjs` 在 375px 宽度用真实模板与构造响应检查过期草稿改期、发布按钮恢复、取消确认与保留记录详情。API 权限、状态和审计由 `permissions.test.js` 覆盖；Mongo 并发与换绑由 `draft-lifecycle.test.js` 覆盖。取消与改期是教练专用 POST `cancel_draft`、`reschedule_draft`（`id`，改期另传未来 `startAt`）；构造模板测试不等于已安装候选版本的 HTTP 验收。

只在获准测试的 Hydro 上运行。脚本将创建两个临时账号和一个 `cftrain-e2e-*` 域，使用明确标为 `AUTOMATED TEST FIXTURE` 的合成比赛，不向 CF 提交代码。

插件先安装到 `/root/.hydro/addons/cf-training`。在 WSL 中：

```sh
docker exec oj-backend hydrooj cli execute "return await require('/root/.hydro/addons/cf-training/test/e2e/bootstrap.cjs')();"
docker exec oj-backend hydrooj cli execute "return await require('/root/.hydro/addons/cf-training/test/e2e/seed.cjs')();"
```

`bootstrap.cjs` 把临时凭据写入容器 `/tmp/cf-training-e2e.json`，不会打印密码。将它复制到本插件的 `.test-output/session.json`，或用 `CFTRAIN_E2E_CONFIG` 指定其本地路径。该文件已在 `.gitignore` 排除，不应提交到版本库。`seed.cjs` 使用构造 CF 响应完成一次赛后全窗口扫描，使结算回归具备真实扫描路径生成的覆盖证明；它不请求远端 CF。

在 Windows 上使用已安装的 Edge 和可加载 `playwright` 的 Node 环境运行：

```sh
node test/e2e/browser.cjs
```

脚本连接 `http://127.0.0.1`，测试权限/CSRF/跨域参数注入、建班与删班、学生题目分类、解题统计与两张图、本人手动题目/比赛标记删除、换题、发布、赛前隐藏、签到、评分预览、结算防重、撤销，并输出两张截图至 `.test-output/`。后台异步任务和真实 API 分别由 integration 和 live-cf 测试覆盖。

重跑浏览器测试前先重跑 `seed.cjs`，它只重置该测试域及指定合成数据。测试不要长期搁置，否则普通后台同步会尝试验证合成 handle。完成后必须清理：

```sh
docker exec oj-backend hydrooj cli execute "return await require('/root/.hydro/addons/cf-training/test/e2e/cleanup.cjs')();"
```

清理脚本核对测试域格式及两个账号的 ID、用户名、测试邮箱，再删除这两个临时账号、会话、测试域和合成档案。最后删除本地 `.test-output/session.json`。保留截图可用于人工检查布局；测试日志中的合成分数不代表真实学生表现。
