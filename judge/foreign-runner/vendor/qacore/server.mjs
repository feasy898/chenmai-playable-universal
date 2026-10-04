/**
 * vendor-copy from D:\new-workspace\pu-workbench\qacore\src\server.ts (whole file)
 * source sha256: ed22405fbbd057e0b74c31a41468f6bef54a7986e33f491fa728e4d1fc991307
 * 本地静态伺服器（M8）：把产物所在目录挂到 127.0.0.1 的临时端口上。
 */
import { createServer } from "node:http";
import { stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const MIME_BY_EXT = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

function urlPath(raw) {
  const noQuery = raw.split("?", 1)[0].split("#", 1)[0];
  let decoded = noQuery;
  try { decoded = decodeURIComponent(noQuery); } catch {}
  const posix = decoded.replace(/\\/g, "/");
  return posix.startsWith("/") ? posix : `/${posix}`;
}

export class ArtifactServer {
  constructor(docroot, port = 0) {
    this.docroot = resolve(docroot);
    this.server = createServer((req, res) => this.serve(req, res));
    this.requestedPort = port;
    this.boundPort = 0;
  }

  async start() {
    await new Promise((ok, bad) => {
      this.server.once("error", bad);
      this.server.listen(this.requestedPort, "127.0.0.1", () => ok());
    });
    const addr = this.server.address();
    if (addr && typeof addr === "object") this.boundPort = addr.port;
    else this.boundPort = this.requestedPort;
    return this.boundPort;
  }

  get port() { return this.boundPort; }
  get base_url() { return `http://127.0.0.1:${this.boundPort}`; }

  url_for(filename) {
    return `${this.base_url}/${filename.replace(/\\/g, "/")}`;
  }

  async stop() {
    await new Promise((ok) => this.server.close(() => ok()));
  }

  async serve(req, res) {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.statusCode = 405;
        res.end();
        return;
      }
      const rel = normalize(urlPath(req.url || "/")).replace(/^(\.\.[/\\])+/, "");
      const abs = resolve(join(this.docroot, rel));
      if (abs !== this.docroot && !abs.startsWith(this.docroot + sep)) {
        res.statusCode = 403;
        res.end();
        return;
      }
      let target = abs;
      let st = await stat(target).catch(() => null);
      if (st && st.isDirectory()) {
        target = join(target, "index.html");
        st = await stat(target).catch(() => null);
      }
      if (!st || !st.isFile()) {
        res.statusCode = 404;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("404 not found");
        return;
      }
      const ext = extname(target).toLowerCase();
      res.statusCode = 200;
      res.setHeader("Content-Type", MIME_BY_EXT[ext] || "application/octet-stream");
      res.setHeader("Content-Length", String(st.size));
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      const { createReadStream } = await import("node:fs");
      const stream = createReadStream(target);
      stream.on("error", () => res.destroy());
      stream.pipe(res);
      await new Promise((ok) => stream.on("close", () => ok()));
    } catch {
      try { res.statusCode = 500; res.end(); } catch {}
    }
  }
}

export function repoRoot() {
  return resolve(fileURLToPath(new URL("../..", import.meta.url)));
}
