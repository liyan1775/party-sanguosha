# 正式无名杀适配

v0.7.9接入层审查补丁：玩家序列化与公开记录共用publicCardVisible；补齐直接判定、公开获得／置于武将牌、批次置牌及虚拟装备的首次同步和恢复。公开放置记录只在同一拥有者x区域有效，私人再次放置／原生清除知情者撤销；虚拟显示牌只在对应原生渲染广播中授权，blankCard除外。定向消息的无主材料仅限显式参数，不扩散到父事件或storage；补齐shenhua:guhuo_guess的质疑保密及翻牌，原生技能、知情者、AI和入站卡牌保护保持。见ADR-039。

原生广播创建的仍打开公开牌池在reinit确认后按原videoId和当前剩余按钮恢复，再重发原选择；不延长期限，私人／暗置／已关闭弹窗不重建。`ENGINE_VERIFY_ADAPTER_AUDIT=1 npm run engine:verify:table`独立三真人真实选将／发牌后，验证直接判定、公开交牌、单人／批次置牌、虚拟装备、其余手牌隐私、三端刷新、公开展示池及五谷丰登剩余牌池恢复／关闭。原生无懈请求用真实UI取消，取牌仍由原生规则执行；夹具不等于自然整局或微信真机。可加ENGINE_VERIFY_DESKTOP=1或ENGINE_VERIFY_HTTP=1；ENGINE_VERIFY_TABLE_BLUFF=re_yuji复核时光场另一版蛊惑，值1仍验证旧于吉。

v0.7.9蒲元显示补丁：公开equip事件的显式cards材料在移入ui.special、知情者被原生lose清除后仍公开，首次addVirtualEquip广播正确重建装备牌面并移除未知牌遮罩。只覆盖明确visible=true的装备材料，其他手牌／私人排序及预编码事件继续过滤；原生技能和牌堆保持。

`ENGINE_VERIFY_TABLE_PUYUAN=1 npm run engine:verify:table`在独立服务真实选将／发牌后触发原生phaseBefore及奇思，检查本人／对手首次装备文字与遮罩、恢复前后相同、后续直接装备及其余手牌隐私。首次检查前不刷新玩家页面；未注入牌堆或装备材料。可加ENGINE_VERIFY_DESKTOP=1或ENGINE_VERIFY_HTTP=1，仍属桌面Edge／手机视口与合成触摸，不代表微信真机验收。

v0.7.7使用96将进阶白名单，完整保留原72将；OL档保留v0.7.6已确认的完整原生张绣特例与mobile:re_xusheng，共92将。斗地主所有档位地主10／农民6候选，AI选将使用上游联机Math.random评分，用牌／技能AI不变。所有档位slow、基础delay1000ms。experience能力启用public-summary.js，将已经过滤的身份余量与最近三条有效公开动作发给手机，重连补发原摘要；工具条主动托管／恢复手动仍复用原Client认证的auto／unauto。

公开GET／HEAD /engine/observe/:id?room=房号仅提供同房当前ObserverState／ObserverJournal，晚加入者不入座、不创建原生客户端。暗手牌、未公开身份、私人选择、storage、setup与通道凭据不进入公开API。曹冲装备材料的原生声明filter以数据重建；可见多人弃牌只公开原lose_list明示的弃牌，其他手牌保持隐藏。重铸的recast在移牌前日志公开本次显式材料，新摸牌与其余手牌仍隐藏。新增法正的眩惑仅在原生目标闭包与固定版本完全匹配时携带唯一指定玩家，手机重建该过滤、刷新复用原请求／期限，worker仍执行原生闭包规则。牌堆子节点变化后同步实际整数余量，修复首次发牌缺少最终update的问题，不输出牌堆内容／顺序。见ADR-035与ADR-036。

`ENGINE_VERIFY_FEEDBACK_DASHBOARD=1 ENGINE_VERIFY_IDENTITY_SEATS=8 ENGINE_VERIFY_RECONNECT=1 npm run engine:verify:rooms`在独立真实四模式对局中检查晚加入公开观战／刷新、不占席位、身份人数、本人主动托管与手动恢复，并继续原生AI自然结算。`node --import tsx scripts/verify-native-cards-feedback.mjs`在真实选将／发牌后构造原生技能材料，定向检查仁心手牌／装备合法性、取消／刷新／最终发动、首次发牌计数、魄袭明牌弃置及铁索真实重铸／三端日志与新摸牌隐私；可加ENGINE_VERIFY_HTTP=1或ENGINE_VERIFY_DESKTOP=1。夹具准备、桌面触摸／鼠标和真机验收分别记录，不连接正式实例。

`node --import tsx scripts/verify-native-expansion.mjs`在完整96池独立四真人2v2真实选将／发牌后补已知材料，验证法正眩惑出杀／拒绝、原闭包失败复现、手机唯一目标与刷新期限且worker规则保持；界徐盛盲选暂扣／装备选择／返还，以及虞翻私人排序请求／公开直言。已确认的有限置顶材料按原生日志公告，不导出额外牌堆或未公开顺序。夹具满足原生距离并用真实UI处理可选后续，不替代自然整局或微信真机。

`node --import tsx scripts/verify-native-ai-lord.mjs`使用隔离随机端口服务与完整生产池，为当前96进阶／OL92各观察四次八席AI主公真实选将和发牌，检查合法、非固定首候选与不同结果。真人随机成为主公的样本正常发牌但不计AI样本；不改座次、身份、候选或评分。只保存聚合结果，私有候选和手牌不写日志；整局自然结算由另一套四模式验证覆盖。

v0.7.4手机增加实际牌堆余量与本局公开记录，GET /engine/history/:id每次校验原大厅真人席位，只提供ObserverJournal的公开文本及整数余量，不开放私人选择；v0.7.5公开观战使用上述独立只读API。资料入口强制只读，正确关闭介绍poplayer；游戏配置与入站卡牌保护仍在独立权限边界内。

新setup.ruleRecovery启用rule-socket.js，同一iframe私有nonce绑定本机规则及时钟线路；短断线最多20秒恢复同一个worker。Node保留原时钟期限及尚未确认的到期ID，worker重复单次ID仅确认、不重复执行；旧协议不发送ack。恢复逐席重建私有视图，原选择期限不续期。执行实例丢失、异常或超时明确中断，无胜负且须主动回房，不能刷新worker冒充续局。旧Node未声明此能力时不载入新模块；完整启用需无游戏时正式停启，等待房也会被重启清空。

