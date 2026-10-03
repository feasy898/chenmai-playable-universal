#!/usr/bin/env node
// ============================================================================
// 只追加探针（U-06 断言项：写盘只追加、同门禁重跑落新目录、旧目录永不覆盖）
// 用法：node tools/probe-append-only.mjs [gate名]   （默认 gate=repo-init）
// 行为（测试文档 §六）：
//   1. 目标槽 = runs/<YYYY-MM-DD>-<commit短哈希>/；已存在则依次找 <slot>-02、-03…（永不复用旧目录）
//   2. 先清后跑：删除本趟目标 report 路径后再写，写完断言存在且非空（幽灵文件事故防护）
//   3. 产物：NN-<gate>/report.json（内容域零时间戳）+ manifest.json（侧车含时间/机器/git/jobs）
//      + ledger.ndjson（机生台账，每轮一条，report.json 的 sha256 取行尾归一化后重算）
// 退出码：0 成功；1 自验失败（槽冲突/产物缺失/旧目录被改动的断言失败）
// ============================================================================
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, rmSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUNS = join(ROOT, 'runs');
const gate = process.argv[2] || 'repo-init';
const jobs = 2; // 测试文档 §四：jobs 固定 2，不自适应

const sh = (cmd) => execSync(cmd, { cwd: ROOT, encoding: 'utf8' }).trim();
const shortHash = () => { try { return sh('git rev-parse --short HEAD'); } catch { return 'nocommit'; } };
const nowIso = () => new Date().toISOString();
const today = () => nowIso().slice(0, 10);

// sha256 前行尾归一化（autocrlf 下 checkout 改写会字节误报，mutation_test 体例）
const sha256Normalized = (buf) =>
  createHash('sha256').update(buf.toString('utf8').replace(/\r\n/g, '\n')).digest('hex');

// 1. 选槽：base 已存在则 -02、-03…（只追加：重跑落新目录）
const base = `${today()}-${shortHash()}`;
let slot = base;
for (let n = 2; existsSync(join(RUNS, slot)); n++) {
  if (n > 99) { console.error(`exit 1: runs/ 下 ${base}-NN 槽位耗尽`); process.exit(1); }
  slot = `${base}-${String(n).padStart(2, '0')}`;
}
const dir = join(RUNS, slot);
const reportPath = join(dir, `01-${gate}`, 'report.json');

// 2. 先清后跑：目标报告路径先删再写，写完断言存在且非空
mkdirSync(dirname(reportPath), { recursive: true });
rmSync(reportPath, { force: true });
const report = { gate, probe: 'append-only', commit: shortHash(), checks: { targetFresh: true } };
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
if (!existsSync(reportPath) || statSync(reportPath).size === 0) {
  console.error('exit 1: 先清后跑断言失败（report 缺失或为空）'); process.exit(1);
}

// 3. 侧车 manifest（封装域：时间/机器/git/jobs——时间只进侧车，不进内容域）
const manifest = {
  run: slot, gate, writtenAt: nowIso(), jobs,
  machine: { platform: process.platform, arch: process.arch, node: process.version, host: process.env.COMPUTERNAME || '' },
  git: { commit: shortHash(), dirty: sh('git status --porcelain').length > 0 },
};
writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

// 4. 机生台账：ledger.ndjson 追加一行（含 report 行尾归一化 sha256）
const digest = sha256Normalized(readFileSync(reportPath));
const line = JSON.stringify({ run: slot, gate, report_sha256: digest, jobs }) + '\n';
writeFileSync(join(dir, 'ledger.ndjson'), line, { flag: 'a' });

// 5. 自验：本趟之外的槽一律未被本进程改动（旧目录永不覆盖）
const slots = readdirSync(RUNS).filter((n) => n !== slot && statSync(join(RUNS, n)).isDirectory());
for (const s of slots) {
  const led = join(RUNS, s, 'ledger.ndjson');
  if (existsSync(led) && !readFileSync(led, 'utf8').includes(`"run":"${s}"`)) {
    console.error(`exit 1: 旧槽 ${s} 台账与其名不符（疑似被覆盖）`); process.exit(1);
  }
}
console.log(`OK slot=runs/${basename(slot)} report_sha256=${digest.slice(0, 16)} prior_slots_untouched=${slots.length}`);
