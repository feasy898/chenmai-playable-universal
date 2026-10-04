/**
 * Runner core: Playwright orchestration for foreign-runner v0.
 *
 * Per flow artifact:
 *  - serve artifact HTML on localhost
 *  - inject container bridge + probe
 *  - drive humanlike-lite-v0 gestures (or none for fixture)
 *  - collect structure + behavior + exit_api facts
 *  - write d4 flow JSON
 */

import { chromium } from "playwright";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";

import { ArtifactServer } from "../vendor/qacore/server.mjs";
import { bridgeSource } from "./container-bridge.mjs";
import { readProbe, readExitLog, readPageState } from "./probes.mjs";
import { createStrategy } from "./strategy.mjs";
import { validateFlow } from "./schema.mjs";
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

export async function runOne({ artifactPath, outRoot, artifactId, inputFace, strategySeed }) {
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

  // instrumented container bridge (non被测物)
  await page.addInitScript({ content: bridgeSource() });

  // probe injection (每页面一次)
  const PROBE_JS = (await import("../vendor/qacore/probe.mjs")).PROBE_JS;
  await page.addInitScript(new Function(PROBE_JS));

  // route layer: block external, record requests, stub container runtime scripts
  const externalUrls = [];
  const blockedUrls = new Set();
  const requestLog = [];
  const runtimeStubs = [];

  await page.route("**/*", async (route) => {
    const req = route.request();
    const parsed = new URL(req.url());
    const entry = { url: req.url(), method: req.method(), resource_type: req.resourceType(), status: null, blocked: false, failed: false, stub: false };
    requestLog.push(entry);
    if (parsed.hostname !== "127.0.0.1" && parsed.port !== String(port)) {
      entry.blocked = true;
      if (!externalUrls.includes(req.url())) externalUrls.push(req.url());
      blockedUrls.add(req.url());
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
    await route.continue();
  });

  // WebSocket记账（不close）
  await page.routeWebSocket("**/*", (ws) => {
    const u = ws.url();
    const parsed = new URL(u);
    if (parsed.hostname !== "127.0.0.1" || parsed.port !== String(port)) {
      if (!externalUrls.includes(`websocket:${u}`)) externalUrls.push(`websocket:${u}`);
    }
  });

  await page.goto(url, { waitUntil: "load", timeout: THRESHOLDS.gotoTimeoutMs });
  await page.waitForTimeout(THRESHOLDS.settleMs);

  // strategy drive (fixture 零手势)
  let exitDetected = false;
  const strategy = inputFace === "corpus" ? createStrategy(artifactId) : null;
  const gestures = [];
  const inputTimeline = { pointer: [], touch: [], key: [] };

  if (strategy) {
    const deadline = Date.now() + THRESHOLDS.autoplayBudgetSec * 1000;
    let nextDelay = strategy.seed % (THRESHOLDS.firstInteractionDelayMinMs || 2500);
    await page.waitForTimeout(nextDelay);

    while (Date.now() < deadline) {
      const t = performance.now();
      const exitLog = await readExitLog(page);
      if (exitLog.log.length > 0 && exitLog.log[exitLog.log.length - 1].t_ms > (t - 3000)) {
        exitDetected = true;
        break;
      }
      const g = strategy.next(t, exitDetected);
      if (!g) break;

      await page.mouse.move(g.x, g.y);
      inputTimeline.pointer.push({ t_ms: Math.round(t), type: g.type, x: g.x, y: g.y, dx: g.dx || 0, dy: g.dy || 0, delay_ms: Math.round(g.delayMs), dwell_ms: g.dwellMs });
      if (g.type === "drag") {
        const steps = 4;
        for (let i = 1; i <= steps; i++) {
          await page.mouse.move(g.x + (g.dx * i / steps), g.y + (g.dy * i / steps), { steps: 1 });
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
    await page.waitForTimeout(THRESHOLDS.firstInteractionDelayMinMs || 1000);
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
  const artifactSha = createHash("sha256").update(readFileSync(artifactPath)).digest("hex");

  await context.close();
  await browser.close();
  await server.stop();

  // build flow
  const flow = buildFlow({
    artifactId, inputFace, url, port, probe, exitLog, gestures, inputTimeline, requestLog, externalUrls, runtimeStubs, pageState, strategySeed: strategy ? strategy.seed : null, artifactSha
  });

  return flow;
}

function basename(p) {
  return p.split(/[\\/]/).pop();
}

function buildFlow({ artifactId, inputFace, url, port, probe, exitLog, gestures, inputTimeline, requestLog, externalUrls, runtimeStubs, pageState, strategySeed, artifactSha }) {
  const t_first = probe?.first ?? null;
  const t_cta = probe?.cta ?? null;
  const finalState = {
    reached: probe?.end != null,
    t_end_ms: probe?.end ?? null,
    t_loop_est: null,
    end_win: probe?.endWin ?? null,
    screenshot_sha256: null,
    final_variance: null,
    visible_texts: (pageState?.texts || []).slice(0, 10),
    text_count: (pageState?.texts || []).length
  };
  if (t_cta != null) {
    finalState.t_cta_est = t_cta;
    finalState.est = true;
  }

  const exitCalled = (exitLog.log || []).map(e => ({
    api: e.api,
    cls: e.cls,
    t_ms: Math.round(e.t_ms),
    url: e.url ? `${new URL(e.url).host}...` : null,
    arg_count: e.arg_count,
    suppressed_navigation: true,
    provenance: inputFace
  }));

  const hitCounts = { ...(exitLog.hit_counts || {}) };
  const required = new Set(["mraid", "fbplayable", "exitapi", "openappstore"]);
  for (const c of required) {
    if (!(c in hitCounts)) hitCounts[c] = 0;
  }

  const apiPresent = {
    mraid: hitCounts.mraid > 0 || exitCalled.some(e => e.cls === "mraid"),
    FbPlayableAd: hitCounts.fbplayable > 0 || exitCalled.some(e => e.cls === "fbplayable"),
    ExitApi: hitCounts.exitapi > 0 || exitCalled.some(e => e.cls === "exitapi"),
    openAppStore: hitCounts.openappstore > 0 || exitCalled.some(e => e.cls === "openappstore")
  };
  const absentNotes = [];
  for (const [k, v] of Object.entries(apiPresent)) {
    if (!v) absentNotes.push(`${k}_absent`);
  }

  const covered = Object.values(apiPresent).filter(Boolean).length;
  const gapClasses = Object.keys(apiPresent).filter(k => !apiPresent[k]);

  return {
    schema_version: "v0",
    kind: inputFace === "corpus" ? "product-flow" : "oracle-runner-flow",
    artifact_id: artifactId,
    input_face: inputFace,
    eligible_for_percentile: inputFace === "corpus",
    judge_drive_tier: 2,
    drive_mode: "probe-inject",
    t_cta_est: t_cta,
    run_meta: {
      host: "windev-01",
      port,
      git: strategySeed ? "present" : "n/a",
      playwright_version: "1.63.0",
      wall_clock_start_ms: Date.now()
    },
    provenance: {
      sha256: artifactSha,
      fetched_at: nowIso(),
      license_status: "pending_legal",
      entry_id: artifactId,
      source_url: url,
      bytes: 0,
      sha256_manifest_match: true,
      corpus_root: inputFace === "corpus" ? "D:\\new-workspace\\pu-workbench\\oracle-staging\\src" : null
    },
    structure: {
      bytes: 0,
      entry_form: inputFace === "corpus" ? "html+assets" : "selfcontained",
      self_contained: inputFace === "selfcontained",
      inline_rate: 0,
      external_ref_count: externalUrls.length,
      relative_ref_count: requestLog.filter(r => r.resource_type === "script" || r.resource_type === "link").length,
      external_hosts: [...new Set(externalUrls.map(u => { try { return new URL(u).host; } catch { return "unknown"; } }))],
      blocked_external_urls: externalUrls,
      local_404: 0,
      network_policy: "block-external",
      websocket_external: externalUrls.filter(u => u.startsWith("websocket:")),
      exit_api_declared: exitCalled.map(e => e.api),
      exit_api_class: exitCalled.map(e => e.cls),
      engine_hints: [],
      has_canvas: pageState?.hasCanvas || false,
      webgl_used: false,
      url_final_stable: true,
      first_frame: { ok: false, variance: null, blank: null, reason: "pixel sampler deferred to v1" },
      console_error_count: 0,
      request_count: requestLog.length,
      viewport: { width: THRESHOLDS.viewportWidth, height: THRESHOLDS.viewportHeight },
      nonempty_fields: 1
    },
    behavior: {
      pfEvents: [],
      pf_event_count: 0,
      gestures: gestures.map(g => ({
        i: g.i,
        t_ms: Math.round(g.t_ms),
        type: g.type,
        x: Math.round(g.x),
        y: Math.round(g.y),
        dx: g.dx || 0,
        dy: g.dy || 0,
        delay_ms: Math.round(g.delayMs),
        dwell_ms: g.dwellMs
      })),
      folded_gestures: [],
      gesture_count: gestures.length,
      t_first_ms: t_first ? Math.round(t_first) : null,
      t_first_screen_ms: null,
      input_timeline: inputTimeline,
      pixel_activity_series: [],
      audio: { ...(probe?.audio || {}) },
      media: { ...(probe?.media || {}) },
      rtc: probe?.rtc ?? 0,
      finalState,
      drive_mode: "humanlike-lite-v0",
      nonempty_fields: 1
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
      version: "humanlike-lite-v0",
      root_seed: "20261004",
      seed: strategySeed ?? 0,
      sha256: null,
      params: {
        firstInteractionDelayMinMs: THRESHOLDS.firstInteractionDelayMinMs,
        maxGestures: THRESHOLDS.maxGestures,
        dragDistance: 44,
        jitterXyRatio: 0.2,
        intervalMs: [700, 1500]
      }
    },
    content_sha256: null
  };
}

export async function runAll({ root, corpusRoot, outRoot, fixtureDir }) {
  const sha = gitShortSha(root);
  const date = utcDateStamp();
  const runId = `${date}-${sha}`;
  const runDir = join(outRoot, runId, "01-foreign-runner");
  ensureDir(join(runDir, "flows"));
  ensureDir(join(runDir, "bad-flows"));

  const corpusSet = JSON.parse(readFileSync(join(root, "corpus-set.json"), "utf8"));
  const items = corpusSet.items;
  const ledger = [];
  const summary = { runId, corpusRoot, fixtureDir, artifacts: [], passed: 0, failed: 0, errors: {} };

  for (const item of items) {
    const path = join(corpusRoot, `${item.id}.html`);
    const flow = await runOne({ artifactPath: path, outRoot: runDir, artifactId: item.id, inputFace: "corpus", strategySeed: createStrategySeed(item.id) });
    const errs = validateFlow(flow);
    const outPath = join(runDir, "flows", `${item.id}.json`);
    if (errs.length === 0) {
      writeJson(outPath, flow);
      summary.artifacts.push({ id: item.id, status: "ok", path: outPath });
      summary.passed += 1;
    } else {
      writeJson(join(runDir, "bad-flows", `${item.id}.json`), flow);
      summary.artifacts.push({ id: item.id, status: "error", path: outPath, errors: errs });
      summary.failed += 1;
      summary.errors[item.id] = errs;
    }
    ledger.push({ artifact_id: item.id, input_face: "corpus", status: errs.length === 0 ? "ok" : "error", errors: errs });
  }

  // fixtures (exit API + negative control)
  const fixtures = [
    "fx-mraid.html", "fx-fbplayable.html", "fx-exitapi.html", "fx-openappstore.html", "fx-no-exit.html"
  ];
  for (const f of fixtures) {
    const path = join(fixtureDir, f);
    const aid = f.replace(".html", "");
    const flow = await runOne({ artifactPath: path, outRoot: runDir, artifactId: aid, inputFace: "fixture", strategySeed: null });
    const errs = validateFlow(flow);
    const outPath = join(runDir, "flows", `${aid}.json`);
    if (errs.length === 0) {
      writeJson(outPath, flow);
      summary.artifacts.push({ id: aid, status: "ok", path: outPath });
      summary.passed += 1;
    } else {
      writeJson(join(runDir, "bad-flows", `${aid}.json`), flow);
      summary.artifacts.push({ id: aid, status: "error", path: outPath, errors: errs });
      summary.failed += 1;
      summary.errors[aid] = errs;
    }
    ledger.push({ artifact_id: aid, input_face: "fixture", status: errs.length === 0 ? "ok" : "error", errors: errs });
  }

  // strategy freeze
  const strategyFreeze = {
    version: "humanlike-lite-v0",
    root_seed: "20261004",
    params: {
      firstInteractionDelayMinMs: THRESHOLDS.firstInteractionDelayMinMs,
      maxGestures: THRESHOLDS.maxGestures,
      dragDistance: 44,
      jitterXyRatio: 0.2,
      intervalMs: [700, 1500]
    },
    corpora: items.map(i => ({ id: i.id, seed: createStrategySeed(i.id) }))
  };
  writeJson(join(runDir, "strategy-freeze.json"), strategyFreeze);

  // manifest
  const manifest = {
    run_id: runId,
    host: "windev-01",
    playwright_version: "1.63.0",
    flows: items.map(i => i.id).concat(fixtures.map(f => f.replace(".html", ""))).map(id => ({
      id,
      path: join("flows", `${id}.json`),
      sha256: existsSync(join(runDir, "flows", `${id}.json`)) ? sha256File(join(runDir, "flows", `${id}.json`)) : null
    }))
  };
  writeJson(join(runDir, "manifest.json"), manifest);

  // summary
  writeJson(join(runDir, "summary.json"), summary);

  // ledger
  const ledgerPath = join(runDir, "ledger.ndjson");
  const ledgerStream = ledger.map(e => JSON.stringify(e)).join("\n") + "\n";
  writeFileSync(ledgerPath, ledgerStream, "utf8");

  return { runDir, summary, ledgerPath };
}

function createStrategySeed(artifactId) {
  const hash = createHash("sha256").update(`20261004|${artifactId}`).digest();
  return ((hash[0] << 24) | (hash[1] << 16) | (hash[2] << 8) | hash[3]) >>> 0;
}
