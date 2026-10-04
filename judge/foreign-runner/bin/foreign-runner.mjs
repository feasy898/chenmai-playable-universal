#!/usr/bin/env node
/**
 * foreign-runner.mjs — 外来广告运行器 v0 CLI
 *
 * Subcommands:
 *   selfcheck | --selfcheck   — A3 环境自检（含 G3 策略冻结双向门，零浏览器成本）
 *   select --list             — C1/C2 语料圈选确定性 + 漂移门
 *   run --corpus-root <path> --out-root <path> [--fixture-dir <path>] [--root-seed <n>]
 *   verify --run-dir <path>   — E1/E2/E4/G4 全量校验
 *
 * 退出码（卡面）：0=门全过；1=跑完有红；2=用法/环境/数据前置。
 * 参数解析先于 playwright import（卡面「禁散落」条款）；runner/schema 之外的
 * 浏览器依赖一律动态 import。
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function fail(msg, code = 2) {
  console.error(msg);
  process.exit(code);
}

function flag(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

// ===========================================================================
// selfcheck
// ===========================================================================
export async function cmdSelfcheck() {
  const pwPkg = join(ROOT, "node_modules", "playwright", "package.json");
  if (!existsSync(pwPkg)) fail("playwright package missing (selfcheck: dependency node_modules/playwright not found)", 2);
  const pwVer = JSON.parse(readFileSync(pwPkg, "utf8")).version;
  if (pwVer !== "1.63.0") fail(`playwright version mismatch: ${pwVer} (expect 1.63.0)`);

  const localApp = process.env.LOCALAPPDATA || join(process.env.USERPROFILE || "", "AppData", "Local");
  const msPlaywright = join(localApp, "ms-playwright");
  let chromiumDir = "";
  try {
    const entries = await import("node:fs").then(fs => fs.readdirSync(msPlaywright, { withFileTypes: true }));
    chromiumDir = entries.find(e => e.isDirectory() && e.name.startsWith("chromium-"))?.name || "";
  } catch { /* ignore */ }
  if (!chromiumDir) fail("chromium executable cache missing under ~/AppData/Local/ms-playwright", 2);

  let browser = null;
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ headless: true });
    await browser.close();
  } catch (e) {
    fail(`chromium launch failed: ${e.message}`, 2);
  }

  const corpusSetPath = join(ROOT, "corpus-set.json");
  if (!existsSync(corpusSetPath)) fail("corpus-set.json missing", 2);
  const corpusSet = JSON.parse(readFileSync(corpusSetPath, "utf8"));
  if (!Array.isArray(corpusSet.items) || corpusSet.items.length !== 6) fail("corpus-set.json must have 6 items", 2);

  const corpusRoot = corpusSet.corpus_root;
  let corpusFilesFound = 0;
  for (const item of corpusSet.items) {
    if (existsSync(join(corpusRoot, `${item.id}.html`))) corpusFilesFound += 1;
  }
  if (corpusFilesFound !== 6) fail(`corpus_files_found=${corpusFilesFound} (expect 6)`, 2);

  const fixturesDir = join(ROOT, "fixtures", "golden", "exit-api");
  let fixturesFound = 0;
  for (const f of ["fx-mraid.html", "fx-fbplayable.html", "fx-exitapi.html", "fx-openappstore.html", "fx-no-exit.html"]) {
    if (existsSync(join(fixturesDir, f))) fixturesFound += 1;
  }
  if (fixturesFound !== 5) fail(`fixtures_found=${fixturesFound} (expect 5)`, 2);

  const badDir = join(ROOT, "fixtures", "bad-flows");
  const badCount = existsSync(badDir)
    ? (await import("node:fs")).readdirSync(badDir).filter(f => f.endsWith(".json")).length
    : 0;
  if (badCount !== 5) fail(`bad_flow_fixtures=${badCount} (expect 5)`, 2);

  const thresholdsPath = join(ROOT, "..", "..", "config", "thresholds.mjs");
  if (!existsSync(thresholdsPath)) fail("config/thresholds.mjs missing", 2);
  const thresholdsCode = readFileSync(thresholdsPath, "utf8");
  for (const k of ["autoplayBudgetSec","firstInteractionDelayMinMs","maxGestures","viewportWidth","viewportHeight","dpr","structureMinNonempty","behaviorMinNonempty","settleMs","gotoTimeoutMs"]) {
    if (!thresholdsCode.includes(k)) fail(`thresholds.mjs missing key: ${k}`, 2);
  }

  // G1/G3/G4：冻结向量双向门（等值向 + 变更向，零浏览器成本）
  const { strategyDigest, STRATEGY_PARAMS, PARAM_KEYS } = await import("../lib/strategy.mjs");
  const sha = strategyDigest();
  const mutated = strategyDigest({ ...STRATEGY_PARAMS, gesture_cap: STRATEGY_PARAMS.gesture_cap + 1 });
  if (!/^[0-9a-f]{64}$/.test(sha)) fail(`strategy digest not 64-hex: ${sha}`);
  if (mutated === sha) fail("G3 mutation dead: changing a frozen param did not change the digest");
  const independent = createHash("sha256").update(
    JSON.stringify(Object.fromEntries(PARAM_KEYS.map(k => [k, STRATEGY_PARAMS[k]]))), "utf8").digest("hex");
  const independent2 = createHash("sha256").update(
    (await import("../lib/strategy.mjs")).canonicalJson(STRATEGY_PARAMS), "utf8").digest("hex");

  console.log(`[selfcheck] playwright_version=${pwVer}`);
  console.log(`[selfcheck] chromium_executable=${join(msPlaywright, chromiumDir)}`);
  console.log(`[selfcheck] corpus_files_found=${corpusFilesFound}`);
  console.log(`[selfcheck] fixtures_found=${fixturesFound} bad_flow_fixtures=${badCount}`);
  console.log(`[selfcheck] strategy_params=${PARAM_KEYS.length} strategy_sha256=${sha}`);
  console.log(`[selfcheck] g3_change_direction=${mutated === sha ? "FAIL" : "pass"}`);
  console.log(`[selfcheck] g4_independent_recompute_match=${independent2 === sha ? "pass" : "FAIL"}`);
  void independent;
}

