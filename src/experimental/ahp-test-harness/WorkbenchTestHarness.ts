import { AHPTestBus } from "./AHPTestBus";
import { FaultInjectionConfig } from "./faultInjection";
import { isAHPTestModeEnabled } from "./config";
import { InMemoryTransport } from "./InMemoryTransport";
import { LocalTransport } from "./LocalTransport";
import { AHPTestTraceStore } from "./logging";
import { MaestroTestAdapter } from "./MaestroTestAdapter";
import { AHPTestTransport } from "./transport";
import { AHPEnvelope, AHPTestLogEntry, AHPTestTimeouts, AHPTestTransportKind } from "./types";

export interface AHPTestHarnessOptions {
  enabled?: boolean;
  env?: NodeJS.ProcessEnv;
  timeouts?: Partial<AHPTestTimeouts>;
  transport?: AHPTestTransportKind;
  faultInjection?: FaultInjectionConfig;
}

function createTransport(
  kind: AHPTestTransportKind,
  traces: AHPTestTraceStore,
  options: AHPTestHarnessOptions
): AHPTestTransport {
  return kind === "local"
    ? new LocalTransport({ faultInjection: options.faultInjection }, traces)
    : new InMemoryTransport();
}

export class WorkbenchTestHarness {
  readonly traces: AHPTestTraceStore;
  readonly bus: AHPTestBus;
  readonly maestro: MaestroTestAdapter;
  readonly transport: AHPTestTransport;
  readonly transportKind: AHPTestTransportKind;

  constructor(options: Omit<AHPTestHarnessOptions, "env" | "enabled"> = {}) {
    this.transportKind = options.transport ?? "in-memory";
    this.traces = new AHPTestTraceStore();
    this.transport = createTransport(this.transportKind, this.traces, options);
    this.bus = new AHPTestBus(this.transport, this.traces, options.timeouts);
    this.maestro = new MaestroTestAdapter(this.bus);
  }

  traceTask(taskId: string): AHPTestLogEntry[] {
    return this.traces.byTaskId(taskId);
  }

  allTraces(): AHPTestLogEntry[] {
    return this.traces.all();
  }

  async injectEnvelope(envelope: AHPEnvelope): Promise<void> {
    await this.bus.injectEnvelope(envelope);
  }

  async restart(): Promise<void> {
    await this.bus.restart();
  }

  async close(): Promise<void> {
    await this.transport.close();
  }
}

export function createAHPTestHarness(
  options: AHPTestHarnessOptions = {}
): WorkbenchTestHarness | null {
  const enabled = options.enabled ?? isAHPTestModeEnabled(options.env);
  if (!enabled) {
    return null;
  }

  return new WorkbenchTestHarness({
    timeouts: options.timeouts,
    transport: options.transport,
    faultInjection: options.faultInjection,
  });
}
