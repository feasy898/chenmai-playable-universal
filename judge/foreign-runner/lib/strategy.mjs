/**
 * humanlike-lite-v0 策略（档 2 开环，cta_prior_knowledge=none）:
 *
 * - 首交互延迟 min 2500ms
 * - 最多 18 手势（tap .75 / drag .25）
 * - 3×5 网格中心偏置±抖动
 * - 间隔 700–1500ms 正态
 * - drag 44px×4 步复用 qacore 机械
 * - 退出即停（拦到退出后 ≤3s 不再输入）
 * - 观察窗 45s
 *
 * 种子派生：root=20261004，每件派生 uint32(sha256("<root>|<artifactId>") 前4字节BE)
 * PRNG = mulberry32，消费顺序固定（delay→jitter_x→jitter_y→drag判定）。
 */

import { THRESHOLDS } from "../../../config/thresholds.mjs";

const ROOT_SEED = "20261004";

export async function deriveSeed(artifactId) {
  const crypto = await import("node:crypto");
  const hash = crypto.createHash("sha256").update(`${ROOT_SEED}|${artifactId}`).digest();
  const seed = (hash[0] << 24) | (hash[1] << 16) | (hash[2] << 8) | hash[3];
  return seed >>> 0;
}

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function normalRandom(rng) {
  // Box-Muller
  const u1 = rng() || 0.0001;
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export function createStrategy(artifactId) {
  const seed = deriveSeed(artifactId);
  const rng = mulberry32(seed);
  const budgetSec = THRESHOLDS.autoplayBudgetSec;
  const maxGestures = THRESHOLDS.maxGestures;
  const firstDelayMin = THRESHOLDS.firstInteractionDelayMinMs;
  const viewportW = THRESHOLDS.viewportWidth;
  const viewportH = THRESHOLDS.viewportHeight;

  const gestures = [];
  const delaySteps = [firstDelayMin + normalRandom(rng) * 500];
  for (let i = 1; i < maxGestures; i++) {
    delaySteps.push(700 + normalRandom(rng) * 800);
  }

  const gridCols = 3;
  const gridRows = 5;
  const cellW = viewportW / gridCols;
  const cellH = viewportH / gridRows;

  let stopped = false;
  let gestureIndex = 0;
  let t = delaySteps[0];

  function jitter() {
    return (rng() - 0.5) * 2 * Math.min(cellW, cellH) * 0.2;
  }

  return {
    next(timestamp, exitDetected) {
      if (stopped) return null;
      if (exitDetected) {
        stopped = true;
        return { type: 'stop', delayMs: 0 };
      }
      if (gestureIndex >= maxGestures || t > budgetSec * 1000) {
        return null;
      }
      const isDrag = rng() < 0.25;
      const col = Math.floor(rng() * gridCols);
      const row = Math.floor(rng() * gridRows);
      const cx = cellW * (col + 0.5);
      const cy = cellH * (row + 0.5);
      const x = Math.max(10, Math.min(viewportW - 10, cx + jitter()));
      const y = Math.max(10, Math.min(viewportH - 10, cy + jitter()));

      const g = {
        type: isDrag ? 'drag' : 'tap',
        x,
        y,
        delayMs: delaySteps[gestureIndex] || 1000,
        dwellMs: isDrag ? 100 : 50,
        dx: isDrag ? 44 : 0,
        dy: isDrag ? 0 : 0,
        timestamp
      };
      gestureIndex += 1;
      t += g.delayMs;
      return g;
    },
    seed,
    maxGestures,
    budgetSec
  };
}
