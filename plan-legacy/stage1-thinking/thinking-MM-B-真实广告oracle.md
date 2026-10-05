# 视角4 MM-B：真实可玩广告 oracle 与吸引力基准（思考轨迹）

> 执行者：minimax/MiniMax-M3.1-Flash-Preview｜日期：2026-10-03
> 任务书：`_playable_plan\任务书-stage1-规划思考.md` §五·视角4
> 口径标注：**【实测】**=本次会话亲自跑过命令并看到输出；**【读仓】**=我读了仓内文件并给出 file:line；**【待验证】**=凭既有知识、未在本机证实；**【推断】**=我的设计主张。
> 环境说明：本机**通用搜索引擎不可用**（实测见 §2.4），因此全部取证改用「直连已知 URL + GitHub REST API + curl 抓页面后本地抽文本」，并在下文附上可复现命令。

---

## 〇、先把「oracle」这个词拆开

任务书要我做的是「找真实可玩广告来作为 oracle」。我一开始想的是"建一个真实广告样本库"，写到一半发现这个词混了三件不可互相替代的事，混在一起会让后面所有设计都站不住：

- **结构 oracle**：真实广告**包**长什么样（单 html / zip、entry 命名、内联率、包体分布、退出接口形态、CTA 是常驻还是结算页）。回答"我们打得对不对"。
- **行为 oracle**：真实广告**玩起来**事件序列长什么样（首屏多快出来、第一次交互在第几秒、教学多久、核心循环几秒、手势几次、CTA 在第几秒、点击后调什么接口）。回答"我们像不像"。
- **体验 oracle**：真实广告**好不好玩、够不够吸引人**。回答"用户会不会点"。

三层的可得性、测量方法、可信度完全不同。**我的判断：stage1 只能真正建起前两层；第三层只能建"可复现的代理指标 + 盲评流程"，拿不到转化真值。** 下面每一条都按这个分层来说。

---

## 一、先读自己的仓：oracle 到底补的是哪个洞

按纪律只读不改 `factory/`，我读了 `chenmai-playable-factory` 的判官链与差分链。有五个**具体到行**的发现，直接决定 oracle 应该长什么样。

**① 事件探针已经是「真实广告可比」的形状了，但只对我们自己的广告有效。**
`qacore/src/probe.ts:16-19` 定义 probe 对象，`:22-31` 监听 `pf:ready / pf:start / pf:end / pf:first-interaction / pf:cta`，`:36-38` 记录首个 pointer 时间戳，`:65-67` 包了 `AudioContext` 与 `webkitAudioContext`，`:94-105` 包了 `RTCPeerConnection`。这套事件名**恰好就是吸引力代理指标的原料**：ready→first 是首屏钩子时延，first→start 是教学时长，start→end 是核心循环时长，cta 是 CTA 时机。
但 `pf:*` 是我们自家桥派发的（`packages/engine-bridge/src/index.ts:10-13` 注释写明 `PF.start()`→`pf:start`、`PF.open(url)`→`pf:cta` + 渠道退出接口，`:115-116` 是实际派发点）。真实广告不发这些事件。
`qacore/src/checks.ts:100-108`：页面没有 `window.PF` 而渠道要求首交互前静音 → **判 fail**；`checks.ts:190-192`：没有 `__PF_QC__`（hint/state）→ CHK07 直接 fail，文案就是"页面未暴露 __PF_QC__（hint/state），无法自动试玩"。
**推论：现有判官在真实广告上必然红。oracle 必须配一套"外来广告专用探针 + 运行器"，不能复用 qacore 的判定层。** 这是我本次最硬的一个发现，也是整个 oracle 计划的第一步工程。

