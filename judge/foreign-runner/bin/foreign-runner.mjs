#!/usr/bin/env node
/**
 * foreign-runner.mjs — 外来广告运行器 v0 CLI
 *
 * Subcommands:
 *   selfcheck            — A3 环境自检
 *   select --list        — C1/C2 语料圈选确定性+漂移门
 *   run --corpus-root <path> --out-root <path> [--fixture-dir <path>]
 *   verify --run-dir <path>
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { runAll } from "../lib/runner.mjs";
import { validateFlow } from "../lib/schema.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function fail(msg, code = 2) {
  console.error(msg);
  process.exit(code);
}

// ===========================================================================
// selfcheck
// ===========================================================================
export async function cmdSelfcheck() {
  const pwPkg = join(ROOT, "node_modules", "playwright", "package.json");
  if (!existsSync(pwPkg)) fail("playwright package missing");
  const pwVer = JSON.parse(readFileSync(pwPkg, "utf8")).version;
  if (pwVer !== "1.63.0") fail(`playwright version mismatch: ${pwVer} (expect 1.63.0)`);

  const localApp = process.env.LOCALAPPDATA || join(process.env.USERPROFILE || "", "AppData", "Local");
  const msPlaywright = join(localApp, "ms-playwright");
  let chromiumDir = "";
  try {
    const entries = await import("node:fs").then(fs => fs.readdirSync(msPlaywright, { withFileTypes: true }));
    chromiumDir = entries.find(e => e.isDirectory() && e.name.startsWith("chromium-"))?.name || "";
  } catch { /* ignore */ }
  if (!chromiumDir) fail("chromium executable cache missing under ~/AppData/Local/ms-playwright");

  let browser = null;
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ headless: true });
    await browser.close();
  } catch (e) {
    fail(`chromium launch failed: ${e.message}`);
  }

  const corpusSetPath = join(ROOT, "corpus-set.json");
  if (!existsSync(corpusSetPath)) fail("corpus-set.json missing");
  const corpusSet = JSON.parse(readFileSync(corpusSetPath, "utf8"));
  if (!Array.isArray(corpusSet.items) || corpusSet.items.length !== 6) fail("corpus-set.json must have 6 items");

  const fixturesDir = join(ROOT, "fixtures", "golden", "exit-api");
  for (const f of ["fx-mraid.html","fx-fbplayable.html","fx-exitapi.html","fx-openappstore.html","fx-no-exit.html"]) {
    if (!existsSync(join(fixturesDir, f))) fail(`fixture missing: ${f}`);
  }

  const thresholdsPath = join(ROOT, "..", "..", "..", "config", "thresholds.mjs");
  if (!existsSync(thresholdsPath)) fail("config/thresholds.mjs missing");
  const thresholdsCode = readFileSync(thresholdsPath, "utf8");
  for (const k of ["autoplayBudgetSec","firstInteractionDelayMinMs","maxGestures","viewportWidth","viewportHeight","dpr","structureMinNonempty","behaviorMinNonempty","settleMs","gotoTimeoutMs"]) {
    if (!thresholdsCode.includes(k)) fail(`thresholds.mjs missing key: ${k}`);
  }

  console.log(`[selfcheck] OK: playwright ${pwVer} / chromium ${chromiumDir} / corpus 6 / fixtures 5 / thresholds keys present`);
}

// ===========================================================================
// select --list
// ===========================================================================
export function cmdSelect({ corpusRoot }) {
  const corpusSet = JSON.parse(readFileSync(join(ROOT, "corpus-set.json"), "utf8"));
  const missing = [], mismatches = [], lines = [];
  for (const item of corpusSet.items) {
    const path = join(corpusRoot, `${item.id}.html`);
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
export async function cmdRun({ corpusRoot, outRoot, fixtureDir }) {
  const result = await runAll({ root: ROOT, corpusRoot, outRoot, fixtureDir });
  console.log(`[run] wrote ${result.summary.passed} flows / ${result.summary.failed} errors to ${result.runDir}`);
}

// ===========================================================================
// verify
// ===========================================================================
export function cmdVerify({ runDir }) {
  const flowsDir = join(runDir, "flows");
  const files = readFileSync(join(runDir, "manifest.json"), "utf8");
  const manifest = JSON.parse(files);
  let passed = 0, failed = 0;
  for (const entry of manifest.flows) {
    const flowPath = join(runDir, entry.path);
    if (!existsSync(flowPath)) {
      console.error(`[verify] MISSING ${entry.path}`);
      failed += 1;
      continue;
    }
    const flow = JSON.parse(readFileSync(flowPath, "utf8"));
    const errs = validateFlow(flow);
    if (errs.length === 0) {
      passed += 1;
    } else {
      failed += 1;
      console.error(`[verify] ${entry.id} errors:`, errs.join("; "));
    }
  }
  console.log(`[verify] ${passed} passed / ${failed} failed`);
  if (failed > 0) process.exit(1);
}

// ===========================================================================
// dispatch
// ===========================================================================
const cmd = process.argv[2];
if (cmd === "selfcheck") {
  cmdSelfcheck().catch(e => { console.error(e); process.exit(1); });
} else if (cmd === "select") {
  const corpusRootIdx = process.argv.indexOf("--corpus-root");
  const corpusRoot = corpusRootIdx >= 0 ? process.argv[corpusRootIdx + 1] : ".";
  if (process.argv[3] === "--list") {
    cmdSelect({ corpusRoot });
  } else {
    fail("Usage: bin/foreign-runner.mjs select --list [--corpus-root <path>]");
  }
} else if (cmd === "run") {
  const corpusRootIdx = process.argv.indexOf("--corpus-root");
  const outRootIdx = process.argv.indexOf("--out-root");
  const fixtureIdx = process.argv.indexOf("--fixture-dir");
  const corpusRoot = corpusRootIdx >= 0 ? process.argv[corpusRootIdx + 1] : ".";
  const outRoot = outRootIdx >= 0 ? process.argv[outRootIdx + 1] : ".";
  const fixtureDir = fixtureIdx >= 0 ? process.argv[fixtureIdx + 1] : join(ROOT, "fixtures", "golden", "exit-api");
  cmdRun({ corpusRoot, outRoot, fixtureDir }).catch(e => { console.error(e); process.exit(1); });
} else if (cmd === "verify") {
  const runDirIdx = process.argv.indexOf("--run-dir");
  const runDir = runDirIdx >= 0 ? process.argv[runDirIdx + 1] : ".";
  cmdVerify({ runDir });
} else {
  fail(`Unknown command: ${cmd}\nUsage: bin/foreign-runner.mjs <selfcheck|select --list|run|verify>`);
}