`npm run engine:verify:records`使用独立四真人2v2，真实选将／发牌后隔离执行神吕蒙原生phaseDraw，实际点击涉猎，检查公开五牌回看／刷新、资料阅读、同实例双线路短断线、原选择期限、实际20秒超时与主动回房。ENGINE_VERIFY_HTTP=1覆盖HTTP，ENGINE_VERIFY_DESKTOP=1使用鼠标；该定向夹具不代替自然整局或微信真机验收。

v0.7.2新增surrender.js，按Node声明的surrender能力启用。单挑本人认输，斗地主／2v2本方存活真人全票认输，身份局全体真人（含阵亡）同意后不判胜负结束。闭包保存30秒投票、epoch、同意集合及60秒发起冷却，检查当前本人Client；AI不投票，托管和断线的真人不会被自动同意。旧个人死亡型giveup被禁用，投票不暂停回合；未通过、拒绝或真人队友变化取消。设计见ADR-032，产品规则见docs/product.md。

通过后设置本局权威checkOnlineResult并调用原生game.over，不伪造死亡或改牌／体力。原生结束展示材料仅保存在本局私有闭包，确认reinited后仍经privacy.js重发原生结果方法与材料，解决已结束刷新只见牌桌的问题；不重新计算胜负，不进入大厅／观战快照或普通日志。房主回房释放材料和旧局，普通成员可先回房保留席位。

`npm run engine:verify:surrender`在独立服务执行真实选将、起手手气卡阶段完成后的实际投票、原生结算、结束刷新和全桌回房；默认覆盖四模式全部真人。设置ENGINE_VERIFY_HTTP=1验证HTTP，ENGINE_VERIFY_HUMANS=1验证真人与AI，ENGINE_VERIFY_MODES可筛选模式。输出只含聚合结果和截图，测试中不改HP、牌、身份、胜者或原生AI；手机视口／触屏是桌面验证，不代表微信真机验收。

v0.7.1由connection-recovery.js处理20秒普通断线缓冲、原生reinited后的本人控制状态和手动接管；player-transport.js以同一游戏通道的partyPing／partyPong替代网页健康作为原生连接证据。原选择截止时间保持，强制关闭不缓冲；旧socket重复关闭幂等。手机外层持续锁住旧画面，权威重建完成才解锁，恢复提示中断时长与AI可能已行动。新能力由Node显式声明，旧运行服务不会误读新命令。

luck-cards.js在起手后、首回合前为真人提供3次免费整手刷新和共同30秒期限；AI保持原牌。worker私有状态按epoch／revision／本人Client验证并去重，重连只恢复剩余额度及原期限；原牌在仍私有时移除，清理知情标记后随机回堆，保留实体总数／起手数量，不触发弃牌技能。emotions.js给原生四种交互菜单提供小型内联SVG、原音效与移动画布坐标，无额外图片下载；合法目标与限流由worker复核。设计见ADR-031。

`ENGINE_VERIFY_EXPERIENCE=1 ENGINE_VERIFY_MODES=duel ENGINE_VERIFY_HUMANS=2 npm run engine:verify:rooms`在独立Chromium服务通过实际手气卡按钮、静默下行丢包、22秒浏览器离线、同席恢复、托管／手动接管及原生触屏菜单的鲜花／鸡蛋广播验证。可组合HTTP或本机公网代理，禁止指向正式实例；输出只含聚合结果和测试截图，牌值比较留在私有浏览器内存。它是桌面手机视口，不表示微信真机验收。

2026-10-09 技能修复：首次逐席初始化同步规则宿主的公开 lib.inpile / lib.inpile_nature，避免建堆广播早于手机连接导致威临等转化选项为空。手机仅自动提交 chooseButton 技能的无材料导航结果；电脑运行原生选项工厂及动态规则，不接收手机 `_sendskill` 代码/定义。Dialog 声明操作和已选分支随原私有请求恢复，手机用同版本工厂保留显示过滤的闭包；实际选项、材料、目标与用牌仍需确认，取消重选与电脑 AI 保持原生。未修改固定上游、武将技能或隐私过滤，见 ADR-030。

`npm run engine:verify:skills` 使用独立四真人原生夹具，真实选将发牌后暂停自然回合，补已知材料、炁标签与原生技能状态，验证威临火杀／酒／次数限制／取消重选、罡拳两分支／相邻目标及奇策全手牌、观骨控制选项、智绝颜色闭包。实际触屏选择、最终发动、刷新原期限与暗牌分别断言。可加 `ENGINE_VERIFY_HTTP=1` 检查原 HTTP 通道，结果位于 `.runtime/native-skills`；夹具准备不代表自然整局，桌面触屏不代表微信真机。`engine:check-definitions` 同时输出 `.runtime/native-interaction-audit.json`，列出全八档的静态牌种依赖、选项入口与关联武将，不证明所有动态技能已验收。

2026-10-08后台计时修复：setup.ruleClock只在电脑worker启用；bootstrap在引擎／沙箱前安装rule-clock.js，经认证本机WebSocket将原定时期限交给Node的RuleClock。回调与参数不出本房内存，手机保持原生计时。后台／最小化的普通计时限制不再把AI等待拖为分钟；保留原生AI与既定速度，连接中断报告该局失败。新协议需正式服务停启，旧运行Node没有标记时跳过，不清空既有房间来强制升级。

设置 `ENGINE_VERIFY_BACKGROUND=1` 运行 `npm run engine:verify:rooms` 可在Windows隔离Edge中检查后台对局。使用真实hidden页面、官方十秒宽限测试参数与普通后台策略，不开启Playwright默认的焦点／计时豁免；每模式保持后台至少35秒，再核对200ms原生回调与自然结算。父页面未改的计时器作为受限制对照。Node轮询只观察条件，不改变原生代码、计时或可见性；结果分别记录后台策略和手机模拟边界。此选项禁止连接正式已有服务。

2026-10-08修复旧版iPhone WebKit牌桌第5步的三元表达式语法错误：mode.start改为等价的命名async表达式，使原生AsyncCompiler正确识别；browser-compatibility.js在合并入口先于引擎执行，仅补缺失的Promise、分组、集合与历史迭代器接口。上游源码、原生技能／AI、隐私过滤与入站引用保护保持。WebKit17.4与26.6的独立双真人OL全民斗地主完成真实选将／发牌、刷新与自然结算，17.4另完成同房第二局；真机iPhone微信仍待复测，详见docs/handoff.md。