**② 行为流差分器已经建好了，只是左右臂都是自己人。**
`scripts/diff/d4-autoplay-streams.mjs:200-211` 的流结构就是我要的 oracle 元数据骨架：
```
pfEvents{ready,start,first,cta,end,endWin} + gestures[{i,t,stateBefore,type,x,y}]
+ gesturesCount + finalState + endScreenVisible + wallSec
```
判等逻辑在 `:234-259`（事件链相对次序、胜负必等、手势数 ±1、折叠手势序列全等）。**注意 `:236` 的 `chainOf` 只用了 ready/first/start/end 四个事件——`cta` 采到了却没判。**
**推论：oracle 比对的最小工程量不是"新建一套评测"，而是把 d4 的左臂从「oracle 仓旧实现」换成「真实广告」，把判据从"两侧等价"换成"我方落在真实广告分位区间内"。** 我认为这是本视角 ROI 最高的一条建议。

**③ 时长预算只有静态校验，运行期从未实测。**
`packages/spec/src/invariants.ts:52` 定义 `MAX_DURATION_SEC = 30`；`:276-286` 的 I4 只校验 `durationBudgetSec.max ≤ 30` 且 `target ≤ max`；`specs-eval/golden-match3.json:21` 写 `target:20, max:30`，`packages/spec/src/invariants.ts:19` 的注释只说"schema maximum 的第二层兜底"，**没有任何一处说明 30 这个数从哪来**。grep 全仓，`durationBudgetSec` 在 `qacore/` 与 `pf/` 里零消费。
**推论：30s 是一个无出处的内部拍脑袋值。真实广告"从打开到 CTA"的分布是多少，我们现在完全不知道——这正是 oracle 要填的第一个洞。**

**④ CTA 形式：spec 声明了，仓内自己承认没人实现。**
`packages/spec/src/types.ts:164` 有 `ctaStyle?: string`，四份 golden spec 都写了 `applovin: banner / meta: endcard`（例 `specs-eval/golden-match3.json:107-108`），而 `docs/specs/packager.md:152` 原话是「`+ctaStyle:"endcard"`，**打包器不消费 ctaStyle**」。模板侧唯一的 CTA 在结算页：`packages/templates/tmpl-match3/src/game.ts:804`（注释"CTA：点击 → PF.open(landingUrl)…脉冲动画"）与 `:829` 实际调用。
**推论：我们只能产出"结算页 CTA"，而真实可玩广告业界普遍是"游玩中常驻 CTA"。这是打开 oracle 视频第一眼就会看出来的差距——也说明 oracle 比对能产出产品级结论，而不只是合规报告。**（"常驻 CTA 是通行形态"这条业界共识，在本机**未找到可引用官方原文**，标【待验证】。）

**⑤ 反向确认**：`game.attract.{nearWin,failBait,firstClickSucceed}` 是有真实剧本的开关——`packages/templates/tmpl-match3/src/game.ts:508-517`（失败以"非法交换回弹"呈现、不消耗步数）、`tmpl-merge/src/game.ts:465-474` 同构。**但仓内没有任何度量说明它到底把胜率与时长改变了多少。** oracle 提供的就是这个缺失的外部参照。

**⑥ 顺带一条**：`channel-rules/channel-rules.json:2` 自述「数值为**行业基线 + 内部从严**，D9 官方工具实测后回填修订」。**我们现有的渠道数值本来就挂着"待用真实件校准"的欠条**——oracle 库同时是这条欠条的还款来源。

---

## 二、真实广告从哪里来：逐个渠道实测可得性

**环境约束先说**：本机通用搜索引擎不可用，命令与输出如下【实测】：
```
https://html.duckduckgo.com/html/?q=... → http=202, 14209 B, 解析出 0 条结果
https://lite.duckduckgo.com/lite/?q=...  → http=202
https://www.mjeek.com/search?q=...       → http=403
https://www.bing.com/search?q=...       → http=200, 90684 B, 但 0 个结果 <h2><a>
```
直接后果：**行业转化基准数字（CTR/CVR/INSTALL RATE）我一条都没能证实**，详见 §6。