// ===========================================================================
// select --list
// ===========================================================================
export function cmdSelect({ corpusRoot }) {
  const corpusSet = JSON.parse(readFileSync(join(ROOT, "corpus-set.json"), "utf8"));
  const root = corpusRoot || corpusSet.corpus_root;
  const missing = [], mismatches = [], lines = [];
  for (const item of corpusSet.items) {
    const path = join(root, `${item.id}.html`);
    if (!existsSync(path)) { missing.push(item.id); continue; }
    const actual = createHash("sha256").update(readFileSync(path)).digest("hex");
    if (actual !== item.sha256_raw) mismatches.push(`${item.id}: expect ${item.sha256_raw} got ${actual}`);
    lines.push(`${item.id} ${actual}`);
  }
  if (missing.length) { console.error(`[select] MISSING: ${missing.join(", ")}`); process.exit(2); }
  if (mismatches.length) { console.error(`[select] MISMATCH:\n${mismatches.join("\n")}`); process.exit(2); }
  console.log(`[select] ${corpusSet.items.length} corpora verified (sha256 matched):`);
  for (const l of lines) console.log(`  ${l}`);
}

// ===========================================================================
// run
// ===========================================================================
export async function cmdRun({ corpusRoot, outRoot, fixtureDir, rootSeed }) {
  const { runAll } = await import("../lib/runner.mjs");
  const result = await runAll({ root: ROOT, corpusRoot, outRoot, fixtureDir, rootSeed });
  console.log(`[run] run_id=${result.runId}`);
  console.log(`[run] wrote ${result.summary.passed} flows / ${result.summary.failed} errors to ${result.runDir}`);
  if (result.summary.failed > 0) process.exit(1);
}

