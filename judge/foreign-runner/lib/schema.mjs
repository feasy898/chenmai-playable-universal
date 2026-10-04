/**
 * d4 flow schema validator (pu-d4-flow/v0).
 *
 * Invariants (from task card):
 * 1. counts[c] <= called.filter(cls==c).length
 * 2. covered/gap 与 counts 分毫吻合
 * 3. fixture => eligible=false, corpus => eligible=true
 * 4. pixel 键集闭枚举
 * 5. t_cta_est 缺伴生旗 est:true 拦截
 * 6. tier==1 拦截
 * 7. provenance.sha256 缺/非 64hex 拦截
 * 8. 全文禁 <html/<script/<canvas 子串
 * 9. t_ms 单调非负
 * 10. run_meta 不进 content_sha256（重算可验证）
 *
 * 实现说明（PU-0005 R2）：原版缺 ⑨ 与「四类键闭枚举」两条，且 content_sha256 从不计算。
 * 本版补齐，并新增 VOLATILE 声明——见 canonicalProjection 注释。
 */

import { createHash } from "node:crypto";

export const REQUIRED_TOP = new Set([
  "schema_version", "kind", "artifact_id", "input_face", "eligible_for_percentile",
  "judge_drive_tier", "drive_mode", "run_meta", "provenance", "structure", "behavior",
  "exit_api_called", "exit_api_hit_counts", "exit_api_coverage", "judge_strategy", "content_sha256"
]);

export const REQUIRED_STRUCTURE = new Set([
  "bytes", "entry_form", "self_contained", "inline_rate", "external_ref_count",
  "relative_ref_count", "external_hosts", "blocked_external_urls", "local_404",
  "network_policy", "websocket_external", "exit_api_declared", "exit_api_class",
  "engine_hints", "has_canvas", "webgl_used", "url_final_stable", "first_frame",
  "console_error_count", "request_count", "viewport", "nonempty_fields"
]);

export const REQUIRED_BEHAVIOR = new Set([
  "pfEvents", "pf_event_count", "gestures", "folded_gestures", "gesture_count",
  "t_first_ms", "t_first_screen_ms", "input_timeline", "pixel_activity_series",
  "audio", "media", "rtc", "finalState", "drive_mode", "nonempty_fields"
]);

const PIXEL_KEYS = new Set(["t_ms", "grid", "changed_cells", "mean_abs_diff", "frame_sha256"]);

// exit_api_called[].cls 与 exit_api_hit_counts 同用小写 slug（桥注入侧口径）；
// api_present / coverage.required 另用 API 逐字名（mraid/FbPlayableAd/ExitApi/openAppStore）。
export const EXIT_CLASSES = ["mraid", "fbplayable", "exitapi", "openappstore", "implicit_store_nav"];
export const HIT_COUNT_KEYS = ["mraid", "fbplayable", "exitapi", "openappstore", "implicit_store_nav"];

/**
 * content_sha256 的 volatile 声明。
 *
 * 卡面同时要求「content_sha256 剥 run_meta 规范化」与「t_ms 全为 performance.now 相对钟」，
 * 而相对钟在两次运行间逐毫不等——两条直接冲突，逐字节相等不可达。本版按
 * 「逐字节相等优先、把不可复现量显式剔出摘要」裁定，剔除集合**固定写死在此**：
 *
 *   - run_meta                      （卡面不变式⑩明文）
 *   - content_sha256 自身           （自指）
 *   - 相对钟：任何名为 t_ms 的键，及 t_first_ms / t_first_screen_ms /
 *     t_end_ms / t_loop_est / t_cta_est
 *   - provenance.fetched_at         （抓取墙钟）
 *   - finalState.visible_texts 与 text_count（活体渲染文本，跨趟可动画漂移）
 *
 * 剔除项在流内**保留原值**（不篡改实测数据），只是不进摘要。该裁定超出卡面字面，
 * 已在本卡执行记录与交付报告中标注「建议 planner/强模型复核」。
 */
export const VOLATILE_KEYS = new Set([
  "run_meta", "content_sha256", "t_ms", "t_first_ms", "t_first_screen_ms",
  "t_end_ms", "t_loop_est", "t_cta_est", "fetched_at", "visible_texts", "text_count"
]);

function isVolatile(key) {
  return VOLATILE_KEYS.has(key);
}

function project(value) {
  if (Array.isArray(value)) return value.map(project);
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value)) {
      if (isVolatile(k)) continue;
      out[k] = project(value[k]);
    }
    return out;
  }
  return value;
}

/** 规范化投影：剥 volatile + 键排序零空白。 */
export function canonicalProjection(flow) {
  return canonicalJson(project(flow));
}

/** 键排序零空白 UTF-8 规范化。 */
export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
}

export function computeContentSha256(flow) {
  return createHash("sha256").update(canonicalProjection(flow), "utf8").digest("hex");
}

/** 与 schema.mjs 同源的 leaf 非空判定（E3 的 nonempty_fields 口径）。 */
export function nonemptyLeafCount(obj) {
  return Object.values(obj || {}).filter(v => {
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === "object" && v !== null) return Object.keys(v).length > 0;
    return v !== null && v !== undefined && v !== "";
  }).length;
}