### 2.1 广告情报/素材库（BigSpy / AppGrowing / MobileAction / Sensor Tower）
- **BigSpy**【实测】首页导航里确有独立入口 **"Playable Ads"**，链接为 `https://app.bigspy.com/adspy/playable-ads`（`curl -L` → http=200 / 239354 B），**但正文是空的**：纯客户端渲染（Next.js），静态抓取解析出的文本只有标题 `Playable Ads - BigSpy`。`https://bigspy.com/playable-ads` 是 **404**。首页另可见 `https://app.bigspy.com/adspy/ad-library?platform=unity_ads`（同样 200 / 239343 B、正文空）。BigSpy 自述覆盖 "Facebook / Instagram / AdMob / YouTube / TikTok / X / Pinterest / Yahoo / Unity / Pangle / AppLovin"。
- **MobileAction**【实测】`https://www.mobileaction.co/` http=200 / 190465 B，产品线含 ASO Intelligence / CMP / **Ad Intelligence（"Find and understand the ad creative best practices in your category"）**，入口是 `Book a Demo` / `Request a Demo`。
- **AppGrowing**【实测】`https://www.appgrowing.com/` → **http=000**（连接失败）。
- **Sensor Tower**：本机未单独探测，标【待验证】。
- **判断【推断】**：这一类平台交付的是**广告的录像/预览 + 投放元数据**，不交付 HTML5 源包——在投的可玩广告是广告主的资产，情报平台没有分发它的商业理由。所以它们对**体验 oracle（人看/盲评）**有用，对**结构/行为 oracle**几乎无用。我建议它们**不进 M0**，只在 M2 之后作为"品类创意趋势"输入。另外这类库天然偏向头部买量，长尾品类会系统性缺失。

### 2.2 平台官方 Creative Center / 预览（本次最高价值来源）
- **TikTok Creative Center**【实测】`https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en` → http=200 / 77118 B，页面文本明确有过滤维度 **Ad Format / Reach / CTR**、语言、地区，排序 "For You / Reach / CTR"。我打它的数据接口：
  ```
  curl "https://ads.tiktok.com/creative_radar_api/v1/top_ads/v2/list?page=1&limit=5&period=7&country_code=US&ad_format=playable"
  → {"code":40101,"msg":"no permission","request_id":"2026100321201189909623C29F9182E141"}
  ```
  **结论：网页公开、接口鉴权、素材是视频。可作"视频 oracle"来源，不可批量脚本化。**
- **Liftoff（原 Vungle）官方创意文档**【实测，本次最实的发现】`https://docs.liftoff.io/liftoff_creatives/ad_formats` → http=200，列出 **7 个可点开的 live creative preview**，全部指向 `tre-preview.liftoff.io/preview/index.html?...`：3 个 `madlib=true&size={banner,interstital,mrec}&creative=<hash>` + 4 个 `vm=true&creative=<hash>`。同站 `https://docs.liftoff.io/liftoff_creatives/interactive_api_integration` → http=200 / 67580 B，是一份**完整的 HTML 创意提交规范**，目录为：Folder Structure / Entry Point Requirements / Loading Assets / **Progressive Loading** / Sound Triggering / CORS for Web Workers / **Handling MRAID Load Sequence** / Handling Clicks / Filenames / IFrames / Sizing and Layout / **Close Buttons** / Watermarks / Video Encoding / Fonts / Testing Recommendations / **Asset File Sizes** / Creative Sizing。原文摘录：
  > "Liftoff accepts creatives as either a single HTML file or a zip file containing a single folder with all the assets…"
  > "Filenames within the zip must use ASCII characters only. Non-ASCII characters in filenames will cause your creative to fail."
  > "Only load what's needed to show the first screen or respond to the first user interaction… a small bootstrap bundle (10-20KB) renders something visible immediately → main bundle and assets load in the background on demand."

  **价值判断：这是"结构 oracle"里唯一有官方背书的一份，比任何广告库都更直接地回答"我们打的包对不对"，且完全合法可读。**