设置 `ENGINE_VERIFY_PLAYER_BROWSER=webkit` 后运行 `npm run engine:verify:rooms` 可让手机端使用已安装的Playwright WebKit，电脑规则宿主仍为Edge；默认仍为Chromium。Windows WebKit音频与CDP下滑手势不计通过，结果记录真实版本与限制。`ENGINE_VERIFY_WEBKIT_MODULE` 接受另一个已安装Playwright的入口file URL；17.4对应Playwright1.42.1。旧评估工具需要同时设置 `ENGINE_VERIFY_WEBKIT_LEGACY_EVAL=1` 与 `ENGINE_VERIFY_CACHE=1`，仅对隔离服务手机文档取消CSP用于评估，禁止指向正式实例及预加载／缓存通过断言；不改变实际产品CSP或脚本。该版本不进入项目依赖，测试工具不得注入兼容实现或改写游戏代码。

v0.7.0 新增六档官方活动将池，完整公告与平台版本映射见docs/official-rosters.md。official-rosters.json保存原名单与缺项依据，engine:update-official-rosters只从已审查ID生成白名单及共享元数据，不做同名匹配。新增档位沿用现有四模式、军争160张及身份10/6候选，固定上游与原生角色/技能不变。

当前图鉴660条档位记录、396个独立原生ID；派生小图含10张原生形态图共406张，4086项固定素材。图鉴按档位读取，setup按本局白名单及其portraitVariants发送头像/别名，audioFilesByPreset只传本档音频目录；基本语音小量预热，其余按需读取。新增其他将池保留已有头像URL，标准档仍只加载原四个角色依赖包与标准牌包。

新增将池的维护顺序：审查完整官方公告与本平台技能 → 更新official-rosters.json → engine:update-official-rosters → node scripts/update-native-assets.mjs → engine:update-audio / engine:update-catalog → engine:prepare → build / check / test:browser / test:engine-api → 独立真实原生对局。形态立绘从固定characterSubstitute和技能changeSkin静态收集，仅提供素材，不进入选将白名单。下载原件按固定Git blob核验，Unicode图片使用安全ASCII派生文件名。原生规则、技能、私有序列化或原生AI没有自定义替代。

v0.6.9 四模式统一按档位使用牌堆：标准27将为standard108张，经典进阶48将为standard＋extra、去muniu的160张。config/roster-presets.json的cardPile与definitionPacks分开，start冻结整档，card-pile.js在原生构造实体牌之前校验/排除；不覆盖卡牌/技能或模式规则。status/setup.cardPilePolicy声明实际服务能力，旧Node无标记时继续108，完整切换需无人对局时停启。完整目录与牌种张数见docs/noname-card-piles.md，设计见ADR-027。

`npm run engine:verify:military` 使用独立服务与桌面Edge手机视口，固定四名原生候选并补已知材料/判定顶牌，验证火攻双方选择刷新与原期限、公开展示/其余牌隐藏、酒杀加伤、铁索连环/雷伤/重铸、藤甲、白银及兵粮两种判定。它调用真实原生事件，不合成卡牌效果，但不是随机自然整局或微信真机验收。常规engine:verify:rooms仍不改牌堆、伤害或胜者，并只输出原模板的聚合计数。火攻弃牌时刷新会重建仍打开且已知的单张展示牌，沿用原videoId和关闭流程。

v0.6.3 默认手机恢复 `/engine/player/:match` 的固定无名杀原生 UI、选将、技能操作与动画；保留全部既有适配修复、原网络通道及扫码大厅。电脑只需规则 worker，默认不再创建席位镜像。原生结算控件增加全员「回到房间」，外层保持房主/成员权限分工。主页/待机房间恢复低优先级原生公共素材预加载，小图/字体/体力与缓存优化继续使用。以下 v0.6.0–v0.6.2 轻量方案保留作研究和显式回归，默认决策以 ADR-022 为准。

selection-recovery.js 也保存对局中的原生 GameEvent.send 请求，短断线/刷新后经同席位 reinited 重发原回调/参数/编码父事件与技能原材料，不重建事件或重复 wait/pause。重放仍走 privacy.js 的原选择授权与逐接收者过滤；提交/超时清理，长断线不延长截止时间。化身的独立 videoId 私人弹窗保留原生创建/更新顺序，按 8 弹窗/16 帧限制，原关闭命令清理；不捕获广播或读取 storage。默认原生验证器不设置特殊客户端开关；旧轻量验证器才显式设置 party_lightweight_verification。

`ENGINE_VERIFY_PRIVATE=poxi ENGINE_VERIFY_PRESET=advanced ENGINE_VERIFY_MODES=doudizhu ENGINE_VERIFY_HUMANS=3` 验证原生魄袭材料分行、四花色、确认、刷新/原期限与旁人/公开观战隐私；`gongxin-discard` / `gongxin-top` 配进阶双真人单挑验证两分支，可与 HTTP/本机公网代理组合。只在测试路由固定候选和首座、补少量必要材料，不合成技能结果、伤害或胜者。自然结算后还检查原生胜负界面、成员先回房、房主回房和第二局。

`ENGINE_VERIFY_NEWER_HOST=1` 将测试电脑 footer 标为较新的构建，核对当前 worker 不因服务版本较旧而倒退重载；真实默认客户端仍需通过选将/发牌、重连和结算。选将验证器在真实选择暂停后断线，另核对势力选择与选将的原计时器均不被重连替换。

v0.6.2 的 `table-presentation.js` 仅由规则 worker 的 `setup.tablePresentation` 显式启用，记录原生公开 use/respond、摸/弃牌、伤害/浮字、技能、回合和阵亡。逐真人接收者投影授权牌面，不读手牌/牌堆/storage，不带实体 ID；声明事件经本机席位镜像的 `table-projection.js` 与 Node 字段白名单进入私有 TableState，最多 32 条。手机 `table-motion.ts` 用代码实现飞牌、指向、浮字和光环，保持稳定节点；首次快照、重连和后台不补播旧动作。原规则、原生动画方法、privacy.js、公开观察者及入站卡牌保护保持，细节见 ADR-021。

