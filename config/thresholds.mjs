// ============================================================================
// 待拍板阈值集中常量表（U-06：全仓 grep 无散落硬编码阈值；owner 裁决后在此一次性替换）
// 依据：最终测试文档.md §一「autoplay 45s vs durationBudget 30s：M0 owner 裁决前进
// 集中常量表占位，裁决后一次性替换，禁止散落硬编码」；最终规划文档.md §5.3。
// 纪律：任何模块需要阈值时 import 本表，禁止在业务代码里写字面量。
// ============================================================================

export const PENDING_THRESHOLDS = {
  // 【待 M0 owner 裁决】autoplay 预算 45s 与 durationBudget max 30s 不一致（CONTRACTS 痛点 7 遗留）
  autoplayBudgetSec: 45,       // 占位值，非已确认规格
  durationBudgetMaxSec: 30,    // 占位值，非已确认规格
};