- **但是——预览页能不能抽出真包，我没有证实。**【实测】`curl "https://preview.liftoff-creatives.io/?fullscreen=true&creative_id=36d9657919"` → http=200 / 301966 B，页面引用了 `https://cdn.liftoff-creatives.io/customers/harry_key/images/originals/29dcb6810dd2ff17fd6a.gif`、`…/5743c97018ff42d8e40a.png` 与 `/ad_click?liftoff=true&param=123`；但对该 HTML 做关键词计数：`canvas` 0 次、`mraid` 0 次、`requestAnimationFrame` 0 次，引擎特征全 0，`<script>` 仅 **2** 个。**即：preview 页给的是展示壳（外加一张 base64 手机 mock），不是可运行创意包。** 我**没有**用无头浏览器打开它去看网络请求，所以"里面到底能不能下到真包"我标为**未证实**，并把它列为 M0-b 必做取证。
- **Google Ads Transparency Center**【实测】`https://adstransparency.google.com/` → http=200 / 2,540,640 B，JS 应用，免费无需登录，但只有视频/图片素材。**Meta Ads Library**【实测】`https://www.facebook.com/ads/library/` → **403**。
- **一个要记的坑**：`https://www.mraid.org/` 抓取直接失败，报 `ERR_TLS_CERT_ALTNAME_INVALID`（证书只覆盖 squarespace 相关域）。**别把 mraid.org 当权威源**；MRAID 事实请以 IABTechLab 的 `IABTechLab/SHARC`（README 首行自述是"to replace SafeFrame and MRAID"）与真实容器实现为准。

### 2.3 GitHub 开源件（免费、可脚本化、质量参差）
命令：`curl -s "https://api.github.com/search/repositories?q=playable+ad+html5&sort=stars&per_page=8"`【实测】
- **`ppgee/cocos-pnp`（385★）**"Cocos Playable Ads in Multi-Network"：README 明确列出 **11 个渠道** AppLovin / Facebook / Google / IronSource / Liftoff / Mintegral / Moloco / Pangle / Rubeex / Tiktok / Unity，并支持按渠道注入脚本、动态替换渠道名占位符 `{{__adv_channels_adapter__}}`。**这是真实生产级多渠道导出的形态参照——注意它有 Moloco、Rubeex，而我们 `channel-rules.json` 冻结的是 6 条投放渠道。**
- **`smoudjs/playable-sdk`（62★）**【实测 README】：列出 **26 个广告网络**、协议侧支持 **MRAID v2/v3** 与 DAPI，统一 `mraid.open` 之类接口与 resize/audio/lifecycle 抽象。**注意 v3——我们的规则库只写 MRAID 2.0。**（此条建议同步 MM-A，本视角不越界。）
- **`mraid/webtester`（80★）**【实测 README + 文件树】：自述"a community-driven tool to run MRAID ad units in a web environment… passes the compliance ad test provided by the IAB"，但同时写明 **"This project is currently unattended and is not scheduled for updates!!"** 且线上版不再维护、需本地跑。仓库 `compliance/units/` 是 **IAB 官方 MRAID v2 合规广告单元**（`expand.js` / `interstitial.txt` / `fullpage.txt` / `resize.txt` / `twopart-expand-part1.js` 等），`compliance/docs/` 是 6 份 IAB 合规文档 PDF，**仓库 LICENSE 为 BSD**。另有 `safari/mraid-main.js`（30768 B）是一个**真容器实现**；我从它 grep 出 **40 个 `mraid.*` 成员**，含 `open / close / expand / resize / useCustomClose / supports / isViewable / getScreenSize / getVersion / getState / signalReady / setOrientationProperties / getPlacementType` 等，版本串 `2.0`。
  **这是本次唯一一个"许可清晰、公开可下、且是 IAB 官方广告单元"的来源。** 但要诚实：它测的是**展示型/插屏型合规广告，不是小游戏**——**能做容器一致性 oracle，不能做吸引力 oracle。** 我**只读了文件树与 README，未下载未运行**。
