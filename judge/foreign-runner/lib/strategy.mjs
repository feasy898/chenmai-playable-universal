/**
 * humanlike-lite-v0 策略（档 2 开环，cta_prior_knowledge=none）:
 *
 * - 首交互延迟 min 2500ms（取自 config/thresholds.mjs）
 * - 最多 18 手势（tap .75 / drag .25，取自 config/thresholds.mjs）
 * - 3×5 网格中心偏置±抖动
 * - 间隔 700–1500ms 正态
 * - drag 44px×4 步复用 qacore 机械
 * - 退出即停（拦到退出后 ≤3s 不再输入）
 * - 观察窗取自 config/thresholds.mjs
 *
 * 种子派生：root=20261004，每件派生 uint32(sha256("<root>|<artifactId>") 前4字节BE)
 * PRNG = mulberry32，消费顺序固定（delay→jitter_x→jitter_y→drag判定）。
 *
 * 冻结向量：STRATEGY_PARAMS 十六项即 G 组 sha256 的被冻对象；本文件是**唯一**参数来源，
 * strategy-freeze.json 与流内 judge_strategy.sha256 均由同一向量重算（G4 三方一致）。
 */

import { createHash } from "node:crypto";
import { THRESHOLDS } from "../../../config/thresholds.mjs";

const ROOT_SEED = "20261004";

export const ROOT_SEED_VALUE = ROOT_SEED;

/** 冻结集 16 项（键排序零空白 UTF-8 后取 sha256）。 */
export const STRATEGY_PARAMS = Object.freeze({
  version: "humanlike-lite-v0",
  root_seed: ROOT_SEED,
  drive_tier: 2,
  autoplay_budget_sec: THRESHOLDS.autoplayBudgetSec,
  first_interaction_delay_min_ms: THRESHOLDS.firstInteractionDelayMinMs,
  gesture_cap: THRESHOLDS.maxGestures,
  drag_probability: 0.25,
  drag_distance_px: 44,
  drag_steps: 4,
  interval_ms_min: 700,
  interval_ms_max: 1500,
  interval_jitter_sigma_ms: 200,
  grid_cols: 3,
  grid_rows: 5,
  jitter_xy_ratio: 0.2,
  exit_stop_grace_ms: 3000
});

export const PARAM_KEYS = Object.keys(STRATEGY_PARAMS).sort();

/** 键排序零空白 UTF-8 规范化。 */
export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
}

/** 冻结向量 sha256（G1/G4 的唯一重算入口）。 */
export function strategyDigest(params = STRATEGY_PARAMS) {
  return createHash("sha256").update(canonicalJson(params), "utf8").digest("hex");
}

/** 派生自 (root_seed, artifactId) 的 uint32 种子（H4 可复算）。 */
export function deriveSeed(artifactId, rootSeed = ROOT_SEED) {
  const hash = createHash("sha256").update(`${rootSeed}|${artifactId}`).digest();
  return (((hash[0] << 24) | (hash[1] << 16) | (hash[2] << 8) | hash[3]) >>> 0);
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

export function createStrategy(artifactId, params = STRATEGY_PARAMS) {
  const seed = deriveSeed(artifactId, params.root_seed);
  const rng = mulberry32(seed);
  const budgetSec = params.autoplay_budget_sec;
  const maxGestures = params.gesture_cap;
  const firstDelayMin = params.first_interaction_delay_min_ms;

  const cellW = THRESHOLDS.viewportWidth / params.grid_cols;
  const cellH = THRESHOLDS.viewportHeight / params.grid_rows;

  // 消费顺序固定：先全部 delay，再 jitter_x / jitter_y / drag 判定
  const delaySteps = [firstDelayMin + normalRandom(rng) * 500];
  for (let i = 1; i < maxGestures; i++) {
    delaySteps.push(params.interval_ms_min + normalRandom(rng) * params.interval_jitter_sigma_ms);
  }

  let stopped = false;
  let gestureIndex = 0;
  let t = delaySteps[0];

  function jitter() {
    return (rng() - 0.5) * 2 * Math.min(cellW, cellH) * params.jitter_xy_ratio;
  }

  return {
    next(timestamp, exitDetected) {
      if (stopped) return null;
      if (exitDetected) {
        stopped = true;
        return { type: "stop", delayMs: 0 };
      }
      if (gestureIndex >= maxGestures || t > budgetSec * 1000) return null;

      const col = Math.floor(rng() * params.grid_cols);
      const row = Math.floor(rng() * params.grid_rows);
      const x = Math.max(10, Math.min(THRESHOLDS.viewportWidth - 10,
        cellW * (col + 0.5) + jitter()));
      const y = Math.max(10, Math.min(THRESHOLDS.viewportHeight - 10,
        cellH * (row + 0.5) + jitter()));
      const isDrag = rng() < params.drag_probability;

      const g = {
        type: isDrag ? "drag" : "tap",
        x,
        y,
        delayMs: Math.max(params.interval_ms_min,
          Math.min(params.interval_ms_max, delaySteps[gestureIndex] || delaySteps[delaySteps.length - 1])),
        dwellMs: isDrag ? 100 : 50,
        dx: isDrag ? params.drag_distance_px : 0,
        dy: 0,
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