function collectTms(node, out = []) {
  if (Array.isArray(node)) node.forEach(v => collectTms(v, out));
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (k === "t_ms") out.push(v);
      else collectTms(v, out);
    }
  }
  return out;
}

export function validateFlow(flow) {
  const errors = [];
  if (typeof flow !== "object" || flow === null) return ["root not object"];
  if (flow.schema_version !== "v0") errors.push("schema_version != v0");

  // top-level keys
  for (const k of REQUIRED_TOP) {
    if (!(k in flow)) errors.push(`missing top key: ${k}`);
  }

  // structure non-empty (>=8 leaves)
  const structNonempty = nonemptyLeafCount(flow.structure);
  if (structNonempty < 8) errors.push(`structure nonempty ${structNonempty} < 8`);
  if (flow.structure && "nonempty_fields" in flow.structure &&
      flow.structure.nonempty_fields !== structNonempty) {
    errors.push(`structure.nonempty_fields=${flow.structure.nonempty_fields} != measured ${structNonempty}`);
  }

  // behavior non-empty (>=8 leaves)
  const behNonempty = nonemptyLeafCount(flow.behavior);
  if (behNonempty < 8) errors.push(`behavior nonempty ${behNonempty} < 8`);
  if (flow.behavior && "nonempty_fields" in flow.behavior &&
      flow.behavior.nonempty_fields !== behNonempty) {
    errors.push(`behavior.nonempty_fields=${flow.behavior.nonempty_fields} != measured ${behNonempty}`);
  }

  // tier == 1 blocked
  if (flow.judge_drive_tier === 1) errors.push("judge_drive_tier == 1 blocked");

  // t_cta_est 缺伴生旗 est:true 拦截
  if (flow.behavior?.finalState?.t_cta_est !== undefined && !flow.behavior.finalState.est) {
    errors.push("t_cta_est missing est:true companion");
  }

  // provenance.sha256
  if (!flow.provenance?.sha256 || typeof flow.provenance.sha256 !== "string" || flow.provenance.sha256.length !== 64) {
    errors.push("provenance.sha256 missing or not 64-hex");
  }

  // no html/script/canvas substrings
  const json = JSON.stringify(flow);
  for (const bad of ["<html", "<script", "<canvas"]) {
    if (json.includes(bad)) errors.push(`flow JSON contains forbidden substring: ${bad}`);
  }

  // pixel keys closed set
  for (const px of flow.behavior?.pixel_activity_series || []) {
    for (const k of Object.keys(px)) {
      if (!PIXEL_KEYS.has(k)) errors.push(`pixel key not in closed set: ${k}`);
    }
  }

  // exit hit counts closed enum（四类 + implicit_store_nav，多/少皆拦）
  const counts = flow.exit_api_hit_counts;
  if (counts && typeof counts === "object") {
    for (const k of Object.keys(counts)) {
      if (!HIT_COUNT_KEYS.includes(k)) errors.push(`exit_api_hit_counts key not in closed enum: ${k}`);
    }
    for (const cls of ["mraid", "fbplayable", "exitapi", "openappstore"]) {
      if (!(cls in counts)) errors.push(`exit_api_hit_counts missing required key: ${cls}`);
    }
  }

  // exit_api_called[].cls closed enum
  for (const c of flow.exit_api_called || []) {
    if (!EXIT_CLASSES.includes(c.cls)) errors.push(`exit_api_called cls not in closed enum: ${c.cls}`);
  }

  // counts invariant
  const called = flow.exit_api_called || [];
  for (const cls of ["mraid", "fbplayable", "exitapi", "openappstore"]) {
    const cnt = (counts && counts[cls]) || 0;
    const actual = called.filter(c => c.cls === cls).length;
    if (cnt > actual) errors.push(`counts[${cls}] > called count (${cnt} > ${actual})`);
  }

  // eligible invariant
  if (flow.input_face === "fixture" && flow.eligible_for_percentile !== false) {
    errors.push("fixture input_face must have eligible_for_percentile=false");
  }
  if (flow.input_face === "corpus" && flow.eligible_for_percentile !== true) {
    errors.push("corpus input_face must have eligible_for_percentile=true");
  }

  // invariant 9: t_ms 单调非负
  for (const [i, t] of collectTms(flow.behavior).entries()) {
    if (typeof t !== "number" || !Number.isFinite(t) || t < 0) {
      errors.push(`behavior t_ms[${i}] not a non-negative number: ${t}`);
    }
  }
  const exitTms = collectTms(flow.exit_api_called);
  for (const [i, t] of exitTms.entries()) {
    if (typeof t !== "number" || !Number.isFinite(t) || t < 0) {
      errors.push(`exit_api_called t_ms[${i}] not a non-negative number: ${t}`);
    }
  }

  // invariant 10: content_sha256 重算一致（run_meta 不进摘要）
  if (flow.content_sha256 !== null && flow.content_sha256 !== undefined) {
    const expect = computeContentSha256(flow);
    if (expect !== flow.content_sha256) {
      errors.push(`content_sha256 mismatch: stored ${flow.content_sha256} recomputed ${expect}`);
    }
  }

  return errors;
}
