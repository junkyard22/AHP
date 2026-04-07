import { AHPTestAgentHost } from "./AHPTestAgentHost";
import { AHPTestTransport, TransportEnvelopeReceiver } from "./transport";
import { AHPEnvelope, AHPTestAgentDescriptor } from "./types";

export class InMemoryTransport implements AHPTestTransport {
  readonly kind = "in-memory" as const;

  private readonly host = new AHPTestAgentHost();
  private receiver?: TransportEnvelopeReceiver;

  constructor() {
    this.host.attachEmitter((envelope) => {
      queueMicrotask(() => {
        this.receiver?.(envelope);
      });
    });
  }

  attachReceiver(handler: TransportEnvelopeReceiver): void {
    this.receiver = handler;
  }

  async registerAgent(agentDescriptor: AHPTestAgentDescriptor, sessionId: string): Promise<void> {
    this.host.registerAgent(agentDescriptor, sessionId);
  }

  async sendEnvelope(envelope: AHPEnvelope): Promise<void> {
    await this.host.handleEnvelope(envelope);
  }

  async disconnect(sessionId: string, agentIds: string[]): Promise<void> {
    this.host.emitAgentOfflineBatch(agentIds, sessionId);
  }

  async injectEnvelope(envelope: AHPEnvelope): Promise<void> {
    this.host.injectEnvelope(envelope);
  }

  async close(): Promise<void> {
    return;
  }
}
