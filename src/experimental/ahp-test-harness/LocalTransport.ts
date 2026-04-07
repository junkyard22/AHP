import http from "http";
import { WebSocket, WebSocketServer } from "ws";
import { AHPTestAgentHost } from "./AHPTestAgentHost";
import { FaultInjectionConfig, DeterministicFaultInjector } from "./faultInjection";
import { AHPTestTraceStore } from "./logging";
import { AHPTestTransport, TransportEnvelopeReceiver } from "./transport";
import { AHPEnvelope, AHPTestAgentDescriptor } from "./types";

interface LocalTransportOptions {
  faultInjection?: FaultInjectionConfig;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class LocalTransport implements AHPTestTransport {
  readonly kind = "local" as const;

  private readonly host = new AHPTestAgentHost();
  private readonly injector: DeterministicFaultInjector;
  private receiver?: TransportEnvelopeReceiver;

  private server?: http.Server;
  private wss?: WebSocketServer;
  private port?: number;
  private serverSocket?: WebSocket;
  private clientSocket?: WebSocket;
  private startPromise?: Promise<void>;
  private clientConnectPromise?: Promise<void>;

  constructor(options: LocalTransportOptions = {}, traces?: AHPTestTraceStore) {
    this.injector = new DeterministicFaultInjector(options.faultInjection, traces);

    this.host.attachEmitter((envelope) => {
      void this.sendToClient(envelope);
    });
  }

  attachReceiver(handler: TransportEnvelopeReceiver): void {
    this.receiver = handler;
  }

  async registerAgent(agentDescriptor: AHPTestAgentDescriptor, sessionId: string): Promise<void> {
    await this.ensureStarted();
    this.host.registerAgent(agentDescriptor, sessionId);
  }

  async sendEnvelope(envelope: AHPEnvelope): Promise<void> {
    await this.ensureClientConnected();
    await this.injector.transmit(
      { direction: "workbench->ahp", envelope },
      async () => this.actualSendToServer(envelope),
      {
        disconnect: async () => this.closeClientSocket(),
        reconnect: async () => this.ensureClientConnected(),
      }
    );
  }

  async disconnect(sessionId: string, agentIds: string[]): Promise<void> {
    await this.ensureStarted();
    this.host.emitAgentOfflineBatch(agentIds, sessionId);
    await sleep(10);
    await this.closeClientSocket();
  }

  async injectEnvelope(envelope: AHPEnvelope): Promise<void> {
    await this.ensureStarted();
    this.host.injectEnvelope(envelope);
  }

  async close(): Promise<void> {
    await this.closeClientSocket();

    if (this.wss) {
      await new Promise<void>((resolve, reject) => {
        this.wss?.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
      this.wss = undefined;
    }

    if (this.server) {
      await new Promise<void>((resolve, reject) => {
        this.server?.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
      this.server = undefined;
    }

    this.serverSocket = undefined;
    this.port = undefined;
    this.startPromise = undefined;
    this.clientConnectPromise = undefined;
  }

  private async ensureStarted(): Promise<void> {
    if (!this.startPromise) {
      this.startPromise = new Promise((resolve, reject) => {
        this.server = http.createServer();
        this.wss = new WebSocketServer({ server: this.server });

        this.wss.on("connection", (socket) => {
          this.serverSocket = socket;
          socket.on("message", (raw) => {
            this.handleServerMessage(raw.toString()).catch(reject);
          });
          socket.on("close", () => {
            if (this.serverSocket === socket) {
              this.serverSocket = undefined;
            }
          });
        });

        this.server.listen(0, "127.0.0.1", () => {
          const address = this.server?.address();
          if (!address || typeof address === "string") {
            reject(new Error("Local transport failed to bind a TCP port"));
            return;
          }

          this.port = address.port;
          resolve();
        });

        this.server.on("error", reject);
      });
    }

    await this.startPromise;
  }

  private async ensureClientConnected(): Promise<void> {
    await this.ensureStarted();

    if (this.clientSocket?.readyState === WebSocket.OPEN) {
      return;
    }

    if (!this.clientConnectPromise) {
      this.clientConnectPromise = (async () => {
        await this.closeClientSocket();

        await new Promise<void>((resolve, reject) => {
          this.clientSocket = new WebSocket(`ws://127.0.0.1:${this.port}`);

          this.clientSocket.on("open", () => resolve());
          this.clientSocket.on("message", (raw) => {
            this.handleClientMessage(raw.toString());
          });
          this.clientSocket.on("error", reject);
          this.clientSocket.on("close", () => {
            if (this.clientSocket?.readyState === WebSocket.CLOSED) {
              this.clientSocket = undefined;
            }
          });
        });

        await this.waitForServerSocket();
      })();
    }

    try {
      await this.clientConnectPromise;
    } finally {
      this.clientConnectPromise = undefined;
    }
  }

  private async waitForServerSocket(timeoutMs = 200): Promise<void> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (this.serverSocket?.readyState === WebSocket.OPEN) {
        return;
      }
      await sleep(5);
    }

    throw new Error("Local transport server socket did not become ready");
  }

  private async handleServerMessage(raw: string): Promise<void> {
    const envelope = JSON.parse(raw) as AHPEnvelope;
    await this.host.handleEnvelope(envelope);
  }

  private handleClientMessage(raw: string): void {
    const envelope = JSON.parse(raw) as AHPEnvelope;
    this.receiver?.(envelope);
  }

  private async actualSendToServer(envelope: AHPEnvelope): Promise<void> {
    await this.ensureClientConnected();
    this.clientSocket?.send(JSON.stringify(envelope));
  }

  private async sendToClient(envelope: AHPEnvelope): Promise<void> {
    await this.injector.transmit(
      { direction: "ahp->workbench", envelope },
      async () => this.actualSendToClient(envelope),
      {
        disconnect: async () => this.closeClientSocket(),
        reconnect: async () => this.ensureClientConnected(),
      }
    );
  }

  private async actualSendToClient(envelope: AHPEnvelope): Promise<void> {
    await this.ensureClientConnected();
    await this.waitForServerSocket();
    this.serverSocket?.send(JSON.stringify(envelope));
  }

  private async closeClientSocket(): Promise<void> {
    if (!this.clientSocket) {
      return;
    }

    const socket = this.clientSocket;
    await new Promise<void>((resolve) => {
      if (socket.readyState === WebSocket.CLOSED) {
        resolve();
        return;
      }

      socket.once("close", () => resolve());
      socket.close();
    });

    this.clientSocket = undefined;
  }
}