真实轻量验证同时检查每个席位收到原生 use/draw/turn 并实际开始表现，不将占位页面动画当作引擎验证。`LIGHT_VERIFY_MODE=identity LIGHT_VERIFY_SEATS=8 LIGHT_VERIFY_HUMANS=8 LIGHT_VERIFY_ADVANCED=1` 覆盖八个独立席位进阶局；`LIGHT_VERIFY_PRIVATE=poxi` 配三真人斗地主验证魄袭分组/四花色/确认/刷新与旁人隐私；`gongxin-discard` / `gongxin-top` 配进阶单挑覆盖攻心两个分支。`LIGHT_VERIFY_MOVE=1` 配单挑验证观星排序与跨区。候选、座次及测试材料只在验证器注入，不改变产品规则或素材协议；结果使用时间和进程号目录避免并行覆盖。

v0.6.0 默认手机轻量牌桌位于 `apps/web/src/table-client.ts`，只载入 HTML/CSS/SVG、当前头像/插画与按需音效。规则仍为本机单一 worker；本机每真人一个 `/engine/view` 席位镜像使用固定引擎的选择逻辑，收到的消息先经 `privacy.js`，`table-projection.js` 再生成声明式私有席位状态和短期操作 ID。镜像 API/套接字仅规则宿主本机 cookie 可访问，手机通道按原大厅 cookie 认证，复用 WebSocket/HTTP/RTC/持续推送及去重，不传原生代码或事件。电脑增加内存负担，复杂自定义 UI/多房容量需单独覆盖，细节见架构 ADR-019。

真人关闭原生自动确认与 frequent 技能自动接受，先选牌/目标再点使用，洛神可取消；不改锁定技能、原生 AI 或规则定义。结算后所有真人有牌桌内回房按钮，只有房主实际释放旧局并重置准备。`npm run engine:verify:lightweight` 运行独立服务验证默认轻量流程；`LIGHT_VERIFY_MODE=duel` 单模式，`LIGHT_VERIFY_TARGETED=1` 固定甄姬/曹操候选和座次并准备牌/受伤状态，定向验证洛神、装备、锦囊、桃与杀的显式确认，不能当作随机发牌或微信真机验收。`LIGHT_VERIFY_HTTP=1` 强制 HTTP；`LIGHT_VERIFY_PUBLIC=1` 走独立本机公网代理，仍不是实际运营商网络。

v0.5.2 增加 `selection-recovery.js`：规则 worker 保存启动中未完成的原生按钮请求，断线保留原计时器，收到同席位 reinited 后才重发。真实结果或超时清除，已提交选择不再弹出，选将与神将势力选择沿用原候选；超时由原生 chooseButton AI 完成，单个自动事件禁止再请求晚到客户端。原隐私序列化和入站卡牌保护继续使用。新模块仅 setup.selectionRecovery 显式启用，完整切换需停启服务。

公开记录改从原生 game.log 的发布点收集，保留阶段、数量、技能、虚拟/实体用牌及目标、伤害/回复、判定、弃牌与死亡等原生已记录的公开过程；暗牌/私人 ordering、其他对象、选择参数/storage 不透传。连接和托管变化另外记录。规则预览 32 条、每条最多 500 字符，每 32 条主动发送，牌桌每 500ms 变化时更新；Node 按序号去重，每局内存最多 10000 条，本机日志接口分页 100 条，前端补齐轮询遗漏的中间记录。上限明确提示，回房或释放时清空，不是持久化回放或完整动画转播；新增扩展仍需验证其公开字符串语义。

v0.5.1 的局域网入口直接使用本机素材和 WebSocket，不依赖临时公网；公网持续推送连续发送有序动作，不逐条等待前一 ACK，中断按序重试、服务端去重。HTTP/RTC 保持串行。诊断上报每 8 秒一次或线路变化时更新，单请求有超时且不并发堆积。`ENGINE_VERIFY_LOCAL_BRIDGE=1 ENGINE_VERIFY_HUMANS=5 ENGINE_VERIFY_MODES=identity ENGINE_VERIFY_LAN_PLAYERS=4 ENGINE_VERIFY_PUBLIC_DROP=1` 在桌面上验证四 LAN 加一公网代理同桌、真实切断/恢复代理及 LAN 原生操作持续；不等于物理 Wi-Fi/iPhone 测试。

开局期间手机早于规则 iframe 的认证消息暂存于 match 私有内存，规则连接后先 connect 再交付，当前连接身份必须仍匹配；最多 512 条/4MiB，失败/释放清空，旧连接消息丢弃。`ENGINE_VERIFY_DELAY_WORKER_MS=4000` 可在真实对局测试中延迟规则页 HTML，覆盖这一载入次序；范围 0–10000ms，不能与 CACHE 组合。

玩家启动完成后的全局异常触发外层同座位重连；工具条提供「恢复牌桌」。房间已结束但原生 UI 尚未结束时，延迟两秒自动同步一次，保留正常的原生结算画面。恢复只重建玩家 iframe，并沿用认证、隐私过滤和原 match；不修改规则宿主或胜负。

`observer.js` 使用显式公开字段与公开日志投影，仅本机控制台读取；不使用原生序列化快照作为观察者数据，不读暗手牌牌面、牌堆、私人选择或 storage。当前专门的公开牌桌视图不含完整原生动画及特殊技能标记。

公网 PlayerTransport 在同一 PollChannel 上尝试有确认的 WebSocket 持续推送，失败回 HTTP；RTC 同通道接管，不重入座或重复动作。公共 STUN 允许合法 UDP 公网候选、保留私网候选，无 TURN，不保证全部 NAT 穿透。`ENGINE_VERIFY_STREAM_DROP=1` 主动关闭推送并检查原通道继续，`ENGINE_VERIFY_NO_RTC=1` 复核公网路径。`npm run test:engine-api` 强制要求完整固定资源；纯源码常规检查明确跳过完整预加载资源清单一项。

固定基线：libnoname/noname v1.11.6，commit 与核心包校验见 `config/noname-candidate.json`。`lab` 保留基础研究程序，正式服务不复用其无授权转发端点。

## 运行职责