- **`WckY/Playable-ads`（19★）**【实测文件树】：一个"全响应式 H5 试玩广告素材游戏大全"，含 10 个子目录：`Hexa Drawn / Idle Press / IdleGrassCutter / Kolor It / PaperPlanePlanet / Popstar消灭星星 / Will hero / madForDance / 猜画小歌2 / 球球你跳跳`。**这份目录本身就是高价值品类词表**（六边拼图、点击放置、割草 idle、Kolor-It 归类、纸飞机、消灭星星、舞蹈节奏、猜画、跳一跳）。**但 GitHub API 返回 `license: None`**，且它们是**复刻件不是原件**。处置见 §4。
- 其他在结果里出现、可备查的：`fkworld/cocos-to-playable-ad`（113★）、`ttcong194/Cocos-to-PlayableAd-HTML5`（17★）、`Sebmins/PlayableAd`（README 自述 "based off their hyper casual game Buca"，即真实素材的复刻）、`reybits/playable-ads`、`cristianmarcu/cyber-dash-html5-playable-ad`（PixiJS）。

### 2.4 YouTube teardown / 行业报告：**本机一条没取到**
搜索引擎不可用（§2 开头）⇒ 无法检索 teardown 视频。报告页实测：`liftoff.io/resources/casual-gaming-apps-report/` **404**、`/mobile-casual-gaming-apps-report/` **404**；`liftoff.io/resources/` http=200 / 874420 B 但链接全由 JS 渲染，正则抽到 **0** 个 `/resources/*` 直链；`www.adjust.com/resources/reports/` **429**；`www.adverblog.com/?s=playable` http=200 / 49643 B 但解析不出文章标题；`www.appsflyer.com/resources/reports/` **404**。**这一路在本机是空的，如实标为未取得。**

---

## 三、渠道取舍：我的排序与理由

【推断】按"能进 M0 的程度"排：

1. **平台官方创意文档 + 官方 preview（Liftoff 等）** —— 合法、免费、结构权威、可引用。→ 立刻做。
2. **IAB MRAID 合规单元 + `mraid-main.js` 容器（BSD）** —— 免费、许可清晰、能真跑。→ 立刻做，但只当"容器基线"。
3. **GitHub 开源生产工具链（cocos-pnp / playable-sdk / 单文件打包器）** —— 免费、可克隆、能当"结构参照"。→ M0 末做。
4. **真实创意包（若 M0-b 取证成立）** —— 最有价值、最不确定。→ M0 必做一次取证，做成则大赚。
5. **录屏（情报工具 / TikTok CC / Google AT）** —— 只喂体验盲评，不喂结构行为。→ M1 之后，账号成本待 owner 批。
6. **APK 资产提取**（下载真游戏 APK，apktool/jadx 解 `assets/`，找随包内置的 playable 目录）—— 技术上大概率可行，**我本次完全没有验证，也没有工具环境**；法律灰区最大。→ 只作提案 + 待 owner 拍板，**不进 M0**。
7. **YouTube teardown** —— 本机不可得，留给有网络环境的人补。

---

## 四、怎么拿到手：形态、抽取方法与合规

【推断】三种形态，三种不同的合规姿态：

- **形态 1：完整包（zip / 单 html）**。抽取方式：官方 preview 页用无头浏览器打开 → 记录全部网络请求 → 对命中 `index.html` / `.js` / `.png` / `.mp3` 的 URL 逐个回源下载 → 用资源清单（URL + 本地 sha256）复原目录树。**是否可行我未验证**（§2.2：静态抓到的页面里没有游戏代码）。
- **形态 2：内联页**。同形态 1，但创意代码直接内联在 HTML 里（像 `preview.liftoff-creatives.io` 那样），只需抽 HTML + `cdn.liftoff-creatives.io` 上的素材。
- **形态 3：录屏**。只能产出视频 + 人工/VLM 标注的时间轴。

**合规红线（建议写进 oracle 库 README，且建议 owner 签字后再收任何素材）**：
1. **研究口径、不投放、不二次分发**。样本不进公开仓，走内部只读存储；对外只发布**派生特征**（指标、分位数、rubric 评分），不发布原文件。
2. **不照抄素材**。真实广告的美术/音频/文案一律不进构建输入；oracle 目录只允许被 qacore / 差分器**只读消费**。最好在工具层强制：oracle 目录挂 read-only，`assetkit` 输入路径白名单显式排除它。
3. **复刻件与原件分层**。`WckY/Playable-ads` 这类（`license: None`）**不进 oracle 库**，最多读一遍目录名当品类词表就收工。
4. **来源与抓取时间逐条登记**（见 §5 元数据），任何引用必须能回指 URL + 抓取日期 + sha256。基线总文 §6.1 关于"留档漂移"的教训在这里同样适用。
5. **录屏入库的授权**与**APK 提取的合法性**属 owner 决策，见 §8。

