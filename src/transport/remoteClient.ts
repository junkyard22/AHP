import http from "http";
import https from "https";
import { MailmanPacket, MailmanRoleRegistration } from "../packet/types";

// ─────────────────────────────────────────────
//  RemoteMailmanClient config
// ─────────────────────────────────────────────

export interface RemoteClientConfig {
  /** Base URL of the MailmanServer. Example: 'http://localhost:7337' */
  url: string;
  /** Request timeout in ms. Default: 30000 */
  timeoutMs?: number;
}

// ─────────────────────────────────────────────
//  RemoteMailmanClient
//
//  Sends packets to a MailmanServer over HTTP.
//  Implements the same send/ping/listRoles API
//  as MailmanClient so they're interchangeable.
// ─────────────────────────────────────────────

export class RemoteMailmanClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: RemoteClientConfig) {
    this.baseUrl = config.url.replace(/\/$/, ""); // strip trailing slash
    this.timeoutMs = config.timeoutMs ?? 30_000;
  }

  // ── Messaging ─────────────────────────────

  async send(packet: MailmanPacket): Promise<MailmanPacket> {
    const reply = await this.post<MailmanPacket>("/packets", packet);
    return reply;
  }

  async ping(roleName: string): Promise<boolean> {
    try {
      const health = await this.get<{ roles: string[] }>("/health");
      return health.roles.includes(roleName);
    } catch {
      return false;
    }
  }

  // ── Role info ─────────────────────────────

  async listRoles(): Promise<MailmanRoleRegistration[]> {
    return this.get<MailmanRoleRegistration[]>("/roles");
  }

  async health(): Promise<{
    running: boolean;
    stats: Record<string, unknown>;
    roles: string[];
  }> {
    return this.get("/health");
  }

  // ── Internal HTTP helpers ─────────────────

  private post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, JSON.stringify(body));
  }

  private get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  private request<T>(method: string, path: string, body?: string): Promise<T> {
    const url = new URL(this.baseUrl + path);
    const lib = url.protocol === "https:" ? https : http;

    return new Promise((resolve, reject) => {
      const options: http.RequestOptions = {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(body
            ? { "Content-Length": Buffer.byteLength(body) }
            : {}),
        },
      };

      const req = lib.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          try {
            const text = Buffer.concat(chunks).toString("utf8");
            const parsed = JSON.parse(text) as T;
            const status = res.statusCode ?? 200;
            if (status >= 400) {
              reject(
                new Error(
                  `MailmanServer returned ${status}: ${JSON.stringify(parsed)}`
                )
              );
            } else {
              resolve(parsed);
            }
          } catch (err) {
            reject(err);
          }
        });
        res.on("error", reject);
      });

      req.on("error", reject);

      // Timeout
      req.setTimeout(this.timeoutMs, () => {
        req.destroy(
          new Error(
            `RemoteMailmanClient: request timed out after ${this.timeoutMs}ms`
          )
        );
      });

      if (body) req.write(body);
      req.end();
    });
  }
}