- `src/service.ts` 管理每房独立 match、认证 WebSocket、资源白名单与启动/结束通知。
- 电脑 `/server` 通过仅回环可用的事件流接收任务变化、创建隔离 iframe，服务器每 8 秒保活；旧服务器回退每 2 秒查询。宿主 cookie 仅回环、HttpOnly，不赋予房主权限。
- 玩家 `/join/房号` 保留大厅 SSE，选将/对局 iframe 按房间 cookie 取得本人身份；不能指定别人的玩家 ID 或使用其他房间。
- `bootstrap.js` 启动已编译 JS，普通 LAN HTTP 无需 Service Worker/HTTPS；配置与扩展由电脑提供。
- 入口与外层房间页显示六步载入进度、已完成资源数、载入量（含缓存）和耗时；动态导入失败可手动重试，两分钟载入检查不清空存储。固定引擎与兼容模块共361个构建输入合并为同一个 ESM 单例，主体 gzip 为约 1.97MiB，内容哈希 URL 允许缓存；动态包仍共享该单例。package.js 仅枚举该武将档需要的定义包，不扩大选将或牌堆。
- `mode.js` 适配座位、身份、选将、武将档与发牌，复用上游牌、技能、回合、死亡、AI 和胜负；规则宿主是脱离参赛数组的 Player 视点。
- `privacy.js` 在原生 Client.send 序列化期间设置接收者，保留自己的牌、已公开牌、技能授权可知的牌；暗牌只发送 ID/占位值，提前编码的事件父链和原始元组也再次过滤。身份局 getState/重连快照过滤未公开身份。
- `relay.js` 入站物理卡牌只按现有 ID 解析，忽略客户端提供的牌名/点数/花色；`controls.js` 用 textContent 渲染昵称并关闭原生房间管理/更新/牌堆入口。
- 固定画布采用 overflow:clip，避免浏览器选将时滚动整个画布导致头像/手牌裁切；手牌与弹窗保留各自的滚动。自动化检查手机横屏中所有参赛头像位于可视范围。
- 微信竖屏默认旋转外层横向牌桌；方向按钮和尺寸变化保留 iframe。公开出牌在离开手牌前按事件材料识别，ordering 中的观星继续私有；占位牌以牌背显示。
- 身份阵亡适配显式发送公开身份并修正死亡标记；五谷丰登只公开 native useCard 的 wuguShownCards，涯角只公开 reyajiao 的翻牌，不扩大其他 ordering 的权限。
- 新手档为 slow、duration=1000ms，在 loadConfig 重设 duration 之后应用；进阶档 fast/500ms。电脑与手机使用相同节奏，AI 原生决策不变。
- audio.js 由真实手机触摸解锁 Web Audio，按需播放已校验的本地原生卡牌/技能/阵亡音效；对局工具条可静音，电脑不播放，音效不阻塞载入。原生菜单回调不可恢复，下滑设置与快捷入口关闭。
- v0.4.1 主页与 waiting 房间通过 `/engine/preload` 取得当前档/模式的公共静态清单，以低优先级逐项读取完整响应，由浏览器缓存复用；后台暂停、开局停止发起新请求，不执行引擎或播放声音。资源 URL 使用上游 commit/构建哈希，支持异步 gzip/Brotli、并发去重与压缩后 64MiB 缓存上限。
- `scripts/build-native-portraits.mjs` 对已验证原图生成 256px WebP 小图，189 张总量约 3.1MiB，源图约 34.1MiB 保留；服务验证派生 SHA-256 后供选将与牌桌使用。构建变换去掉进阶状态计数额外注册的大日文字体。
- `prompts.js` 在 GameEvent.send 前同步最终提示、补充说明、分支和目标标签，保留动态、自定义和关闭提示；南蛮/万箭/决斗根据最终过滤与每次选择数量补全杀/闪，原生连续响应总数保留。乱武区分最近合法目标、失去体力与结束时可选额外杀；界挑衅明确造成伤害条件，界明策明确虚拟杀与双方摸牌。拼点材料仅在 `$compare`/`$compareMultiple` 原生展示开始后公开，选择阶段仍隐藏。
- HTTP 长轮询首帧后留 12ms 合批相邻帧，MessageChannel 保持逐帧 Promise/观察器顺序并避免嵌套计时器等待。v0.4.2 提交 result 后超过 350ms 才展示等待提示，明确覆盖上游 div 的 hidden 样式，收包/确认后收起。语音抑制载入、后台与积压事件，fetch/decode 超过 1.5 秒跳过，静音后不补播，最多两段同时播放；启动完成才预热基本牌。
- v0.4.2 公网玩家直接使用有序 HTTP 通道，等待房间时与电脑建立无 STUN/TURN、无媒体的局域网 RTC 数据通道；电脑仅可转发原生 poll 与轻量 ping，私有授权仅在本机 jobs 流中交给电脑。每个 relay 请求仍验证宿主 cookie、当前房间/真人席位，privacy.js 和 relay.js 原保护保持不变。直连与公网复用通道/序号，失去直连自动回退公网；直连不加速静态素材。工具条显示最近三次往返样本的中位数，长轮询空等、原生动画不计入。

状态：`waiting → starting → playing → finished → waiting`。选将发牌后才确认 playing；启动失败或宿主丢失返回等待，真人重新准备。结算后房主回房，释放旧 worker、重新生成 match，保留房间码/座位。停止服务器不保存当前对局。

## 原生将池与模式适配

v0.7.3：2v2的一真人／一AI队伍由真人有序双选，先自己再AI，原十将池、点将、原期限和原生超时AI保留；纯AI和双真人队伍沿原路径。旧版下述「AI先选并提示」仅用于历史回归，当前AI队友不再抢先选真人点将。`npm run engine:verify:team`验证双选及刷新恢复、两真人各带AI／一真人与三AI、权威超时回调和真实4／4／4／5发牌，可加`ENGINE_VERIFY_HTTP=1`。已选真人的临时断线／托管不改变队伍类别。

同版bootstrap按实际主指针绑定原生触摸或鼠标事件，允许无懈自己；音量为单个Web Audio主输出0–100%，默认35%、同入口保存。礼物菜单保持开启，鼠标和触摸连续操作，显示公开昵称／目标／次数，规则端限200ms。静态公共弹窗在临时询问时隐去并按原焦点恢复，有背景的询问面板遮住中央出牌动画；回合采用原生glow_phase、金框和独立文字，reinited恢复公开当前回合。