---

## 五、oracle 样本库设计

**规模**【推断】：M0 先做 **30 条**，不要一上来 100 条。分三层：
- L1 官方 demo/规范件 **10 条**（Liftoff 7 个 preview + IAB 合规单元 3 个）——结构基线。
- L2 开源生产工具链产物 **8 条**（cocos-pnp 等按 11 渠道各出一个）——结构真实参照。
- L3 真实创意包 **12 条**（若取证成立，按品类配额：六边拼图 / 点击放置 / 合成 / 归类 idle / 跳跃 / 节奏 / 塔防 / 三消 / 画线 / 答题 / 放置 各 1）。
> 为什么不先上 100 条：每条真实包的抽取 + 无头测量是数分钟人工，100 条会拖死 M0；而结构/行为指标的分位数在 30 条上已经能给出粗略区间，够判断"我们是不是差了一个数量级"。

**每条记录什么（元数据 schema）**——**直接沿用 d4 的流结构再扩展**，这样同一份比对器既能跑 oracle 也能跑我方产物：
```
id, source_url, fetched_at, license_note, evidence_sha256
network, package_form(single-html|zip), entry_name, file_count, total_bytes
genre_bucket, input_model(tap|drag|swipe|tilt)
// 行为：沿用 d4-autoplay-streams.mjs:200-211 的字段名
pfEvents{ready,start,first,cta,end,endWin}, gestures[], gesturesCount,
finalState, endScreenVisible, wallSec
// 外来广告补充（qacore 现有探针拿不到，需新探针）
exit_api_called{name,arg,t_ms}, pixel_activity_series, video_len_ms,
drive_mode(solve|explore), drive_success
```
派生指标（全部可从上面算出，这是最值得固化的一层）：
- `t_first = first - ready`（首屏钩子：用户多久开始动手）
- `t_tutorial = start - first`（教学时长）
- `t_loop = end - start`（核心循环时长）
- `t_cta = cta - ready`（CTA 时机），`cta_form = 常驻 / 结算页`
- `gestures_per_sec`、`retry_count`、`win_rate`
**这些指标一旦在 30 条真实广告上跑出分位数，`MAX_DURATION_SEC = 30` 这个无出处的数（§1 ③）就有了出处的可能。**

---

## 六、「吸引人」的可度量代理指标：以及我拿不到的那一半

**能拿到的（自产基准）**【推断】：上面五个时间指标 + 手势密度，全部是"同一台 harness 测真实广告和我方产物"得到的**相对位置**。我认为这是唯一诚实的做法，理由有三：
1. **绝对行业数字取不到**（§2.4 已列证据：报告页 404/429/JS 渲染，搜索引擎 403/202/空结果）。
2. 即便取到，口径也不可归因：playable 的 CTR 高，究竟是**素材选得好**还是**投放定向/预算/竞价**？公开说法"创意贡献效果差异的大部分"我标为【待验证】，不能当验收线。
3. 我们交付的是"服务"，判据必须**自己能复跑**，否则就退回台账自述——基线总文 §6.2 刚清算过这个病。

**取不到的（必须承认）**：
- **CTA/安装转化率、CPI、CTR、ARPU** —— 属投放侧数据，公开不可得。我记得超休闲 playable 的 CTR 常被引在"个位数百分比"量级、CTR→CVR 转化常被引在"数十个百分点"量级，但**这些数字本次一条都没能验证，绝对不能进验收门**。
- **真实用户为什么会点** —— 需 A/B 实验预算，属 owner 决策。

