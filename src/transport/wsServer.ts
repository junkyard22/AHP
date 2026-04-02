import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { Runtime } from "../core/runtime";
import { MailmanPacket } from "../packet/types";

// ─────────────────────────────────────────────
//  Wire protocol (JSON messages over WebSocket)
//
//  Client → Server:
//    { op: "send",        requestId: string, packet: MailmanPacket }
//    { op: "dispatch",    requestId: string, packet: MailmanPacket }
//    { op: "subscribe",   requestId: string, topic: string }
//    { op: "unsubscribe", requestId: string, topic: string }
//
//  Server → Client:
//    { op: "reply",  requestId: string, packet: MailmanPacket }
//    { op: "event",  packet: MailmanPacket }
//    { op: "ack",    requestId: string }
//    { op: "error",  requestId?: string, code: string, message: string }
// ─────────────────────────────────────────────

type ClientMessage =
  | { op: "send";        requestId: string; packet: MailmanPacket }
  | { op: "dispatch";    requestId: string; packet: MailmanPacket }
  | { op: "subscribe";   requestId: string; topic: string }
  | { op: "unsubscribe"; requestId: string; topic: string };

// ─────────────────────────────────────────────
//  Config
// ─────────────────────────────────────────────

export interface WsServerConfig {
  /** Port to listen on. Default: 7338 */
  port?: number;
  /** Host/IP to bind. Default: '127.0.0.1' */
  host?: string;
  /**
   * Required API key for all connections.
   * Clients must pass it as the "x-api-key" header (or query param ?apiKey=).
   */
  apiKey?: string;
  /**
   * Attach to an existing http.Server instead of creating a new one.
   * Useful when sharing a port with MailmanServer.
   */
  server?: http.Server;
}

// ─────────────────────────────────────────────
//  MailmanWsServer
// ─────────────────────────────────────────────

export class MailmanWsServer {
  private readonly wss: WebSocketServer;
  private readonly port: number;
  private readonly host: string;
  private readonly apiKey?: string;

  /** subscriptionId → unsub function (per-connection) */
  private readonly connSubs = new WeakMap<WebSocket, Map<string, () => void>>();

  constructor(
    private readonly runtime: Runtime,
    config: WsServerConfig = {}
  ) {
    this.port   = config.port   ?? 7338;
    this.host   = config.host   ?? "127.0.0.1";
    this.apiKey = config.apiKey;

    if (config.server) {
      this.wss = new WebSocketServer({ server: config.server });
    } else {
      this.wss = new WebSocketServer({ port: this.port, host: this.host });
    }

    this.wss.on("connection", this.onConnection.bind(this));
  }

  // ── Lifecycle ─────────────────────────────

  /** Only needed when not attached to an existing http.Server. */
  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.wss.close((err) => (err ? reject(err) : resolve()));
    });
  }

  get clientCount(): number {
    return this.wss.clients.size;
  }

  // ── Connection handler ────────────────────

  private onConnection(ws: WebSocket, req: http.IncomingMessage): void {
    // Auth check
    if (this.apiKey && !this.checkAuth(req)) {
      ws.close(4001, "Unauthorized");
      return;
    }

    this.connSubs.set(ws, new Map());

    ws.on("message", (raw: Buffer | string) => {
      this.handleMessage(ws, raw.toString()).catch((err: unknown) => {
        this.sendError(ws, undefined, "INTERNAL", err instanceof Error ? err.message : String(err));
      });
    });

    ws.on("close", () => {
      // Clean up all subscriptions for this connection
      const subs = this.connSubs.get(ws);
      if (subs) {
        for (const unsub of subs.values()) unsub();
        this.connSubs.delete(ws);
      }
    });
  }

  private async handleMessage(ws: WebSocket, raw: string): Promise<void> {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      this.sendError(ws, undefined, "PARSE_ERROR", "Invalid JSON");
      return;
    }

    const { op, requestId } = msg;

    switch (op) {
      case "send": {
        try {
          const reply = await this.runtime.send(msg.packet);
          this.send(ws, { op: "reply", requestId, packet: reply });
        } catch (err) {
          this.sendError(ws, requestId, "SEND_FAILED", err instanceof Error ? err.message : String(err));
        }
        break;
      }

      case "dispatch": {
        this.runtime.dispatch(msg.packet);
        this.send(ws, { op: "ack", requestId });
        break;
      }

      case "subscribe": {
        const subs = this.connSubs.get(ws)!;
        if (subs.has(msg.topic)) {
          // Already subscribed — no-op
          this.send(ws, { op: "ack", requestId });
          break;
        }
        const unsub = this.runtime.subscribe(msg.topic, (packet) => {
          if (ws.readyState === WebSocket.OPEN) {
            this.send(ws, { op: "event", packet });
          }
        });
        subs.set(msg.topic, unsub);
        this.send(ws, { op: "ack", requestId });
        break;
      }

      case "unsubscribe": {
        const subs = this.connSubs.get(ws)!;
        const unsub = subs.get(msg.topic);
        if (unsub) {
          unsub();
          subs.delete(msg.topic);
        }
        this.send(ws, { op: "ack", requestId });
        break;
      }

      default: {
        this.sendError(ws, (msg as { requestId?: string }).requestId, "UNKNOWN_OP", `Unknown op: ${op}`);
      }
    }
  }

  // ── Helpers ───────────────────────────────

  private send(ws: WebSocket, payload: unknown): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }

  private sendError(
    ws: WebSocket,
    requestId: string | undefined,
    code: string,
    message: string
  ): void {
    this.send(ws, { op: "error", requestId, code, message });
  }

  private checkAuth(req: http.IncomingMessage): boolean {
    if (!this.apiKey) return true;

    // Header: x-api-key
    const header = req.headers["x-api-key"];
    if (header === this.apiKey) return true;

    // Bearer token
    const auth = req.headers["authorization"];
    if (auth?.startsWith("Bearer ") && auth.slice(7) === this.apiKey) return true;

    // Query param: ?apiKey=...
    const url  = new URL(req.url ?? "/", "http://localhost");
    if (url.searchParams.get("apiKey") === this.apiKey) return true;

    return false;
  }
}