`engine:verify:skills`另覆盖自无懈、五谷中沙摩柯无懈后蒺藜、逐日获胜后使用自己／对方的杀和对方锦囊（已有出杀次数也可用、不额外计次数）、刷新原期限、连续礼物与音量。`ENGINE_VERIFY_FEEDBACK_ONLY=1`只跑新增定向夹具，`ENGINE_VERIFY_DESKTOP=1`使用真实桌面鼠标；默认仍是模拟触屏。夹具在真实选将发牌后准备已知材料，不称为自然整局或微信真机。

v0.6.6 按 OL 常规 2v2 和用户明确的同池配合选将，每队共享本档 10 名候选，两队将池不重叠。每席独立数组内容相同，本人点将排首位且队友也可选择；点将占本队名额。只在最终合法确认或原生 AI 完成时占用，向队友提示已选；卡片保留显示，标明「队友已选」并禁选，本人首位同时标明「我的点将」。原生 chooseButton 参数对象携带私有 preference/taken，序列化 filterButton 统一装饰、灰化及过滤，首次弹窗前 AI 已选也显示完整十名。同将冲突重放原请求继续选择，原生 AI 从仍可选的九名中重选。选将临时包装 unwait/tempUnwait/chooseButton，结束时恢复，神将势力及后续技能走原路径。selection-recovery 的私有 replay 复用回调、原十将、更新的状态/标题，不重建 wait 或延长计时器，仍经过 privacy.js。来源与产品边界见 product.md。

同时补齐适配 start 漏设的 `_status.first_less`，由原生 `Player.phaseDraw` 处理首回合少摸 1 张；起手保留 4/4/4/5，固定第四行动位用 previousSeat 判断。阵亡仍使用上游联机 2v2 的可选摸一张及全灭结算，击杀无额外奖惩。

`ENGINE_VERIFY_MODES=versus ENGINE_VERIFY_GENERAL_SELECTION=1 ENGINE_VERIFY_VERSUS_TEAMMATES=1 npm run engine:verify:selection` 定向检查双真人 1/4 位的即时提示、未选队友刷新/原期限、真实起手数量、首回合 1 张与后续 2 张、自然阵亡队友可选摸一张和全灭结算，再核对公开记录与回房。可组合 advanced、HTTP/本机公网代理；固定座次仅用于测试。观察数字和队伍关系，不保存手牌、候选、身份或会话信息。

另加 `ENGINE_VERIFY_VERSUS_HUMANS=4` 可用四个独立真人会话验证同队候选内容相同、两队不重叠及未选对手收不到已选武将。再加 `ENGINE_VERIFY_VERSUS_CONFLICT=1`，从真实 UI 确认同一武将，短暂保留第二个出站结果来复现传输中的冲突；核对后提交方仍看到十名且仅九名可选、已选卡片/点将标记和原期限恢复，与点将组合时双方最终交换使用各自预选武将，验证本队候选可以共同选择。省略 TEAMMATES/HUMANS 参数时，双真人分别位于 1/2，另两席为 AI，核对原生 AI 已选武将提示和保留十将到达人类队友；它仍是桌面模拟。二维码截图只作本机预览，不能作为真实扫码地址。

`ENGINE_VERIFY_MODES=versus ENGINE_VERIFY_VERSUS_POINT_DISPLAY=1 ENGINE_VERIFY_RECONNECT=socket ENGINE_VERIFY_SECOND_ROUND=1 npm run engine:verify:rooms` 定向复现一真人点刘备、三 AI 补位、真人第四位而 AI 队友第一位先选的反馈。只固定座次，点将通过真实大厅接口；检查十张可见、九张可选、刘备仍在首位且同时标记「我的点将／队友已选」，实际触摸被选卡片不能选中，再完成真实选将/发牌、恢复与同房第二局。截图来自独立模拟测试席位，不使用正式房间或会话。

身份局使用经典 5–8 人身份配置；地主增加 1 体力上限并获得原生 feiyang/bahu，无额外地主强化；2v2 第 1、4 行动位同队，第 2、3 位同队，无替补，第四行动位多 1 起始手牌；单挑采用原生 single 的 dianjiang、每人一名武将、一局死亡结算。v0.6.5 按用户决定的候选数量：新手身份主公 5 名/其余 3 名，进阶主公 10 名/其余 6 名。主公从本档 isZhugong 集合取最多 3/6 名常备将，其余随机；排除他人点将后常备不足，用普通随机将补齐固定总数。主公先选、广播武将/额外体力并完成势力选择后再询问其他席位；未选候选回池，仅删除已选主公。斗地主和单挑仍每人最多 5 名不重叠候选，2v2 每队共享 10 名；最终上场武将均不重复。

房主可开放大厅点将，真人预选排在本人第1个候选，开局仍需确认，也能选其他候选；先到先保留，别人的保留不能被随机或主公将池抽走。2v2 的本队点将加入共享池，队友也可选择。主公点普通将占一个随机名额，点常备将提前占常备名额，保证首位且不被随机抽样排除，候选数量不增加。关闭或换档清除保留，AI 继续原生自动选将，不打开原生自由选将/商业解锁菜单。私人 generalSelections 只进入认证规则 worker 的 setup，不发给手机、镜像、大厅或观战；规则端再按真实白名单与候选复核。神将与多势力武将沿用原生势力选择及恢复。

选将验证器可加 `ENGINE_VERIFY_GENERAL_SELECTION=1`，通过真实大厅接口点将且保留完整武将档，核对首候选、刷新/断线原期限、主公常备池/先展示、禁止重复上场、真实发牌、自然结算与回房；v0.6.5 另核对主公/其余人数对应档位的 5/3 或 10/6 个候选。与 advanced、`ENGINE_VERIFY_SELECTION_GOD=1` 组合时通过大厅点神赵云/神吕布，不再缩小产品武将池；`ENGINE_VERIFY_IDENTITY_SEATS=8` 可检查八席。验证器仅固定测试座次及身份局首席为主公，不注入伤害、牌堆或胜者；HTTP/本机公网代理与超时参数沿用下文说明。