**所以「吸引人」在本项目里只能被操作化为三件事**【推断】：
1. **同 harness 相对分位**：我方产物在 `t_first / t_tutorial / t_loop / t_cta` 上落在同品类真实广告的 **[P25, P75]** 内。超出不判 fail，判"偏离并登记"。
2. **红路必须能拒绝**：明显违反通行形态的（如 `t_loop` > 真实广告 P90、或首屏 10 秒内零交互）判 fail。
3. **盲评胜率**：VLM/人工两两对比我方 vs 真实广告，盲化、随机左右位、固定 rubric。这一层**必须有人类校准集**——我的判断是 VLM 对"这个可玩广告够不够抓人"的判断噪声很大，单独用 VLM 分数当门禁会制造假绿。

---

## 七、三种比对方法：各能回答什么、各自的坑

**A. 结构比对**
- 回答：包形态 / entry / 内联率 / 包体分位 / 退出接口 / CTA 形式 / 字体与音频内联方式，是否落在真实广告分布里。
- 我已预判两条高价值差异：① `ctaStyle` 未实现 → CTA 只能出现在结算页（`docs/specs/packager.md:152` 自认）；② 我们的 4 模板是"规则卡驱动的确定性盘面"，而真实广告的难度曲线是**为 30 秒体验手工调的**——`golden-match3.json:19` 的 `difficulty.targetLevel: 0.4` 就是一个没有外部参照的拍脑袋值。
- 坑：**结构差异 ≠ 质量差异**。真实包是 Cocos/Unity 导出的，我们是从头手写的引擎，文件树必然不同。结构比对只能判"硬约束"（entry 命名、ASCII 文件名、相对路径、case 敏感、包体上限、Liftoff 文档那类），**不能拿树形相似度当质量分**。

**B. 行为比对（事件流）**
- 回答：节奏像不像——首屏 / 教学 / 循环 / CTA 的相对时间分布。
- 做法：复用 d4 的驱动语义（`d4-autoplay-streams.mjs:53-60` 的 `SWEEP_VECTORS`、`DRAG_DISTANCE=44`、`:50` 的 180ms 轮询、`:51` 的 45s 预算），但**必须换掉输入源**。
- **最大的坑，也是我认为整个 oracle 计划最硬的技术风险**：真实广告没有 `__PF_QC__.hint()`（那是我们私有契约，见 `qacore/src/autoplay.ts:41-44`）。这意味着**我方产物能被确定性驱动到胜利结算页，真实广告不能**。行为比对因此退化为两种模式：
  - `drive_mode = solve`：只对我方产物有意义，产出"我们自己的事件流"；
  - `drive_mode = explore`：对真实广告用启发式/随机输入或 VLM 引导，**大概率到不了 CTA 时刻**，指标只能覆盖"前 N 秒"（`t_first`、`t_tutorial` 可测；`t_cta`、`t_loop` 多数测不到）。
  - **处置建议**：对真实广告优先用**像素活动序列**（逐帧差分）反推阶段边界——"画面开始动"= 开局、"画面进入低频静止"= 结算/CTA——这样 `t_cta / t_loop` 仍可估。精度会差，元数据里必须显式记 `t_cta_est: true`，**不许当精确值用**。
  - 结论性影响：既然真实广告无法确定性驱动，**"我方与真实广告事件流逐点等价"这个强判据永远做不成**。判据必须退到 §6 的"落在区间内"。

**C. 体验比对（盲评）**
- 回答：人更愿意玩哪个。
- 坑：① 必须**混同排版**（同样的缩放比例、同样的加载等待、同样的结束页样式），否则评的是包装不是玩法；② **疲劳效应**——同一评审连看 20 条会趋同，需成对交错 + 强制休息；③ 评审者要分层（投放/买量/普通用户），"吸引人"对不同人是不同的；④ **VLM 不能单独当门**。
- 成本现实：30 条 × 我方产物 = 60 个样本，人工两两对比不现实。**建议只对"指标已判偏离"的少数条目做盲评**——盲评是"抽检 + 定性"，不是全量门禁。

---

## 八、如果我定：建议与开放问题

