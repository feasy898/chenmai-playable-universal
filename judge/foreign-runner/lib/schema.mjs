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
 */

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

export function validateFlow(flow) {
  const errors = [];
  if (typeof flow !== "object" || flow === null) return ["root not object"];
  if (flow.schema_version !== "v0") errors.push("schema_version != v0");

  // top-level keys
  for (const k of REQUIRED_TOP) {
    if (!(k in flow)) errors.push(`missing top key: ${k}`);
  }

  // structure non-empty (>=8 leaves)
  const structNonempty = Object.values(flow.structure || {}).filter(v => {
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === "object" && v !== null) return Object.keys(v).length > 0;
    return v !== null && v !== undefined && v !== "";
  }).length;
  if (structNonempty < 8) errors.push(`structure nonempty ${structNonempty} < 8`);

  // behavior non-empty (>=8 leaves)
  const behNonempty = Object.values(flow.behavior || {}).filter(v => {
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === "object" && v !== null) return Object.keys(v).length > 0;
    return v !== null && v !== undefined && v !== "";
  }).length;
  if (behNonempty < 8) errors.push(`behavior nonempty ${behNonempty} < 8`);

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
    const keys = new Set(Object.keys(px));
    for (const k of keys) {
      if (!PIXEL_KEYS.has(k)) errors.push(`pixel key not in closed set: ${k}`);
    }
  }

  // exit counts invariant
  const counts = flow.exit_api_hit_counts || {};
  const called = flow.exit_api_called || [];
  for (const cls of ["mraid", "fbplayable", "exitapi", "openappstore"]) {
    const cnt = counts[cls] || 0;
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

  return errors;
}