v0.6.7 标准档为经典25将、华雄、原生 old:ol_yuanshu（妄尊/同疾）共27将；不使用已加强的 standard:re_yuanshu。启用 standard/old 角色包，另加载 refresh/sp 规则依赖，最终选将和原生变换候选仍受明确27将白名单约束。v0.6.8第二档为用户确认的“经典进阶48将”，注册refresh/shenhua/sp，按48个精确原生ID裁剪；依赖包不授权其他角色。没有角色覆盖或技能补丁。固定资源共2242项，其中1700个音频约84.6MiB；本轮新增4头像、14音频。素材别名见manifest的portraitAliases。

`npm run engine:update-catalog` 静态读取固定核心，生成 `config/general-catalog.json`；`npm run engine:update-audio` 使用同 commit 的 `.local/research/upstream-tree.json` 更新音频 blob 清单，然后运行 `engine:prepare` 校验/准备。变更将池或图鉴后先运行 `npm run build` 更新小图清单，再运行 `npm run check`，避免测试读取旧派生清单。图鉴数据与清单受版本管理，生成器不执行第三方技能。两档图鉴合计75个原生武将版本，技能说明直接读取固定核心，并静态追踪derivation/inherit与poptip关联说明，不手工改写。`npm run engine:update-inventory` 另生成全部26个普通武将包、2563个版本的清单，只供后续分池参考，不开放新角色。

## 可重复验证

v0.4.0 玩家传输支持 WebSocket 首次失败/8 秒超时后的认证 HTTP 长轮询；规则宿主仍用本机 WebSocket。两种传输都保留 `privacy.js` 和入站卡牌引用保护。HTTP 逐条消息间保留浏览器任务边界，原生判定复制牌须等待前帧的 Promise 与观察器完成。公网连接经独立代理，不能访问宿主入口。`ENGINE_VERIFY_HTTP=1` 强制 HTTP，`ENGINE_VERIFY_BLOCK_WEBSOCKET=1` 拦截玩家 WebSocket 检查实际自动回退，`ENGINE_VERIFY_STALL_WEBSOCKET=1` 模拟连接始终无响应以检查八秒回退；与四模式、两真人、重连/第二局参数组合。使用已运行公网实例时，`ENGINE_VERIFY_EXISTING_URL` 指本机服务地址，`ENGINE_VERIFY_PLAYER_URL` 指公网 origin，电脑继续打开本机 `/server`。桌面合成微信 UA 不等于流量或微信真机验收。

```powershell
npm run engine:prepare
npm run engine:verify:rooms
$env:ENGINE_VERIFY_PRESET = 'advanced'
npm run engine:verify:rooms
```

可选环境变量：`ENGINE_VERIFY_MODES=duel,identity,doudizhu,versus`、`ENGINE_VERIFY_IDENTITY_SEATS=8`、`ENGINE_VERIFY_HUMANS=2`、`ENGINE_VERIFY_RECONNECT=1`（刷新）或 `socket`（自动恢复）、`ENGINE_VERIFY_MANUAL=1`、`ENGINE_VERIFY_SECOND_ROUND=1`。后两项分别触屏选牌/目标/确认并验证规则端历史、在原房间重新完成第二局。`ENGINE_VERIFY_EXISTING_URL` 可指定已运行的发行包局域网地址，脚本不会停止该实例。独立验证用随机端口，不占当前聚会服务。

`npm run engine:verify:recovery` 使用独立服务和桌面 Edge 手机尺寸：仅固定实际选将为界左慈/界凌统，保留完整进阶化身候选池；注入玩家运行异常、准备公开装备和体力以执行原生勇进/旋风，再在勇进动画处丢弃玩家更新，检查最终血量/装备、原席位/原 match 与回房。准备状态和故障注入只存在于测试，不是自然发牌的完全随机对局，也不代表微信原始故障或全技能路径已复现。

当前96池定向命令推荐 `ENGINE_VERIFY_PRESET=advanced ENGINE_VERIFY_GENERAL_SELECTION=1 ENGINE_VERIFY_SELECTION_GENERALS=xin_xusheng,yufan npm run engine:verify:selection`，保留完整96将，身份可加8席，2v2可加同队参数。神将、魄袭、攻心和界高顺的旧advanced命令是156池历史回归记录，当前96池不授权这些角色；本轮魄袭专用夹具使用允许神甘宁的官方档，见顶部verify-native-cards-feedback命令。

`npm run engine:verify:selection` 使用独立服务和两真人桌面 Edge 手机尺寸，默认四模式：在选择中真实关闭连接、刷新、核对相同候选/席位/截止计时器，再核对已选席位不重弹；完成真实发牌、原生托管自然结算、公开历史连续序号/计数、回房与离房。`ENGINE_VERIFY_MODES=duel` 可缩小范围；`ENGINE_VERIFY_SELECTION_PUBLIC=1` 通过本机公网代理，`ENGINE_VERIFY_SELECTION_HTTP=1` 强制 HTTP；`ENGINE_VERIFY_PRESET=advanced ENGINE_VERIFY_SELECTION_GOD=1` 仅固定实际神赵云/神吕布候选并验证势力选择重连。`ENGINE_VERIFY_SELECTION_TIMEOUT=1` 在已恢复选将后调用原计时器同样的 unwait('ai')/close，检查晚到重连与原生 AI，不是等满 65 秒的计时测量。候选/超时注入仅在验证脚本，不改变产品配置、牌堆/体力或胜者；这些桌面测试不代表微信真机验收。

`ENGINE_VERIFY_CACHE=1` 不拦截同源请求，允许浏览器真实 HTTP 缓存；配合 `ENGINE_VERIFY_RECONNECT=1` 检查刷新后主体 transferSize=0。不要与注入 CSS 慢载入、失败重试或候选 fixture 组合。`ENGINE_VERIFY_COLD_MOBILE_KBPS=128` 则通过浏览器网络模拟设置 128 KiB/s 上下行与 150ms 延迟，可与 CACHE 组合检查真实冷启动和缓存；等待实际客户端手牌到达，再检查大字体请求、纯 CSS 血条与音效。这是桌面限速模拟，不是微信流量测速。验证还检查实际音频解码/播放与静音、真实向下触摸滑动、原生五谷丰登广播/牌面及结算前阵亡身份。检查产品默认节奏后，验证脚本把原生速度改为 vvfast/100ms 加速完整结算；该加速不进入产品配置。

