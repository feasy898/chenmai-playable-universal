/**
 * vendor-copy from D:\new-workspace\pu-workbench\qacore\src\autoplay.ts (lines 15-23)
 * source sha256: e4effd67fedd44c528c50fac86339792baa30c3004ea232834ef02a15c83430f
 * 手势语义表（冻结）：swap-left/right/up/down → 定向拖拽（44px×4 步）。
 */
export const DRAG_DISTANCE = 44.0;

const SWEEP_VECTORS: Record<string, [number, number]> = {
  "swap-left": [-1.0, 0.0],
  "swap-right": [1.0, 0.0],
  "swap-up": [0.0, -1.0],
  "swap-down": [0.0, 1.0],
  "drag": [1.0, 0.0],
};
