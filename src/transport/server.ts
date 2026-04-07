import http from "http";
import { Runtime } from "../core/runtime";
import { MailmanPacket } from "../packet/types";

// ─────────────────────────────────────────────
//  Auth config
// ─────────────────────────────────────────────

export interface AuthConfig {
  /** Required API key value. */
  apiKey: string;
  /**
   * Header name to read the key from.
   * Default: "x-api-key"
   * Also accepts "Authorization: Bearer <key>".
   */
  header?: string;
}

// ─────────────────────────────────────────────
//  MailmanServer config
// ─────────────────────────────────────────────

export interface MailmanServerConfig {
  /** Port to listen on. Default: 7337 */
  port?: number;
  /** Host/IP to bind. Default: '127.0.0.1' */
  host?: string;
  /**
   * When set, every request must supply the correct API key.
   * Unauthenticated requests receive HTTP 401.
   */
  auth?: AuthConfig;
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
//    GET  /metrics  — Prometheus-format counters
// ─────────────────────────────────────────────

export class MailmanServer {
  private readonly server: http.Server;
  private readonly port: number;
  private readonly host: string;
  private readonly authConfig?: AuthConfig;

  constructor(
    private readonly runtime: Runtime,
    config: MailmanServerConfig = {}
  ) {
    this.port       = config.port ?? 7337;
    this.host       = config.host ?? "127.0.0.1";
    this.authConfig = config.auth;
    this.server     = http.createServer(this.handleRequest.bind(this));
  }

  // ── Lifecycle ─────────────────────────────

  listen(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.port, this.host, () => resolve());
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

  /** Expose the underlying http.Server (e.g. for WebSocket upgrade sharing). */
  get httpServer(): http.Server {
    return this.server;
  }

  // ── Request handler ───────────────────────

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const url    = req.url ?? "/";
    const method = req.method ?? "GET";

    // Auth check (skip for /health so monitors don't need keys)
    if (url !== "/health" && !this.isAuthorized(req)) {
      return sendJson(res, 401, { error: "Unauthorized — supply a valid API key" });
    }

    try {
      // POST /packets
      if (method === "POST" && url === "/packets") {
        const body   = await readBody(req);
        const packet = JSON.parse(body) as MailmanPacket;
        const reply  = await this.runtime.send(packet);
        return sendJson(res, 200, reply);
      }

      // POST /dispatch — fire-and-forget
      if (method === "POST" && url === "/dispatch") {
        const body   = await readBody(req);
        const packet = JSON.parse(body) as MailmanPacket;
        this.runtime.dispatch(packet);
        return sendJson(res, 202, { accepted: true });
      }

      // GET /roles
      if (method === "GET" && url === "/roles") {
        return sendJson(res, 200, this.runtime.listRoles());
      }

      // GET /health
      if (method === "GET" && url === "/health") {
        return sendJson(res, 200, {
          running: this.runtime.isRunning(),
          stats:   this.runtime.getStats(),
          roles:   this.runtime.listRoles().map((r) => r.name),
        });
      }

      // GET /metrics — Prometheus text format
      if (method === "GET" && url === "/metrics") {
        const stats = this.runtime.getStats();
        const lines = [
          "# HELP mailman_packets_processed_total Total packets successfully processed",
          "# TYPE mailman_packets_processed_total counter",
          `mailman_packets_processed_total ${stats.packetsProcessed}`,
          "# HELP mailman_packets_failed_total Total packets that failed (including dead-lettered)",
          "# TYPE mailman_packets_failed_total counter",
          `mailman_packets_failed_total ${stats.packetsFailed}`,
          "# HELP mailman_packets_retried_total Total retry attempts across all packets",
          "# TYPE mailman_packets_retried_total counter",
          `mailman_packets_retried_total ${stats.packetsRetried}`,
          "# HELP mailman_packets_dead_lettered_total Total packets sent to the dead-letter queue",
          "# TYPE mailman_packets_dead_lettered_total counter",
          `mailman_packets_dead_lettered_total ${stats.packetsDeadLettered}`,
          "# HELP mailman_packets_dispatched_total Total fire-and-forget dispatches",
          "# TYPE mailman_packets_dispatched_total counter",
          `mailman_packets_dispatched_total ${stats.packetsDispatched}`,
          "# HELP mailman_packets_published_total Total pub/sub publishes",
          "# TYPE mailman_packets_published_total counter",
          `mailman_packets_published_total ${stats.packetsPublished}`,
          "# HELP mailman_roles_registered Current number of registered roles",
          "# TYPE mailman_roles_registered gauge",
          `mailman_roles_registered ${this.runtime.listRoles().length}`,
          "# HELP mailman_dlq_size Current dead-letter queue depth",
          "# TYPE mailman_dlq_size gauge",
          `mailman_dlq_size ${this.runtime.getDLQ().count()}`,
          "",
        ];
        res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4" });
        res.end(lines.join("\n"));
        return;
      }

      // 404
      sendJson(res, 404, { error: `Unknown route: ${method} ${url}` });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal server error";
      sendJson(res, 500, { error: message });
    }
  }

  // ── Auth ──────────────────────────────────

  private isAuthorized(req: http.IncomingMessage): boolean {
    if (!this.authConfig) return true;

    const headerName = (this.authConfig.header ?? "x-api-key").toLowerCase();
    const raw = req.headers[headerName];
    const provided = Array.isArray(raw) ? raw[0] : raw;

    if (provided === this.authConfig.apiKey) return true;

    // Also accept "Authorization: Bearer <key>"
    const authHeader = req.headers["authorization"];
    if (authHeader?.startsWith("Bearer ")) {
      return authHeader.slice(7) === this.authConfig.apiKey;
    }

    return false;
  }
}

// ─────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end",  () => resolve(Buffer.concat(chunks).toString("utf8")));
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
    "Content-Type":   "application/json",
    "Content-Length": Buffer.byteLength(json),
  });
  res.end(json);
}
