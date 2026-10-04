/**
 * Runner core: Playwright orchestration for foreign-runner v0.
 *
 * Per flow artifact:
 *  - serve artifact HTML on localhost
 *  - inject container bridge + probe
 *  - drive humanlike-lite-v0 gestures (or none for fixture)
 *  - collect structure + behavior + exit_api facts
 *  - write d4 flow JSON
 *
 * PU-0005 R2 修订要点（原版多处硬编码占位，本版改为实算）：
 *  - 语料 sha256 漂移门前置（C3/C4）：逐件复算 vs corpus-set.json，不等即 exit 2 且不落盘
 *  - provenance 来源改为 manifest（source_url / license_status / bytes / sha256_manifest_match）
 *  - nonempty_fields 实测（原版硬编码 1）
 *  - judge_strategy.sha256 与 content_sha256 实算（原版恒 null）
 *  - bad-flows/ 落 5 件坏流夹具（原版空目录）
 *  - 趟目录只追加，已存在则递增 -02（原来同名覆盖，违 D3）
 */

import { chromium } from "playwright";
import { readFileSync, existsSync, writeFileSync, mkdirSync, copyFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";

import { ArtifactServer } from "../vendor/qacore/server.mjs";
import { bridgeSource } from "./container-bridge.mjs";
import { readProbe, readExitLog, readPageState } from "./probes.mjs";
import { createStrategy, deriveSeed, strategyDigest, STRATEGY_PARAMS, ROOT_SEED_VALUE } from "./strategy.mjs";
import { validateFlow, nonemptyLeafCount, computeContentSha256 } from "./schema.mjs";
import { THRESHOLDS } from "../../../config/thresholds.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

function nowIso() {
  return new Date().toISOString();
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function ensureDir(p) {
  mkdirSync(p, { recursive: true });
}

function writeJson(p, obj) {
  writeFileSync(p, JSON.stringify(obj, null, 2), "utf8");
}

function gitShortSha(cwd) {
  try { return execSync("git rev-parse --short HEAD", { cwd, encoding: "utf8" }).trim(); }
  catch { return "unknown"; }
}

function utcDateStamp() {
  const d = new Date();
  return `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}${String(d.getUTCDate()).padStart(2,'0')}`;
}

/**
 * C3/C4 语料漂移门：逐件复算 raw sha256 与 corpus-set 钉死值比对。
 * 返回 { ok, drifts:[{id,expected,actual,path}] }；由调用方决定 exit 2。
 */
export function verifyCorpusDrift(corpusSet, corpusRoot) {
  const drifts = [];
  for (const item of corpusSet.items) {
    const path = join(corpusRoot, `${item.id}.html`);
    if (!existsSync(path)) {
      drifts.push({ id: item.id, expected: item.sha256_raw, actual: "MISSING", path });
      continue;
    }
    const actual = sha256File(path);
    if (actual !== item.sha256_raw) {
      drifts.push({ id: item.id, expected: item.sha256_raw, actual, path });
    }
  }
  return { ok: drifts.length === 0, drifts };
}

/** 只追加趟目录：已存在则递增 -02 / -03 …（D3；原版同名覆盖） */
function resolveRunDir(outRoot, baseId) {
  let runId = baseId;
  let n = 1;
  while (existsSync(join(outRoot, runId, "01-foreign-runner"))) {
    n += 1;
    runId = `${baseId}-${String(n).padStart(2, "0")}`;
  }
  return { runId, runDir: join(outRoot, runId, "01-foreign-runner") };
}

export async function runOne({ artifactPath, artifactId, inputFace, manifestItem, strategyParams = STRATEGY_PARAMS }) {
  const server = new ArtifactServer(dirname(artifactPath), 0);
  const port = await server.start();
  const url = server.url_for(basename(artifactPath));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: THRESHOLDS.viewportWidth, height: THRESHOLDS.viewportHeight },
    isMobile: true,
    deviceScaleFactor: THRESHOLDS.dpr,
    serviceWorkers: "block"
  });
  const page = await context.newPage();

  // instrumented container bridge (非被测物)
  await page.addInitScript({ content: bridgeSource() });

  // probe injection (每页面一次)
  const PROBE_JS = (await import("../vendor/qacore/probe.mjs")).PROBE_JS;
  await page.addInitScript(new Function(PROBE_JS));

  // route layer: block external, record requests, stub container runtime scripts
  const externalUrls = [];
  const runtimeStubs = [];
  const requestLog = [];
  const consoleErrors = [];
  const localNotFound = [];

  page.on("console", m => { if (m.type() === "error") consoleErrors.push(String(m.text())); });

  await page.route("**/*", async (route) => {
    const req = route.request();
    let parsed;
    try { parsed = new URL(req.url()); } catch { return route.abort(); }
    const entry = { url: req.url(), method: req.method(), resource_type: req.resourceType(), status: null, blocked: false, failed: false, stub: false };
    requestLog.push(entry);
    if (parsed.hostname !== "127.0.0.1" && parsed.port !== String(port)) {
      entry.blocked = true;
      if (!externalUrls.includes(req.url())) externalUrls.push(req.url());
      await route.abort();
      return;
    }
    const name = parsed.pathname.split("/").pop() || "";
    if (["mraid.js", "FbPlayableAd.js", "ExitApi.js"].includes(name) && !existsSync(join(dirname(artifactPath), name))) {
      entry.status = 200;
      entry.stub = true;
      if (!runtimeStubs.includes(req.url())) runtimeStubs.push(req.url());
      await route.fulfill({ status: 200, contentType: "application/javascript", body: "/* stub */" });
      return;
    }
    const resp = await route.fetch().catch(() => null);
    if (resp) {
      entry.status = resp.status();
      if (resp.status() === 404) localNotFound.push(req.url());
      await route.fulfill({ response: resp });
    } else {
      entry.failed = true;
      await route.abort();
    }
  });

  // WebSocket记账（不close）
  await page.routeWebSocket("**/*", (ws) => {
    const u = ws.url();
    let parsed;
    try { parsed = new URL(u); } catch { return; }
    if (parsed.hostname !== "127.0.0.1" || parsed.port !== String(port)) {
      const k = `websocket:${u}`;
      if (!externalUrls.includes(k)) externalUrls.push(k);
    }
  });

  await page.goto(url, { waitUntil: "load", timeout: THRESHOLDS.gotoTimeoutMs });
  await page.waitForTimeout(THRESHOLDS.settleMs);

  // strategy drive (fixture 零手势)
  let exitDetected = false;
  const strategy = inputFace === "corpus" ? createStrategy(artifactId, strategyParams) : null;
  const gestures = [];
  const inputTimeline = { pointer: [], touch: [], key: [] };

  if (strategy) {
    const deadline = Date.now() + THRESHOLDS.autoplayBudgetSec * 1000;
    await page.waitForTimeout(THRESHOLDS.firstInteractionDelayMinMs);

    while (Date.now() < deadline) {
      const t = performance.now();
      const exitLog = await readExitLog(page);
      if (exitLog.log.length > 0 && exitLog.log[exitLog.log.length - 1].t_ms > (t - STRATEGY_PARAMS.exit_stop_grace_ms)) {
        exitDetected = true;
        break;
      }
      const g = strategy.next(t, exitDetected);
      if (!g || g.type === "stop") break;

      await page.mouse.move(g.x, g.y);
      inputTimeline.pointer.push({ t_ms: Math.round(t), type: g.type, x: Math.round(g.x), y: Math.round(g.y), dx: g.dx || 0, dy: g.dy || 0, delay_ms: Math.round(g.delayMs), dwell_ms: g.dwellMs });
      if (g.type === "drag") {
        for (let i = 1; i <= STRATEGY_PARAMS.drag_steps; i++) {
          await page.mouse.move(g.x + (g.dx * i / STRATEGY_PARAMS.drag_steps), g.y + (g.dy * i / STRATEGY_PARAMS.drag_steps), { steps: 1 });
        }
      } else {
        await page.mouse.down();
        await page.mouse.up();
      }
      gestures.push({ i: gestures.length, t_ms: Math.round(t), type: g.type, x: g.x, y: g.y, dx: g.dx || 0, dy: g.dy || 0, delay_ms: Math.round(g.delayMs), dwell_ms: g.dwellMs });
      await page.waitForTimeout(g.delayMs);
    }
  }

  // fixtures need a single first interaction to trigger exit APIs
  if (!strategy) {
    const cx = THRESHOLDS.viewportWidth / 2;
    const cy = THRESHOLDS.viewportHeight / 2;
    await page.waitForTimeout(THRESHOLDS.firstInteractionDelayMinMs);
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.up();
    gestures.push({ i: 0, t_ms: Math.round(performance.now()), type: "tap", x: cx, y: cy, dx: 0, dy: 0, delay_ms: 0, dwell_ms: 50 });
    inputTimeline.pointer.push({ t_ms: Math.round(performance.now()), type: "tap", x: cx, y: cy, dx: 0, dy: 0, delay_ms: 0, dwell_ms: 50 });
  }

  // collect facts
  const probe = await readProbe(page);
  const exitLog = await readExitLog(page);
  const pageState = await readPageState(page);
  const artifactSha = sha256File(artifactPath);

  await context.close();
  await browser.close();
  await server.stop();

  return buildFlow({
    artifactId, inputFace, url, port, probe, exitLog, gestures, inputTimeline,
    requestLog, externalUrls, runtimeStubs, pageState, consoleErrors, localNotFound,
    strategySeed: strategy ? strategy.seed : null, artifactSha, manifestItem, artifactPath,
    strategyParams
  });
}

