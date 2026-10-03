# chenmai-playable-universal · 可玩广告通用产线（升级线新仓）

> PU-0002 建仓（2026-10-03）。规划裁定：新起 sibling 仓，`factory\chenmai8\` 冻结为差分 oracle（A 级资产，禁改）。
> 状态：**纯仓骨架，零业务代码**。git 纯本地（**不配 remote、不 push**——ESC-018 owner 未裁决）。

## 权威文档（绝对路径，单一事实源）

- 规划：`D:\new-workspace\澄迈项目\可玩广告\_playable_plan\最终规划文档.md`（v1.0，十节+15 裁定；本仓组织裁定=§5.1，模块切分=§5.2）
- 测试：`D:\new-workspace\澄迈项目\可玩广告\_playable_plan\最终测试文档.md`（v1.0，48 可见+13 holdout；目录与留档制度=§六，仓储纪律静态断言=§二 U-06）
- oracle（冻结禁改）：`D:\new-workspace\澄迈项目\可玩广告\factory\chenmai8\`
- holdout 保密目录：`<PU_HOLDOUT_DIR>`（仓外，worker 禁读；任何入 git 文件只许写此占位符）

## 仓纪律（第一天起，U-06 断言对象）

1. **白名单制度**：`.gitignore` 默认忽略一切、显式放行白名单；新增顶层条目必须登记。`runs/` 首日放行（留档转正靠制度，不靠 force-add）。
2. **只追加写盘**：门禁留档落 `runs/<date>-<commit>/`，同门禁重跑落新目录，旧目录永不覆盖（自验工具 `node tools/probe-append-only.mjs`）。
3. **先清后跑**：每趟判官先删本趟目标报告路径再跑，跑完断言存在且非空。
4. **字节防漂移**：`.gitattributes` 含 `* -text`（跨平台 checkout 不改写行尾；sha256 校验前行尾归一化）。
5. **阈值集中**：待拍板阈值一律进 `config/thresholds.mjs` 常量表，grep 无散落（U-06）。
6. **隔离例外**：`data/oracle-isolated/` 白名单排除，永不入库、只读语义；真实源包禁入 git。

## 目录结构（测试文档 §六 + 规划 §5.2）

```
runs/<date>-<commit>/      # 只追加留档根（.gitignore 白名单放行）
  ├─ NN-<gate>/report.json # 门禁产物（内容域：零时间戳、进哈希）
  ├─ manifest.json         # 封装域侧车（时间/机器/git/jobs）
  └─ ledger.ndjson         # 机生台账（每轮一条；「当前状态」是查询不是文件）
fixtures/{golden,bad,mut,cassette}/   # 金标/负例/变异/cassette 夹具
data/inputs/               # 输入集登记（入库）
data/oracle-isolated/      # oracle 源包隔离目录（不入 git、只读、白名单排除）
intake/ understand/ plan/ synthesize/ package/ judge/ report-regression/   # 七模块空壳（各见其 README）
config/thresholds.mjs      # 待拍板阈值常量表
tools/                     # 仓库工具（探针/复核器，只用标准库）
```

## 红线速查（全文见规划/测试权威文档）

- oracle 冻结禁改；外部输入禁注 `__PF_QC__`；平台规格数值未获官方原文一律标待验证；密钥零落盘。
