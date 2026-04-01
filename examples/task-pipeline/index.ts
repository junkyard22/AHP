/**
 * examples/task-pipeline/index.ts
 *
 * A three-role pipeline demonstrating real multi-agent task flow:
 *   orchestrator → worker → reviewer
 *
 * The orchestrator assigns a task, the worker completes it,
 * the reviewer approves or rejects the result.
 *
 * Run with: npx ts-node examples/task-pipeline/index.ts
 */

import { Runtime, createPacket, createReply, MailmanPacket } from "../../src/index";

// ─────────────────────────────────────────────
//  Role: worker
// ─────────────────────────────────────────────

async function workerHandler(packet: MailmanPacket): Promise<MailmanPacket> {
  console.log(`  [worker] received task: "${packet.payload.prompt}"`);

  // Simulate doing some work
  const result = String(packet.payload.prompt).toUpperCase();

  return createReply(packet, "task.result", "worker", {
    result,
    tokensUsed: 42,
  });
}

// ─────────────────────────────────────────────
//  Role: reviewer
// ─────────────────────────────────────────────

async function reviewerHandler(packet: MailmanPacket): Promise<MailmanPacket> {
  console.log(`  [reviewer] reviewing result: "${packet.payload.result}"`);

  const approved = String(packet.payload.result).length > 0;
  return createReply(packet, "review.result", "reviewer", {
    approved,
    notes: approved ? "Looks good." : "Empty result — rejected.",
  });
}

// ─────────────────────────────────────────────
//  Main
// ─────────────────────────────────────────────

async function main() {
  const runtime = new Runtime();

  // Add a logging middleware — logs every packet in flight
  runtime.use(async (packet, next) => {
    console.log(`→ [${packet.type}] ${packet.sender} → ${packet.target}`);
    const reply = await next();
    console.log(`← [${reply.type}] status: ${reply.status ?? "n/a"}`);
    return reply;
  });

  runtime.start();

  // Register roles
  runtime.registerRole({ name: "worker", accepts: ["task.assign"] }, workerHandler);
  runtime.registerRole({ name: "reviewer", accepts: ["review.request"] }, reviewerHandler);

  // ── Step 1: assign task to worker ─────────────
  console.log("\n── Step 1: Orchestrator assigns task ──");
  const taskPacket = createPacket({
    taskId: "pipeline-demo-1",
    type: "task.assign",
    sender: "orchestrator",
    target: "worker",
    payload: { prompt: "Summarize: AI is transforming software." },
    meta: { replyRequired: true, timeoutMs: 5000 },
  });

  const workerReply = await runtime.send(taskPacket);

  if (workerReply.type === "error.report") {
    console.error("Worker failed:", workerReply.error);
    return;
  }

  console.log(`\n  Worker result: "${workerReply.payload.result}"`);

  // ── Step 2: send worker result for review ──────
  console.log("\n── Step 2: Orchestrator requests review ──");
  const reviewPacket = createPacket({
    taskId: "pipeline-demo-1",
    type: "review.request",
    sender: "orchestrator",
    target: "reviewer",
    payload: {
      originalPrompt: taskPacket.payload.prompt,
      workerResult: workerReply.payload.result,
    },
  });

  const reviewReply = await runtime.send(reviewPacket);

  console.log(`\n  Review approved: ${reviewReply.payload.approved}`);
  console.log(`  Notes: ${reviewReply.payload.notes}`);

  // ── Summary ─────────────────────────────────────
  const stats = runtime.getStats();
  console.log(`\n── Done — ${stats.packetsProcessed} packets processed ──\n`);
}

main().catch(console.error);
