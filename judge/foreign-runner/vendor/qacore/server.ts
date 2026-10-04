/**
 * vendor-copy from D:\new-workspace\pu-workbench\qacore\src\server.ts (whole file)
 * source sha256: ed22405fbbd057e0b74c31a41468f6bef54a7986e33f491fa728e4d1fc991307
 * 本地静态伺服器（M8）：把产物所在目录挂到 127.0.0.1 的临时端口上。
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const MIME_BY_EXT: Record<string, string> = {
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

/** 解析请求 URL 里的路径部分（去 query/hash、做百分号解码）。 */
function urlPath(raw: string): string {
  const noQuery = raw.split("?", 1)[0]!.split("#", 1)[0]!;
  let decoded = noQuery;
  try {
    decoded = decodeURIComponent(noQuery);
  } catch {
    // 非法百分号序列：按原样处理（等价于 Python 不解码直接回 404）。
  }
  const posix = decoded.replace(/\\/g, "/");
  return posix.startsWith("/") ? posix : `/${posix}`;
}

export class ArtifactServer {
  private docroot: string;
  private server: Server;
  private boundPort = 0;
  private requestedPort: number;

  constructor(docroot: string, port = 0) {
    this.docroot = resolve(docroot);
    const self = this;
    this.server = createServer(function (req: IncomingMessage, res: ServerResponse): void {
      self.serve(req, res);
    });
    // 显式保留 port 参数语义：listen 时使用（0 = 系统分配）。
    this.requestedPort = port;
  }

  /** 启动监听；返回实际端口（--port 0 时为系统分配的临时端口）。 */
  async start(): Promise<number> {
    await new Promise<void>((ok, bad) => {
      this.server.once("error", bad);
      this.server.listen(this.requestedPort, "127.0.0.1", () => ok());
    });
    const addr = this.server.address();
    if (addr && typeof addr === "object") this.boundPort = addr.port;
    else this.boundPort = this.requestedPort;
    return this.boundPort;
  }

  get port(): number {
    return this.boundPort;
  }

  get base_url(): string {
    return `http://127.0.0.1:${this.boundPort}`;
  }

  url_for(filename: string): string {
    return `${this.base_url}/${filename.replace(/\\/g, "/")}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((ok) => this.server.close(() => ok()));
  }

  private async serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.statusCode = 405;
        res.end();
        return;
      }
      const rel = normalize(urlPath(req.url ?? "/")).replace(/^(\.\.[/\\])+/, "");
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
      res.setHeader("Content-Type", MIME_BY_EXT[ext] ?? "application/octet-stream");
      res.setHeader("Content-Length", String(st.size));
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      const { createReadStream } = await import("node:fs");
      const stream = createReadStream(target);
      stream.on("error", () => res.destroy());
      stream.pipe(res);
      await new Promise<void>((ok) => stream.on("close", () => ok()));
    } catch {
      try {
        res.statusCode = 500;
        res.end();
      } catch {
        // 连接已断：伺服器不陪葬。
      }
    }
  }
}

/** qacore 源码树内定位仓库根（channel-rules 等数据资产都相对仓库根）。 */
export function repoRoot(): string {
  return resolve(fileURLToPath(new URL("../..", import.meta.url)));
}