`ENGINE_VERIFY_PRELOAD=1` 配合 CACHE 等待大厅公共素材准备完成，再进入真实选将、发牌与对局，断言 iframe 引擎主体 transferSize=0。`ENGINE_VERIFY_EXPERIENCE=1` 检查 23 类选择提示，经原生 GameEvent.send、Client JSON 和逐接收者隐私过滤，在手机按原生 parsedResult 重建后核对当前文字/分支和对话框；进阶再调用原生乱武、界乱武、界挑衅内容，仅执行到选择构造器即停止，并核对两端合法目标。该构造探针不推进技能结算，不等于整局定向触屏验收。另将实际音频响应延迟 2.2 秒，等待二十次语音全部完成且过期丢弃。MANUAL 还测量原生 result 提交至电脑规则宿主收到的时间，区别于整个动画/下一次可操作的往返延迟。`engine:check-definitions` 同时生成静态选择入口审计；新增无参响应须补核对。

`ENGINE_VERIFY_GOD_FIXTURE=1` 仅用于定向神将势力选择回归：浏览器测试路由将候选限制为神赵云、神吕布，配合 `ENGINE_VERIFY_PRESET=advanced` 与 `ENGINE_VERIFY_MODES=duel` 使用。它不改变产品配置，是原156将池的历史回归路径，不能当作当前96将池验收。结果文件按参数区分，记录验证时间和参数。

v0.3.1 默认模拟 Android 微信 UA，仍由桌面 Edge 执行；`ENGINE_VERIFY_USER_AGENT` 可替换该合成 UA。`ENGINE_VERIFY_PORTRAIT=1` 使用 390×844 窗口，检查横向牌桌/竖屏切换不换 iframe，并继续真实触屏操作。`ENGINE_VERIFY_SLOW_START=1` 将手机 CSS 响应延迟 12 秒，确保实际跨过原生十秒阈值；`ENGINE_VERIFY_RETRY_START=1` 中断首次核心模块下载，点击真实重试按钮后完成对局。两项支持与四模式组合。

`ENGINE_VERIFY_JUDGE_FIXTURE=1` 配合 `ENGINE_VERIFY_MODES=duel`、`ENGINE_VERIFY_HUMANS=2` 使用：测试路由限定甄姬/司马懿，执行原生洛神判定和鬼才改判，不改变产品配置或牌堆。检查发送的牌名/花色/点数，以及两端实际复制牌面的遮盖类与花色点数；新手档测试，不与神将 fixture 同时使用。

旧156将池的 `ENGINE_VERIFY_COMPARE_FIXTURE=1` 配合 advanced、duel、两真人使用：测试路由限定界高顺/界太史慈，必须实际执行原生拼点，检查广播材料无占位且选择阶段/其他暗牌仍隐藏。fixture 不修改产品候选、牌堆、伤害或胜者，也不与 CACHE 或其他 fixture 组合。判定复制牌观察排除拼点先展示牌背的翻转动画，拼点另外检查发送牌面。

脚本观察实际原生出牌/响应及判定广播，检查对手打出的牌不含占位元组；另用真实原生卡牌做序列化上下文探针，验证观星排序区对旁观者隐藏、对获授权玩家可见。判定牌从 player.judging 与 event.result.card 识别；event.card 不是翻出的结果牌。对手手牌检查尊重原生 knowers（例如洛神公开获得的牌），不能把所有对手手牌都当作未知牌。静态定义检查是 `engine:verify:rooms` 的前置步骤，也可单独执行 `npm run engine:check-definitions`。

输出 `.runtime/native-runtime`；不提交私人牌值/运行凭据。默认选将后启用上游托管至结算，没有合成伤害、牌或胜者。桌面 Edge 手机视口与真机微信分别记录，不混作验收。

v0.6.1 私有牌面回归可设置 `LIGHT_VERIFY_PRIVATE=poxi` 或 `gongxin-discard` / `gongxin-top`，同时设置 `LIGHT_VERIFY_ADVANCED=1` 后运行 `npm run engine:verify:lightweight`。魄袭推荐 `LIGHT_VERIFY_MODE=doudizhu LIGHT_VERIFY_HUMANS=3` 检查无关席位；攻心用 `LIGHT_VERIFY_MODE=duel`。`LIGHT_VERIFY_PUBLIC=1 LIGHT_VERIFY_HTTP=1` 可覆盖本机公网代理 HTTP。验证器只固定原候选/首座，并补充少量测试手牌，实际触屏选择、原生花色/红桃限制、确认前后、刷新和技能结算均由原生路径执行，后续托管自然胜负与回房/第二局继续检查；不改牌堆顺序、规则、伤害或胜者。结果存 `.runtime/lightweight`，真实手机仍需单独复测。`engine:check-definitions` 另输出 `.runtime/native-visibility-audit.json`，范围为两档静态依赖闭包，不能穷尽动态技能或扩展。

## Windows 离线包

`npm run package:windows` 构建 `dist/web` 与 `dist/server/main.js`，验证资源后生成 `.runtime/releases` 下的 ZIP、SHA-256。打包使用全新临时目录，完成后清理，避免混入曾运行的发行副本。包含 Node.js 24 x64、固定联网组件、引擎/图片/音频、相应许可证、项目源码与文档；不包含 `.env`、`.runtime` 内的个人实例信息、日志或会话。发行包通过 `portable.json` 跳过 npm/构建/下载，双击入口相同。

当前未承诺所有进阶技能的私有存储覆盖、恶意客户端全面防作弊、微信后台长时间恢复或多房容量。添加扩展需要单独验证原生协议与私有数据，不能只改白名单便开放。

新服务在每局 start 时冻结将池配置，手机刷新和重连沿用该快照。bootstrap/mode 以 rosterPolicy 标记启用白名单与 enabledPacks；运行中的更早服务缺少标记会保留旧33/156将规则，完整停启才能启用当前27/96将；任何既有房间的内存都会被停启清空，切换先按handoff核对。新增标准档袁术必须同时注册 old 包，不可只加载其技能定义。只读校验拒绝 characterOverrides，保持原生角色、技能和出牌AI。

`ENGINE_VERIFY_GENERAL_SELECTION=1 ENGINE_VERIFY_SELECTION_GENERALS=ol_yuanshu,huaxiong ENGINE_VERIFY_MODES=versus npm run engine:verify:selection` 通过真实大厅点将验证两个新增标准人物，继续选将恢复、真实发牌与自然结算；只固定测试座次，不覆盖技能、牌堆或胜者。