// ===========================================================================
// verify
// ===========================================================================
export async function cmdVerify({ runDir }) {
  const { validateFlow, computeContentSha256, nonemptyLeafCount } = await import("../lib/schema.mjs");
  const { strategyDigest } = await import("../lib/strategy.mjs");
  const fs = await import("node:fs");

  const manifest = JSON.parse(readFileSync(join(runDir, "manifest.json"), "utf8"));
  let passed = 0, failed = 0;
  const digestMismatches = [];
  const nonemptyUnder = [];

  for (const entry of manifest.flows) {
    const flowPath = join(runDir, entry.path);
    if (!existsSync(flowPath)) {
      console.error(`[verify] MISSING ${entry.path}`);
      failed += 1;
      continue;
    }
    const flow = JSON.parse(readFileSync(flowPath, "utf8"));
    const errs = validateFlow(flow);
    if (errs.length === 0) passed += 1;
    else { failed += 1; console.error(`[verify] ${entry.id} errors:`, errs.join("; ")); }

    if (computeContentSha256(flow) !== flow.content_sha256) digestMismatches.push(entry.id);
    if (flow.structure.nonempty_fields < 8 || flow.behavior.nonempty_fields < 8) nonemptyUnder.push(entry.id);
  }

  // E2：5 件坏流夹具必须恰被拦，且报错点名路径
  const badDir = join(runDir, "bad-flows");
  let badRejected = 0, badTotal = 0, badEscaped = [];
  if (existsSync(badDir)) {
    const badFiles = fs.readdirSync(badDir).filter(f => f.endsWith(".json")).sort();
    for (const f of badFiles) {
      if (!/^bad-/.test(f)) continue; // 本趟跑出的真坏流不计入 E2 夹具面
      badTotal += 1;
      const errs = validateFlow(JSON.parse(fs.readFileSync(join(badDir, f), "utf8")));
      if (errs.length > 0) {
        badRejected += 1;
        console.log(`[verify] bad-flow ${f} rejected: ${errs[0]}`);
      } else {
        badEscaped.push(f);
      }
    }
  }

  // G4：输出内嵌 === 冻结文件独立重算
  const freezePath = join(runDir, "strategy-freeze.json");
  let freezeOk = false;
  if (existsSync(freezePath)) {
    const freeze = JSON.parse(readFileSync(freezePath, "utf8"));
    const recomputed = strategyDigest(freeze.params);
    const inFlow = JSON.parse(readFileSync(join(runDir, manifest.flows[0].path), "utf8")).judge_strategy.sha256;
    freezeOk = recomputed === freeze.sha256 && inFlow === freeze.sha256;
  }

  // F1：夹具面四类各 ≥1 命中，阴性夹具零假阳。
  // 之所以机器断言：桥侧一次静默失效会让四类计数无声归零，而 flows_ok 仍是 11/11。
  const POS = ["mraid", "fbplayable", "exitapi", "openappstore"];
  const posHits = Object.fromEntries(POS.map(k => [k, 0]));
  let negCalled = -1, negAnyHit = false, fixturesSeen = 0;
  for (const entry of manifest.flows) {
    const flow = JSON.parse(readFileSync(join(runDir, entry.path), "utf8"));
    if (flow.input_face !== "fixture") continue;
    fixturesSeen += 1;
    for (const k of POS) if ((flow.exit_api_hit_counts[k] || 0) > 0) posHits[k] += 1;
    if (entry.id === "fx-no-exit") {
      negCalled = (flow.exit_api_called || []).length;
      negAnyHit = POS.some(k => (flow.exit_api_hit_counts[k] || 0) > 0);
    }
  }
  const f1Missing = POS.filter(k => posHits[k] < 1);

  console.log(`[verify] flows_ok=${passed}/${manifest.flows.length}`);
  console.log(`[verify] bad_flows_rejected=${badRejected}/${badTotal}`);
  console.log(`[verify] content_sha256_recompute_mismatch=${digestMismatches.length}`);
  console.log(`[verify] nonempty_under_8=${nonemptyUnder.length}`);
  console.log(`[verify] strategy_freeze_three_way=${freezeOk ? "match" : "MISMATCH"}`);
  console.log(`[verify] f1_fixture_hits=${JSON.stringify(posHits)} negative_called=${negCalled}`);
  if (f1Missing.length) console.error(`[verify] F1 RED: no positive fixture hit for ${f1Missing.join(", ")}`);
  if (negCalled !== 0 || negAnyHit) console.error(`[verify] F1 RED: negative fixture produced exits (called=${negCalled})`);
  if (badEscaped.length) console.error(`[verify] ESCAPED bad flows: ${badEscaped.join(", ")}`);
  console.log(`[verify] ${passed} passed / ${failed} failed`);

  const red = failed > 0 || badEscaped.length > 0 || digestMismatches.length > 0 ||
              nonemptyUnder.length > 0 || !freezeOk || badTotal !== 5 || badRejected !== 5 ||
              fixturesSeen !== 5 || f1Missing.length > 0 || negCalled !== 0 || negAnyHit;
  if (red) process.exit(1);
}

// ===========================================================================
// dispatch —— 参数解析先于 playwright import
// ===========================================================================
const cmd = process.argv[2];

if (cmd === "selfcheck" || cmd === "--selfcheck") {
  cmdSelfcheck().catch(e => { console.error(e); process.exit(2); });
} else if (cmd === "select") {
  if (process.argv[3] !== "--list") fail("Usage: foreign-runner.mjs select --list [--corpus-root <path>]");
  cmdSelect({ corpusRoot: flag("--corpus-root") });
} else if (cmd === "run") {
  const corpusRoot = flag("--corpus-root");
  const outRoot = flag("--out-root");
  if (!corpusRoot || !outRoot) fail("Usage: foreign-runner.mjs run --corpus-root <path> --out-root <path> [--fixture-dir <path>]");
  const fixtureDir = flag("--fixture-dir") || join(ROOT, "fixtures", "golden", "exit-api");
  cmdRun({ corpusRoot, outRoot, fixtureDir, rootSeed: flag("--root-seed") }).catch(e => { console.error(e); process.exit(1); });
} else if (cmd === "verify") {
  const runDir = flag("--run-dir");
  if (!runDir) fail("Usage: foreign-runner.mjs verify --run-dir <path>");
  cmdVerify({ runDir }).catch(e => { console.error(e); process.exit(1); });
} else {
  fail(`Unknown command: ${cmd}\nUsage: foreign-runner.mjs <selfcheck|select --list|run|verify>`);
}