function basename(p) {
  return p.split(/[\\/]/).pop();
}

function buildFlow({ artifactId, inputFace, url, port, probe, exitLog, gestures, inputTimeline, requestLog, externalUrls, runtimeStubs, pageState, consoleErrors, localNotFound, strategySeed, artifactSha, manifestItem, artifactPath, strategyParams = STRATEGY_PARAMS }) {
  const t_first = probe?.first ?? null;
  const t_cta = probe?.cta ?? null;
  const texts = pageState?.texts || [];
  const textCount = pageState?.textCount ?? texts.length;

  const finalState = {
    reached: probe?.end != null,
    t_end_ms: probe?.end ?? null,
    t_loop_est: null,
    end_win: probe?.endWin ?? null,
    screenshot_sha256: null,
    final_variance: null,
    visible_texts: texts.slice(0, 10),
    text_count: textCount
  };
  if (t_cta != null) {
    finalState.t_cta_est = t_cta;
    finalState.est = true;
  }

  const exitCalled = (exitLog.log || []).map(e => ({
    api: e.api,
    cls: e.cls,
    t_ms: Math.round(e.t_ms),
    url: e.url ?? null,
    arg_count: e.arg_count,
    suppressed_navigation: e.suppressed_navigation !== false,
    provenance: inputFace
  }));

  const hitCounts = {};
  for (const k of ["mraid", "fbplayable", "exitapi", "openappstore", "implicit_store_nav"]) {
    hitCounts[k] = exitLog.hit_counts?.[k] ?? 0;
  }

  // api_present 口径（F3/F5/F6）：
  //  夹具面 = 容器桥四钩子在位 → 四类全 present；
  //  语料面 = manifest 静态声明（corpus-set.static_exit）∪ 本趟实观测到的调用。
  //  不以「桥自己定义了桩」充数，否则 gap_classes 恒空、F3 的 0/44 供给事实无法如实登记。
  const declared = declaredClasses(manifestItem?.static_exit);
  const apiPresent = {
    mraid: exitCalled.some(e => e.cls === "mraid") || declared.has("mraid") || inputFace === "fixture",
    FbPlayableAd: exitCalled.some(e => e.cls === "fbplayable") || declared.has("fbplayable") || inputFace === "fixture",
    ExitApi: exitCalled.some(e => e.cls === "exitapi") || declared.has("exitapi") || inputFace === "fixture",
    openAppStore: exitCalled.some(e => e.cls === "openappstore") || declared.has("openappstore") || inputFace === "fixture"
  };
  const absentNotes = Object.entries(apiPresent).filter(([, v]) => !v).map(([k]) => `${k}_absent`);
  const covered = Object.values(apiPresent).filter(Boolean).length;
  const gapClasses = Object.keys(apiPresent).filter(k => !apiPresent[k]);

  const bytes = artifactPath && existsSync(artifactPath) ? readFileSync(artifactPath).length : 0;

  const flow = {
    schema_version: "v0",
    kind: inputFace === "corpus" ? "product-flow" : "oracle-runner-flow",
    artifact_id: artifactId,
    input_face: inputFace,
    eligible_for_percentile: inputFace === "corpus",
    judge_drive_tier: STRATEGY_PARAMS.drive_tier,
    drive_mode: "probe-inject",
    t_cta_est: t_cta,
    run_meta: {
      host: "windev-01",
      port,
      git: "present",
      playwright_version: "1.63.0",
      wall_clock_start_ms: Date.now()
    },
    provenance: {
      sha256: artifactSha,
      fetched_at: nowIso(),
      license_status: manifestItem?.license_status ?? "self-authored",
      entry_id: artifactId,
      source_url: manifestItem?.source_url ?? (inputFace === "corpus" ? `oracle-staging://${artifactId}` : `fixture://exit-api/${artifactId}`),
      bytes,
      sha256_manifest_match: manifestItem ? artifactSha === manifestItem.sha256_raw : null,
      corpus_root: inputFace === "corpus" ? String(manifestItem?.corpus_root ?? "") : null
    },
    structure: {
      bytes,
      entry_form: manifestItem?.form ?? "selfcontained",
      self_contained: !externalUrls.length,
      inline_rate: 0,
      external_ref_count: externalUrls.filter(u => !u.startsWith("websocket:")).length,
      relative_ref_count: requestLog.filter(r => !r.blocked && !r.stub).length,
      external_hosts: [...new Set(externalUrls.map(u => { try { return new URL(u).host; } catch { return "unknown"; } }))].sort(),
      blocked_external_urls: [...externalUrls].sort(),
      local_404: localNotFound.length,
      network_policy: "block-external",
      websocket_external: externalUrls.filter(u => u.startsWith("websocket:")).length,
      exit_api_declared: [...new Set(exitCalled.map(e => e.api))].sort(),
      exit_api_class: [...new Set(exitCalled.map(e => e.cls))].sort(),
      engine_hints: [],
      has_canvas: pageState?.hasCanvas || false,
      webgl_used: false,
      url_final_stable: String(pageState?.url || "").startsWith(`http://127.0.0.1:${port}/`),
      first_frame: { ok: false, variance: null, blank: null, reason: "pixel sampler deferred to v1" },
      console_error_count: consoleErrors.length,
      request_count: requestLog.length,
      viewport: { width: THRESHOLDS.viewportWidth, height: THRESHOLDS.viewportHeight },
      nonempty_fields: 0
    },
    behavior: {
      pfEvents: [],
      pf_event_count: 0,
      gestures: gestures.map(g => ({
        i: g.i, t_ms: Math.round(g.t_ms), type: g.type,
        x: Math.round(g.x), y: Math.round(g.y), dx: g.dx || 0, dy: g.dy || 0,
        delay_ms: Math.round(g.delay_ms), dwell_ms: g.dwell_ms
      })),
      folded_gestures: [],
      gesture_count: gestures.length,
      t_first_ms: t_first ? Math.round(t_first) : null,
      t_first_screen_ms: null,
      input_timeline: inputTimeline,
      pixel_activity_series: [],
      audio: { created: false, running: false, everBeforeFirstGesture: false, ...(probe?.audio || {}) },
      media: { unmuted: false, playing: false, playsBeforeFirst: 0, ...(probe?.media || {}) },
      rtc: probe?.rtc ?? 0,
      finalState,
      drive_mode: "probe-inject",
      nonempty_fields: 0
    },
    exit_api_called: exitCalled,
    exit_api_hit_counts: hitCounts,
    exit_api_coverage: {
      required: ["mraid.open", "FbPlayableAd.*", "ExitApi.exit", "openAppStore"],
      covered,
      gap_classes: gapClasses,
      api_present: apiPresent,
      absent_notes: absentNotes
    },
    judge_strategy: {
      version: strategyParams.version,
      root_seed: strategyParams.root_seed,
      seed: strategySeed ?? 0,
      sha256: strategyDigest(strategyParams),
      params: { ...strategyParams }
    },
    content_sha256: null
  };

  flow.structure.nonempty_fields = nonemptyLeafCount(flow.structure);
  flow.behavior.nonempty_fields = nonemptyLeafCount(flow.behavior);
  flow.content_sha256 = computeContentSha256(flow);
  return flow;
}

