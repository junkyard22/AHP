import http from "http";
import { Runtime } from "../core/runtime";
import { MailmanPacket } from "../packet/types";

// ─────────────────────────────────────────────
//  MailmanServer config
// ─────────────────────────────────────────────

export interface MailmanServerConfig {
  /** Port to listen on. Default: 7337 */
  port?: number;
  /** Host/IP to bind. Default: '127.0.0.1' */
  host?: string;
}

// ─────────────────────────────────────────────
//  MailmanServer
//
//  Wraps an existing Runtime and exposes it over
//  HTTP so remote agents can send packets to it.
//
//  Endpoints:
//    POST /packets  — send a packet, get a reply
//    GET  /roles    — list registered roles
//    GET  /health   — runtime status + stats
// ─────────────────────────────────────────────

export class MailmanServer {
  private readonly server: http.Server;
  private readonly port: number;
  private readonly host: string;

  constructor(
    private readonly runtime: Runtime,
    config: MailmanServerConfig = {}
  ) {
    this.port = config.port ?? 7337;
    this.host = config.host ?? "127.0.0.1";
    this.server = http.createServer(this.handleRequest.bind(this));
  }

  // ── Lifecycle ─────────────────────────────

  listen(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.port, this.host, () => {
        resolve();
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  get address(): string {
    return `http://${this.host}:${this.port}`;
  }

  // ── Request handler ───────────────────────

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const url = req.url ?? "/";
    const method = req.method ?? "GET";

    try {
      // POST /packets
      if (method === "POST" && url === "/packets") {
        const body = await readBody(req);
        const packet = JSON.parse(body) as MailmanPacket;
        const reply = await this.runtime.send(packet);
        return sendJson(res, 200, reply);
      }

      // GET /roles
      if (method === "GET" && url === "/roles") {
        return sendJson(res, 200, this.runtime.listRoles());
      }

      // GET /health
      if (method === "GET" && url === "/health") {
        return sendJson(res, 200, {
          running: this.runtime.isRunning(),
          stats: this.runtime.getStats(),
          roles: this.runtime.listRoles().map((r) => r.name),
        });
      }

      // 404
      sendJson(res, 404, { error: `Unknown route: ${method} ${url}` });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Internal server error";
      sendJson(res, 500, { error: message });
    }
  }
}

// ─────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown
): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(json),
  });
  res.end(json);
}
