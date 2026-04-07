import { StreamController } from "../packet/types";

// ─────────────────────────────────────────────
//  StreamSession
//
//  One active streaming session. The handler side
//  calls push/end/error; the consumer side iterates
//  via `for await (const chunk of session) { ... }`.
// ─────────────────────────────────────────────

type InternalChunk =
  | { kind: "chunk"; value: string }
  | { kind: "end" }
  | { kind: "error"; error: Error };

export class StreamSession implements StreamController {
  private readonly queue: InternalChunk[] = [];
  private readonly waiters: Array<(chunk: InternalChunk) => void> = [];
  private _ended = false;

  get isEnded(): boolean {
    return this._ended;
  }

  // ── Producer API (handler side) ───────────

  push(chunk: string): void {
    if (this._ended) return;
    this.enqueue({ kind: "chunk", value: chunk });
  }

  end(): void {
    if (this._ended) return;
    this._ended = true;
    this.enqueue({ kind: "end" });
  }

  error(err: Error): void {
    if (this._ended) return;
    this._ended = true;
    this.enqueue({ kind: "error", error: err });
  }

  // ── Consumer API (async iterable) ─────────

  async *[Symbol.asyncIterator](): AsyncGenerator<string> {
    while (true) {
      const chunk = await this.dequeue();
      if (chunk.kind === "end")   return;
      if (chunk.kind === "error") throw chunk.error;
      yield chunk.value;
    }
  }

  // ── Internal plumbing ─────────────────────

  private enqueue(chunk: InternalChunk): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(chunk);
    } else {
      this.queue.push(chunk);
    }
  }

  private dequeue(): Promise<InternalChunk> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

// ─────────────────────────────────────────────
//  StreamSessionStore — tracks all active sessions
// ─────────────────────────────────────────────

export class StreamSessionStore {
  private readonly sessions = new Map<string, StreamSession>();

  create(streamId: string): StreamSession {
    const session = new StreamSession();
    this.sessions.set(streamId, session);
    return session;
  }

  get(streamId: string): StreamSession | undefined {
    return this.sessions.get(streamId);
  }

  delete(streamId: string): void {
    this.sessions.delete(streamId);
  }

  has(streamId: string): boolean {
    return this.sessions.has(streamId);
  }

  activeCount(): number {
    return this.sessions.size;
  }
}
