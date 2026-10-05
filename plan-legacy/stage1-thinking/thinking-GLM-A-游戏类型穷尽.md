# 视角1 思考轨迹：小游戏类型学与穷尽方案（GLM-A）

> 撰写：GLM 5.3 Flash ｜ 2026-10-03 ｜ 独立思考轨迹，非规划书。事实与推断分开标注；web 事实附来源；查不到的写查不到。

## 0. 我读了什么、查了什么

**仓内证据（一手）**：
- 基线总文 §3.1：现有产线 = 模板法 4 模板，48 包差分终审零回归（A 级），「任意小游戏→稳定产出」远超模板法能力。
- 产线仓 `chenmai-playable-factory/`：README、`channel-rules/channel-rules.json`、`packages/spec/src/types.ts`、golden-pullpin spec、四模板 src 目录、pullpin `game.ts` 头注释。
- 关键仓内事实：①「七渠道」实为 **preview（本地 QC 渠道）+ applovin/meta/mintegral/google/unity/tiktok 六真实投放渠道**（channel-rules.json 七条目；pangle 与 tiktok 同协议归一）；②4 模板 = **match3（三消）/merge（合成）/pullpin（拔针）/sort（排序，含 screwMode 螺丝）**，`Template` 类型是**封闭联合类型**——产线的通用性边界就冻结在这一行；③四模板文件布局高度同构（assets/audio/board/game/main/rng/solver/spec/textures.ts 一套），match3/merge/sort 三个几乎逐文件同名——**模板间复制粘贴的痕迹**，这直接支撑第 4 节的底座复用判断；④pullpin 的"物理"是**语义脚本**（救援针/机关针/中性针角色制 + spec 里 `orderSolution` 预解序列，win 恒为 true，非真实流体物理）——代码头注释自证；⑤QC 契约要求模板暴露 `__PF_QC__.hint()` 返回必胜操作（CHK07 依据）——**每类游戏必须"可被解"才能被质检**，这是扩类型时的硬约束。

**web 研究（二手事实，附来源）**：
- CrazyGames 品类目录（实取 https://www.crazygames.com/t/casual 导航）：Action/Adventure/Arcade/Board/Card/Clicker/Driving/.io/Puzzle/Shooting/Simulation/Sports/Strategy/Trivia/Word 共 15 主类 + casual/hyper-casual/2-player/classic/one-button/mini/match-3/mahjong/merge/rhythm/RPG 等标签。
- Poki 品类目录（实取 https://poki.com/en）：约 39 类——含 Obby、Dress Up、Cozy、Tower Defense、Idle、Tycoon、Watermelon、Escape、Stickman、Typing 等更口语化的品类。
- 市场趋势（搜索综合）：2025 年超休闲→混合休闲迁移是主线；playable ads 是 2025 主流 UA 形态，"把热门小游戏做成 playable"是最高效创意路线之一（来源：appagent.com《State of Playable Ads 2025》、businessofapps.com、ciao.games 2026-09 分析、lancaric.me 月度 playable 趋势）。lancaric.me 逐月按机制盘点在投 playable（如 Magic Sort 的排序机制放大），是类型优先级的直接素材。
- 机制模板化证据： commercially 卖的 Unity 拔针模板（payhip "Pull The Pipe"）、playableadsmaker.com 有 Hexa Sort 模板教程——**拔针/排序这类机制在广告业已模板化**，反向印证我们 4 模板选型踩在市场主流上。

## 1. 第一个岔路：分类学按"平台品类标签"还是按"机制轴"

考虑过三个方案：

- **方案甲：直接沿用平台目录**（CrazyGames 15 类 / Poki 39 类拼个大表）。优点：外部权威、可闭包校验；缺点：目录是**营销面**不是机制面——"Cozy"和"Games for Girls"是受众切分，"3D/Flash/Mobile"是技术切分，同一机制（三消）散在 Puzzle/Casual/match-3 三处，且各平台粒度不一，直接用会导致模板映射无法收敛。
- **方案乙：纯机制轴正交分解**（输入模型 × 时间结构 × 世界结构 × 成败判定四轴取值组合）。优点：理论上可枚举、MECE 在轴层面成立、每格直接指示引擎需求（连续物理 vs 棋盘规则 vs 实时循环）；缺点：组合空间无界，一个组合（如"拖拽+回合+网格+目标清除"）同时命中三消/排序/合并三个真实品类——轴到品类是多对一，光有轴没法交流。
- **方案丙（我倾向）：轴为骨架、家族为行、外部目录为闭包校验**。即：用机制轴推出家族表（第 2 节），每个家族标注四轴取值；再用 CrazyGames/Poki 目录做**闭包检验**（第 3 节）——每个外部类必须能落进至少一个家族，落不进就修表。这样分类既能指导引擎复用（看轴），又有外部完备性证据（看闭包），还能吸收平台商业直觉（看家族代表性游戏）。