/** corpus-set.static_exit（静态声明口径）→ 四类 cls 集合。 */
function declaredClasses(staticExit) {
  const s = String(staticExit || "").toLowerCase();
  const set = new Set();
  if (s.includes("mraid")) set.add("mraid");
  if (s.includes("fbplayable")) set.add("fbplayable");
  if (s.includes("exitapi")) set.add("exitapi");
  if (s.includes("open_app_store") || s.includes("openappstore")) set.add("openappstore");
  return set;
}

export async function runAll({ root, corpusRoot, outRoot, fixtureDir, rootSeed }) {
  const strategyParams = rootSeed ? { ...STRATEGY_PARAMS, root_seed: String(rootSeed) } : STRATEGY_PARAMS;
  const corpusSet = JSON.parse(readFileSync(join(root, "corpus-set.json"), "utf8"));

  // C3/C4 漂移门：先算后跑，任一漂移即 exit 2 且零写入
  const drift = verifyCorpusDrift(corpusSet, corpusRoot);
  if (!drift.ok) {
    console.error(`[run] CORPUS DRIFT: ${drift.drifts.length} 件 sha256 与 corpus-set.json 不符`);
    for (const d of drift.drifts) {
      console.error(`[run]   ${d.id}\n[run]     expect ${d.expected}\n[run]     actual ${d.actual}`);
    }
    process.exit(2);
  }

  const sha = gitShortSha(root);
  const { runId, runDir } = resolveRunDir(outRoot, `${utcDateStamp()}-${sha}`);
  ensureDir(join(runDir, "flows"));
  ensureDir(join(runDir, "bad-flows"));

  const items = corpusSet.items;
  const ledger = [];
  const summary = { run_id: runId, corpus_root: corpusRoot, fixture_dir: fixtureDir, artifacts: [], passed: 0, failed: 0, errors: {}, corpus_drift: "0/6" };

  for (const item of items) {
    const path = join(corpusRoot, `${item.id}.html`);
    const flow = await runOne({
      artifactPath: path, artifactId: item.id, inputFace: "corpus",
      manifestItem: { ...item, corpus_root: corpusRoot }, strategyParams
    });
    const errs = validateFlow(flow);
    const rel = join("flows", `${item.id}.json`);
    if (errs.length === 0) {
      writeJson(join(runDir, rel), flow);
      summary.artifacts.push({ id: item.id, status: "ok", path: rel });
      summary.passed += 1;
    } else {
      writeJson(join(runDir, "bad-flows", `${item.id}.json`), flow);
      summary.artifacts.push({ id: item.id, status: "error", path: rel, errors: errs });
      summary.failed += 1;
      summary.errors[item.id] = errs;
    }
    ledger.push({ artifact_id: item.id, input_face: "corpus", status: errs.length === 0 ? "ok" : "error", errors: errs });
  }

  // fixtures (exit API + negative control)
  const fixtures = ["fx-mraid.html", "fx-fbplayable.html", "fx-exitapi.html", "fx-openappstore.html", "fx-no-exit.html"];
  for (const f of fixtures) {
    const path = join(fixtureDir, f);
    const aid = f.replace(".html", "");
    const flow = await runOne({ artifactPath: path, artifactId: aid, inputFace: "fixture", manifestItem: null, strategyParams });
    const errs = validateFlow(flow);
    const rel = join("flows", `${aid}.json`);
    if (errs.length === 0) {
      writeJson(join(runDir, rel), flow);
      summary.artifacts.push({ id: aid, status: "ok", path: rel });
      summary.passed += 1;
    } else {
      writeJson(join(runDir, "bad-flows", `${aid}.json`), flow);
      summary.artifacts.push({ id: aid, status: "error", path: rel, errors: errs });
      summary.failed += 1;
      summary.errors[aid] = errs;
    }
    ledger.push({ artifact_id: aid, input_face: "fixture", status: errs.length === 0 ? "ok" : "error", errors: errs });
  }

  // E2 面：坏流夹具复制进 bad-flows/（恰 5 件）
  const badSrc = join(root, "fixtures", "bad-flows");
  for (const f of readdirSync(badSrc).filter(f => f.endsWith(".json")).sort()) {
    copyFileSync(join(badSrc, f), join(runDir, "bad-flows", f));
  }

  // strategy freeze (G1/G4：与流内同源重算)
  writeJson(join(runDir, "strategy-freeze.json"), {
    version: strategyParams.version,
    root_seed: strategyParams.root_seed,
    sha256: strategyDigest(strategyParams),
    params: { ...strategyParams },
    corpora: items.map(i => ({ id: i.id, seed: deriveSeed(i.id, strategyParams.root_seed) }))
  });

  const flowIds = items.map(i => i.id).concat(fixtures.map(f => f.replace(".html", "")));
  writeJson(join(runDir, "manifest.json"), {
    run_id: runId,
    host: "windev-01",
    playwright_version: "1.63.0",
    git: sha,
    flows: flowIds.map(id => {
      const p = join(runDir, "flows", `${id}.json`);
      return { id, path: join("flows", `${id}.json`), sha256: existsSync(p) ? sha256File(p) : null };
    })
  });

  writeJson(join(runDir, "summary.json"), summary);
  writeFileSync(join(runDir, "ledger.ndjson"), ledger.map(e => JSON.stringify(e)).join("\n") + "\n", "utf8");

  return { runId, runDir, summary, strategySha: strategyDigest(strategyParams) };
}