**建议（按优先级）**：
1. **M0-a｜外来广告运行器（最高优先）**：在 qacore 旁新建一个**不复用 `checks.ts` 判定**的运行器，只复用 `PROBE_JS` 的音频/媒体/首指针部分 + 新增通用探针：pointer/touch/key 时间线 + 退出接口拦截（`mraid.open` / `FbPlayableAd.onComplete` / `ExitApi.exit` / `window.openAppStore`——这四个名字我们的 `channel-rules.json` 各渠道 `exit.call` 里已经写好了）+ 逐帧像素活动序列。产物 = 与 d4 同构的流 JSON。**理由：不解决这个，oracle 只是一堆视频。**
2. **M0-b｜取证**：用无头浏览器打开 Liftoff preview 与 TikTok CC，**记录网络请求**，回答"真实创意包到底能不能下"。我这次只做到静态抓取（结论偏向"拿不到游戏代码"），**取证未完成**。
3. **M0-c｜规范基线**：把 Liftoff Interactive Ad Integration 的官方要求逐条落成机检项（entry 命名 / ASCII 文件名 / 相对路径 / 大小写敏感 / 首屏小包+渐进加载 / MRAID load sequence / close button / 水印 / 字体 / 包体），并与 `channel-rules.json` 逐条对账。**这一步今天就能做，不依赖任何真实广告，是本视角里最便宜的高价值产出。**
4. **M1｜分位数基准**：30 条样本跑出 P25/P50/P75/P90，反过来给 `MAX_DURATION_SEC`、`durationBudgetSec.target`、`difficulty.targetLevel` 找依据（这三个数现在都是无出处的）。
5. **M2｜CTA 常驻化**：把 `ctaStyle` 从"声明不消费"变成"真实现"，并用 oracle 验证。

**需要 owner 拍板的开放问题**（我不替 owner 决定，但给倾向）：
1. **法律边界**：APK 提取真实创意、录屏入库是否可接受？我的倾向：**先只做官方公开 demo + 开源件 + 官方 preview**，APK 提取与录屏入库挂起，等一次法务口径。
2. **是否购买情报工具账号**（BigSpy / MobileAction / Sensor Tower 均有付费墙）：我的倾向：**M0 不买**——它们只解决体验 oracle，而体验 oracle 建议用官方 preview + 内部征集替代。
3. **基准归属**：自产分位数还是采信行业数字？我的倾向：**自产**（可复跑、可归因），行业数字只写进文档当背景，不进门禁。
4. **真人盲评的评审从哪来**：内部同事 / 外部众包 / 买量团队？影响 rubric 设计与成本。
5. **真实广告到"停在哪"**：只做结构+行为不做盲评（省钱、可全自动），还是必须做盲评（贵、才敢叫"吸引人"）？**这是"完成定义 L3 吸引人"能否成立的关键开关。我倾向：L3 初期定义为"结构+行为达标 + 盲评抽检通过"，而不是"盲评全量胜率"。**

**已知的不确定性（诚实登记）**：
- 我**没有**取到任何行业转化基准数字（搜索引擎在本环境不可用；报告页 404 / 429 / JS 渲染）。
- 我**没有**证实官方 preview 里能否抽出真实创意包（只做了静态抓取，结论偏向"拿不到游戏代码"）。
- `mraid/webtester` 与 IAB 合规单元**未下载、未运行**，我只读了文件树与 README。
- 所有"真实可玩广告普遍有常驻 CTA"之类的业界共识，在本文中只作**待验证假设**出现，我没有找到可引用的官方文档原文。
- 本文件写入前，目标路径已存在一份 25,830 B 的旧版 MM-B 文档（时间戳 20:37，非本会话产出）；我已把它原样备份为同目录 `thinking-MM-B-真实广告oracle.md.bak-20261003-2037` 后再覆写，未丢失任何既有内容。

---

*本轨迹只读仓、不改 `factory/` 下任何文件；所有行号引用均来自 2026-10-03 本机快照。所有网络结论均可由文中给出的 curl 命令复现。*