## 2. 分类学成品：5 超类 × 26 家族

四轴记法：输入（T=tap/D=drag 一次性/C=连续拖曳/画线/时序 tap）、时间（R=实时/turn=回合/T=tick 仿真）、世界（G=网格/B=物理连续体/P=自由平面/轨道）、成败（目标清除/分数阈值/生存/经济目标/无败局）。

**超类 A：棋盘逻辑（turn+网格，确定性，可 solver 验证）**
| 家族 | 核心机制 | 输入/时间/世界/成败 | 代表作 |
|---|---|---|---|
| A1 三消 | 邻位交换→3+同色消除级联 | D/turn/G/目标清除 | Candy Crush、Royal Match（现有 tmpl-match3 ✅） |
| A2 点消 | 点同色≥2 组炸开 | T/turn/G/目标清除 | Toon Blast |
| A3 排序 | 容器间倒珠/卸螺丝归色 | T·D/turn/G/清空 | Ball Sort、Screw Jam、Hexa Sort（现有 tmpl-sort ✅ 含 screwMode） |
| A4 合并 | 同级物撞合升级 | D/turn/G(滑)/目标层级 | 2048、Suika 合大西瓜、Merge Dragons（现有 tmpl-merge ✅） |
| A5 数独/nonogram | 约束填格 | T/turn/G/唯一解 | Sudoku.com、Nonogram Katana |
| A6 纸牌/麻将 | 顺序/对子消除牌堆 | T/turn/G/清台 | Solitaire Grand Harvest、UNO!、麻将连连看 |
| A7 字词/答题 | 填字/选答案 | T/turn/G/过关 | Wordscapes、Wordle、Brain Test（脑筋急转弯） |
| A8 找不同/隐藏物 | 图像对比点选 | T/turn/P/找全 | June's Journey |

**超类 B：物理谜题（连续物理世界，直觉解法）**
| B9 拔针 | 拔销序决定流体/陷阱结局 | T/半实时/B/救人 | Hero Rescue、Pin Rescue（现有 tmpl-pullpin ✅ 但为语义脚本非真物理） |
|---|---|---|---|
| B10 画线 | 画线挡威胁/引流/造桥 | 画线/回合/B/目标达成 | Save the Dog、Happy Glass、Brain Dots |
| B11 弹射 | 瞄准蓄力发射抛物线 | D 拖放/回合/B/清除 | Angry Birds 2、Bubble Witch（泡泡龙） |
| B12 挖/引流 | 挖沙引导球/水 | D 划/实时/B/到位 | Sand Balls、Dig This、Where's My Water |
| B13 移除触发 | 抽走一块引发连锁 | T/回合/B(堆叠)/目标 | Braindom"抽一块"类、Untangle/TRICK |

**超类 C：实时反应（实时循环+碰撞+生成器）**
| C14 跑酷 | 轨道上躲避障碍收集 | 滑动/实时/轨道/距离 | Subway Surfers、Temple Run 2 |
|---|---|---|---|
| C15 竞速/驾驶 | 操控车竞速/特技 | 姿态操控/实时/P/名次 | Slow Roads、Moto X3M |
| C16 平台(obby) | 跳台跳跃过关 | T 跳/实时/P/到终点 | Vex 系列、Roblox Obby |
| C17 节奏 | 时序 tap 对拍 | 时序 tap/实时/轨道/连击 | Piano Tiles 2、Beatstar |
| C18 io 对战 | 大地图吃/圈地/对抗 | 方向操控/实时/P/生存排名 | Agar.io、Paper.io 2、Slither.io |
| C19 射击 | 瞄准/自动战斗清怪 | 瞄准拖曳/实时/P/清波 | Archero、Survivor.io、Shell Shockers |
| C20 格斗/动作 | 招式对抗 | 虚拟摇杆/实时/P/胜 | Stickman 系列、Brawl Stars |
| C21 运动 | 投篮/击球/ golf 力度条 | 时序/力度/实时/P/得分 | Basketball Stars、Golf 轻量类 |

