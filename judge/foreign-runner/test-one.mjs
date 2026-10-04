import { createHash } from "node:crypto";
import { runOne } from "./lib/runner.mjs";

const seed = createHash("sha256").update("20261004|zp_drawIt_scratch_adwords_cn").digest();
const flow = await runOne({
  artifactPath: "D:/new-workspace/pu-workbench/oracle-staging/src/zp_drawIt_scratch_adwords_cn.html",
  outRoot: "D:/new-workspace/chenmai-playable-universal/runs",
  artifactId: "zp_drawIt_scratch_adwords_cn",
  inputFace: "corpus",
  strategySeed: ((seed[0] << 24) | (seed[1] << 16) | (seed[2] << 8) | seed[3]) >>> 0
});

console.log("artifact_id:", flow.artifact_id);
console.log("gestures:", flow.behavior.gesture_count);
console.log("exit_called:", flow.exit_api_called.length);
console.log("schema_version:", flow.schema_version);
console.log("url_final_stable:", flow.structure.url_final_stable);
console.log("drive_mode:", flow.behavior.drive_mode);