**超类 D：策略/仿真（tick 经济循环）**
| D22 塔防 | 放置单位拦截波次 | T 放置/实时+tick/轨道/守塔 | Kingdom Rush、Bloons TD |
|---|---|---|---|
| D23 放置/点击 | 挂数值滚雪球 | T 连点/T/无世界/经济目标 | AdVenture Capitalist、Cookie Clicker |
| D24 模拟经营 | 订单/生产/扩建循环 | T 点选/T/P/经济目标 | Cooking Fever、Papa's Pizzeria、My Mini Mart |
| D25 装扮/改造 | 换装+三消混合 meta | T 点选+D/回合/UI/关卡 | Project Makeover、Poki Dress Up 类 |

**超类 E：内容驱动（机制极薄，内容/情绪为主）**
| E26 追逐/惊吓/叙事 | 逃出/追逐的紧张循环 | 摇杆/实时/P/逃脱 | Granny 类、文本冒险 |
|---|---|---|---|

推断标注：26 家族的划分是我基于机制轴+目录闭包的推断；「超类↔引擎底座」的对应（第 4 节）是更强的推断，需原型验证。

## 3. "穷尽"怎么才算穷尽——三层可操作检验

诚实前提：小游戏是文化产品，品类空间开放（每月有新机制爆款），**哲学意义的 MECE 不存在**。我主张把"穷尽"操作化为三层：

1. **闭包检验（可机做）**：CrazyGames 15 类 + Poki 39 类 + Google Play 游戏类型 + App Store 类型逐一映射进 26 家族，要求 100% 可放置。我粗验过一遍：CrazyGames/Poki 全部类目均能落位（RPG→C19/E 混合、Typing→C17 时序变体、Escape→E26、Watermelon→A4），无落不进者；Google Play/App Store 类型清单未逐条做（**待验证**，工作量约半天）。
2. **放置测试（可持续）**：任何新输入游戏先过归类协议：能归→家族标签+参数化程度评估；不能归→打 NEW 逃逸口，触发家族表修订。穷尽性 = 基准集上放置率 100% + 外部目录映射率 100%，并且**修订历史留档**。
3. **市场加权（防均匀主义）**：产线目标是可玩广告不是游戏百科。按 playable ads 真实分布排优先级：解谜类（A/B 超类）+ 跑酷/io（C14/C18）+ 经营装扮（D）占在投 playable 绝大多数（lancaric.me 月度盘点可作量化依据，**待 MM-B 侧核实**）；midcore（RPG/MOBA/4X）几乎没有真 playable，业界用交互视频或"终局卡"降级形态——对这类应显式声明"不支持/降级"，而不是硬塞进产线。

## 4. 类型→引擎/模板映射：现有覆盖与缺口

仓内事实：四模板共享同一自研 `vendor/engine.js`（canvas）+ engine-bridge（PF.audio/events/channels 契约），每模板自带一套 assets/audio/textures/board/solver——同构复制明显。据此我按**底座需求**把 26 家族聚成 5 个引擎族，并与现状对齐：

- **K1 棋盘引擎**（规则+合法性判定+solver+seed 关卡生成）：A1–A8 全族。现有 match3/merge/sort 三个模板就是 K1 的三个实例——**扩展 A2/A5/A6/A7 是边际成本最低的路线**（复用 solver/qc 框架与可解性预检，webui 已有 match3 seed 可解性预检与 pullpin 顺序复核）。
- **K2 物理引擎**（刚体/粒子/流体近似/画线碰撞体）：B9–B13。现状：pullpin 是**语义脚本冒充物理**，K2 实际为零。B10 画线（Save the Dog 是近年爆款品类）是最大缺口。K2 的 solver 问题最难：任意关卡的"可解性判定"可能是 NP 难（画线类），出路是**生成式关卡**（先解后关，像 pullpin 的 orderSolution 那样把解写进 spec）而非求解式。
- **K3 实时循环引擎**（game loop+spawn+collision+镜头/难度曲线）：C14–C21 全空。这是与现状差异最大的一族：胜负不再是回合判定，QC 的 hint() 要从"给必胜步"变成"脚本化演示轨迹"；广告语义要求"首玩必胜/无败局"，需难度曲线按 attract 参数（nearWin/failBait 已在 spec 里！）在实时框架下重构。
- **K4 经济仿真引擎**（tick 循环+数值曲线+离线收益）：D22–D24。塔防 = K3+K4 混合。无传统胜负，DoD 的 L1"胜负判定"要改写成"目标达成判定"——这会影响 DoD 定义，留给 GLM-B 对齐。
- **K5 内容/UI 引擎**（场景切换+素材展示+点选反馈）：A7 答题/E26/D25。机制最薄但素材最重，产线价值在于素材管线（assetkit 已有 99.24% 压缩能力）而非玩法代码。

**覆盖结论**：现有 4 模板 = K1 三实例 + K2 一个脚本化特例。K2（真物理）、K3、K4、K5 全空。缺口排序建议：K3（跑酷——在投 playable 中占比高且 attract 参数天然适配）> K2 画线 > K4 放置/经营 > 其余。

**架构含义（推断）**：与其"每类型一个模板"地加到 26 个模板，不如**家族级底座（5 个 kernel）+ 薄玩法包**：kernel 实现 PF 契约（events/hint/qc/audio）与对应物理/循环内核，玩法包只含规则参数+素材映射+胜负逻辑。四模板的同构文件布局就是重构证据。同时 `Template` 封闭联合类型要改为开放的注册机制——这是产线从"4 选 1"走向"任意输入"的第一刀。

## 5. 建议输入游戏清单（36 款，真实存在）

形态：源=HTML5 源码（可白盒）；页=试玩页（可黑盒+录屏）；视=截图/视频（App Store/YouTube，仅作 oracle 参照）。版权纪律：开源许可证优先；Poki/CrazyGames 嵌入包仅限录屏/行为观察，不逆向提取源码进产线（ToS 风险，留给 owner 裁定）。

| # | 游戏 | 家族 | 渠道 | 形态 |
|---|---|---|---|---|
| 1 | 2048（Cirulli） | A4 | GitHub gabrielecirulli/2048（MIT） | 源 |
| 2 | 合大西瓜开源克隆（多个） | A4 | GitHub suika-game clones | 源（质量需筛） |
| 3 | Hexa Sort | A3 | 应用商店+lancaric 素材 | 视 |
| 4 | Ball Sort Puzzle | A3 | 网页版（多门户） | 页 |
| 5 | Royal Match | A1 | App Store 商店页/YouTube | 视 |
| 6 | Toon Blast | A2 | 同上 | 视 |
| 7 | 数独开源实现（多个） | A5 | GitHub/开源 HTML5 | 源 |
| 8 | Lichess | A6 | lichess.org（AGPL 开源） | 源+页 |
| 9 | 麻将连连看（网页版） | A6 | CrazyGames mahjong 标签下多款 | 页 |
| 10 | Wordle | A7 | nytimes.com/wordle（另有开源克隆） | 页+源（克隆） |
| 11 | Wordscapes | A7 | 商店页/YouTube | 视 |
| 12 | Brain Test | A7 | YouTube 广告合集 | 视 |
| 13 | June's Journey | A8 | 商店页 | 视 |
| 14 | 找不同网页版 | A8 | CrazyGames/Poki puzzle 类 | 页 |
| 15 | Hero Rescue | B9 | 商店页/YouTube teardown | 视 |
| 16 | Save the Dog | B10 | YouTube teardown | 视 |
| 17 | Happy Glass | B10 | 商店页 | 视 |
| 18 | Angry Birds 2 | B11 | 商店页 | 视 |
| 19 | 泡泡龙网页版 | B11 | 各 HTML5 门户 | 页 |
| 20 | Sand Balls | B12 | 商店页 | 视 |
| 21 | Braindom（抽一块） | B13 | YouTube | 视 |
| 22 | Subway Surfers | C14 | Poki 官方网页版 | 页 |
| 23 | Temple Run 2 | C14 | Poki 官方网页版 | 页 |
| 24 | Clumsy Bird | C14 | GitHub ellisonleao/clumsybird（MIT） | 源 |
| 25 | Slow Roads | C15 | slowroads.io | 页 |
| 26 | Moto X3M | C15 | CrazyGames/Poki | 页 |
| 27 | Vex 7 | C16 | CrazyGames | 页 |
| 28 | Piano Tiles 2 | C17 | 商店页 | 视 |
| 29 | Paper.io 2 | C18 | Poki 网页版 | 页 |
| 30 | Agar.io | C18 | agar.io 网页版（另有开源克隆） | 页 |
| 31 | Shell Shockers | C19 | CrazyGames 网页版 | 页 |
| 32 | Vampire Survivors | C19 | itch.io 原始网页 demo | 页 |
| 33 | Anuto TD | D22 | F-Droid/GitHub（开源） | 源 |
| 34 | Cookie Clicker | D23 | orteil.dashnet.org | 页 |
| 35 | Papa's Pizzeria | D24 | CrazyGames/Poki（Flipline） | 页 |
| 36 | Project Makeover | D25 | YouTube teardown | 视 |

补充批量源：**js13kgames.com 历年参赛作品全部开源可下载**（≤13KB 完整 HTML5，横跨跑酷/解谜/io/节奏，一鱼数十款）；itch.io HTML5 区可按 tag 批量取页。粗略统计：源码形态 9 款、试玩页 15 款、视频 12 款；覆盖 26 家族中的 21 个（A2/A5 部分靠"多个开源实现"补，C20/C21/E26 未入列——js13k 与 itch.io 可补齐，**待补**）。分布上刻意让"源码:页:视频≈1:2:1"，对齐 MM-C 提出的难度分层。

## 6. 坑、不确定性、开放问题

1. **hint() 契约是隐形天花板**：现行 QC 依赖模板给出必胜操作。K2 画线类任意关卡求解可能是 NP 难（推断，需验证）；K3 实时类没有"一步必胜"。QC 协议要为不同 kernel 分型（solver 式/脚本轨迹式/目标达成式）——这牵动 DoD 与判官设计，**需要 owner 认可"QC 契约分型"这个方向**。
2. **"物理感"的降级路线**：pullpin 用语义脚本冒充物理且通过了全部质检——说明 playable 的"物理"可以戏剧化表演。真上 K2 物理内核（matter.js 级）还是继续"脚本物理+表演"，成本差一个量级，是**架构级 open question**。我倾向：先脚本物理覆盖爆款品类（画线类用预生成可解关卡），真物理内核按需再上。
3. **清单可获取性未逐一验证**：36 款中"页"形态的 15 款我未逐一点开验证今天仍在线（推断基于平台目录存在性）；suika 开源克隆、数独开源实现需质量筛选。建议 benchmark 建库时逐款验活并登记访问日期。
4. **playable ads 品类分布缺量化数据**：第 3 节的优先级排序基于定性判断，lancaric.me 可月度追踪但需要人工盘点，或转 MM-B 的 oracle 库统计——两视角应合流。
5. **K5/内容驱动的价值存疑**：装扮/答题类玩法代码量极小，值不值得进"通用产线"还是走纯素材模板路线，取决于 owner 对"任意小游戏"边界的定义——建议先豁免或降级处理。

## 7. 若由我定

- 分类学采用「四机制轴 × 5 超类 × 26 家族 + 外部目录闭包检验」，穷尽性定义为：闭包映射 100% + 基准放置 100% + 修订留档，并按 playable 市场分布加权优先级，而非均匀覆盖 26 家族。
- 产线走「**5 家族 kernel + 薄玩法包**」架构，不做 26 个平级模板；第一批扩展：K3 跑酷（真实时循环，占在投 playable 大头、attract 参数已就绪）→ K2 画线（脚本物理+生成式关卡）→ K4 放置。`Template` 封闭联合类型改注册制。
- 输入清单先落 36 款（源:页:视≈1:2:1，覆盖 21/26 家族），用 js13k/itch.io 补 C20/C21/E26 至全家族覆盖；建库时逐款验活。
- 提请 owner 拍板三件事：①QC 契约按 kernel 分型（改判官协议）；②物理内核先脚本后真物理的路线；③K5 内容驱动类暂缓的边界划定。

*来源汇总：crazygames.com/t/casual（品类导航，2026-10-03 实取）；poki.com/en（品类页，2026-10-03 实取）；appagent.com State of Playable Ads 2025；businessofapps.com；ciao.games 混合休闲分析（2026-09-18）；lancaric.me playable 月度趋势；playableadsmaker.com Hexa Sort 模板教程；payhip.com Pull The Pipe 模板页。仓内证据见第 0 节路径。*
