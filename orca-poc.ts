/**
 * Orca Round-Table — Mailman Proof of Concept
 *
 * Proves AHP packet flow works between three agents:
 *
 *   Orchestrator
 *       └─ task.assign ──────────────► Brain
 *                                        └─ review.request ──► Pappy
 *                                        ◄─ review.result ────┘
 *       ◄─ task.result ──────────────┘
 *
 * Run with:
 *   npx tsx orca-poc.ts
 *   or: ts-node orca-poc.ts
 *
 * Requires @junkyard22/mailman to be installed:
 *   npm install @junkyard22/mailman
 *   or: pnpm add @junkyard22/mailman
 */

import { Runtime, createPacket, createReply } from "@junkyard22/mailman";
import { newTaskId } from "@junkyard22/mailman/dist/utils/ids";
import { readFileSync } from "fs";
import { join } from "path";

// Load .env.local if present
try {
  const env = readFileSync(join(process.cwd(), ".env.local"), "utf8");
  for (const line of env.split("\n")) {
    const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch { /* no .env.local, that's fine */ }

// ─────────────────────────────────────────────
//  Colours — makes the trace readable
// ─────────────────────────────────────────────

const C = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  dim:    "\x1b[2m",
  cyan:   "\x1b[36m",
  yellow: "\x1b[33m",
  green:  "\x1b[32m",
  red:    "\x1b[31m",
  blue:   "\x1b[34m",
  magenta:"\x1b[35m",
};

function log(role: string, colour: string, msg: string) {
  const pad = role.padEnd(14);
  console.log(`${colour}${C.bold}[${pad}]${C.reset} ${msg}`);
}

function divider(label: string) {
  console.log(`\n${C.dim}${"─".repeat(60)}${C.reset}`);
  console.log(`${C.bold}  ${label}${C.reset}`);
  console.log(`${C.dim}${"─".repeat(60)}${C.reset}\n`);
}

// ─────────────────────────────────────────────
//  Boot the runtime (in-memory, no SQLite)
// ─────────────────────────────────────────────

const runtime = new Runtime({ dbPath: ":memory:" });
runtime.start();

// ─────────────────────────────────────────────
//  PAPPY — quality verifier
//
//  Receives:  review.request  { output, expectedOutput, taskDescription }
//  Returns:   review.result   { verdict, confidence, notes }
//
//  Verdicts: PASS | WARN | FAIL
// ─────────────────────────────────────────────

runtime.registerRole(
  {
    name: "pappy",
    accepts: ["review.request"],
    description: "Quality verifier. Checks output against expected output.",
    capabilities: ["verify", "quality-gate"],
  },
  async (packet) => {
    const { output, expectedOutput, taskDescription } = packet.payload as {
      output: string;
      expectedOutput: string;
      taskDescription: string;
    };

    log("Pappy", C.magenta, `Received review request for: "${taskDescription}"`);
    log("Pappy", C.magenta, `  Expected: "${expectedOutput}"`);
    log("Pappy", C.magenta, `  Got:      "${output}"`);

    // Simple verification logic — check expected keywords are present
    const keywords = expectedOutput.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const outputLower = output.toLowerCase();
    const matched = keywords.filter(kw => outputLower.includes(kw));
    const coverage = keywords.length > 0 ? matched.length / keywords.length : 1;

    let verdict: "PASS" | "WARN" | "FAIL";
    let confidence: number;
    let notes: string;

    if (coverage >= 0.8) {
      verdict = "PASS";
      confidence = 0.85 + (coverage - 0.8) * 0.75; // 0.85–1.0
      notes = `Output satisfies expected result. Coverage: ${Math.round(coverage * 100)}%`;
    } else if (coverage >= 0.5) {
      verdict = "WARN";
      confidence = 0.5 + coverage * 0.3;
      notes = `Output partially satisfies expected result. Coverage: ${Math.round(coverage * 100)}%. Missing: ${keywords.filter(kw => !outputLower.includes(kw)).join(", ")}`;
    } else {
      verdict = "FAIL";
      confidence = 0.3;
      notes = `Output does not satisfy expected result. Coverage: ${Math.round(coverage * 100)}%`;
    }

    log("Pappy", C.magenta, `  Verdict: ${verdict} (confidence: ${confidence.toFixed(2)})`);

    return createReply(packet, "review.result", "pappy", {
      verdict,
      confidence,
      notes,
      coverage,
    });
  }
);

// ─────────────────────────────────────────────
//  BRAIN — planner + worker
//
//  Receives:  task.assign     { prompt, expectedOutput }
//  Sends:     review.request  → Pappy
//  Returns:   task.result     { answer, verdict, confidence }
// ─────────────────────────────────────────────

runtime.registerRole(
  {
    name: "brain",
    accepts: ["task.assign"],
    description: "Planner and router. Processes tasks and sends output to Pappy for verification.",
    capabilities: ["plan", "route", "execute"],
  },
  async (packet) => {
    const { prompt, expectedOutput } = packet.payload as {
      prompt: string;
      expectedOutput: string;
    };

    log("Brain", C.cyan, `Received task: "${prompt}"`);
    log("Brain", C.cyan, `  Expected output: "${expectedOutput}"`);

    // Simulate Brain doing actual work
    // In real Orca this is where the LLM call happens
    await sleep(120);
    const answer = await simulateLLM(prompt);

    log("Brain", C.cyan, `  Produced answer: "${answer}"`);
    log("Brain", C.cyan, `  Sending to Pappy for verification...`);

    // Send to Pappy for quality gate
    const reviewPacket = createPacket({
      taskId: packet.taskId,
      parentPacketId: packet.packetId,
      type: "review.request",
      sender: "brain",
      target: "pappy",
      payload: {
        output: answer,
        expectedOutput,
        taskDescription: prompt,
      },
    });

    const reviewResult = await runtime.send(reviewPacket);

    const { verdict, confidence, notes } = reviewResult.payload as {
      verdict: string;
      confidence: number;
      notes: string;
    };

    log("Brain", C.cyan, `  Pappy verdict: ${verdict} — ${notes}`);

    // If Pappy fails it, Brain could retry with a different approach
    // For now, we pass the verdict through to the orchestrator honestly
    return createReply(packet, "task.result", "brain", {
      answer,
      verdict,
      confidence,
      notes,
      pappyPacketId: reviewResult.packetId,
    });
  }
);

// ─────────────────────────────────────────────
//  Real LLM — OpenRouter (OpenAI-compatible API)
// ─────────────────────────────────────────────

const OR_MODEL = process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini";
const OR_URL   = "https://openrouter.ai/api/v1/chat/completions";

async function simulateLLM(prompt: string): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");

  const res = await fetch(OR_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer": "https://github.com/junkyard22/mailman",
      "X-Title": "Mailman Orca PoC",
    },
    body: JSON.stringify({
      model: OR_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 256,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${text}`);
  }

  const json = await res.json() as { choices: { message: { content: string } }[] };
  return json.choices[0].message.content.trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────
//  ORCHESTRATOR — runs the test cases
// ─────────────────────────────────────────────

async function runTask(prompt: string, expectedOutput: string): Promise<void> {
  const taskId = newTaskId();

  log("Orchestrator", C.yellow, `Sending task [${taskId}]`);
  log("Orchestrator", C.yellow, `  Prompt:   "${prompt}"`);
  log("Orchestrator", C.yellow, `  Expected: "${expectedOutput}"`);

  const startMs = Date.now();

  const assignPacket = createPacket({
    taskId,
    type: "task.assign",
    sender: "orchestrator",
    target: "brain",
    intent: prompt,
    payload: { prompt, expectedOutput },
    constraints: { readOnly: true },
    meta: { timeoutMs: 10_000, replyRequired: true },
  });

  const result = await runtime.send(assignPacket);

  const elapsed = Date.now() - startMs;

  if (result.type === "error.report") {
    log("Orchestrator", C.red, `  ✗ ERROR: ${result.error?.message}`);
    return;
  }

  const { answer, verdict, confidence, notes } = result.payload as {
    answer: string;
    verdict: string;
    confidence: number;
    notes: string;
  };

  const verdictColour = verdict === "PASS" ? C.green : verdict === "WARN" ? C.yellow : C.red;
  const verdictIcon   = verdict === "PASS" ? "✓" : verdict === "WARN" ? "⚠" : "✗";

  log("Orchestrator", C.yellow, `  Answer:   "${answer}"`);
  log("Orchestrator", verdictColour, `  ${verdictIcon} ${verdict} — confidence: ${(confidence * 100).toFixed(0)}% — ${notes}`);
  log("Orchestrator", C.dim,  `  Completed in ${elapsed}ms`);

  // Print the full packet trace for this task
  const trace = runtime.getTaskTrace(taskId);
  console.log(`\n${C.dim}  Trace (${trace.length} events):${C.reset}`);
  for (const entry of trace) {
    console.log(`${C.dim}    ${entry.timestamp.slice(11, 23)} [${entry.actor.padEnd(13)}] ${entry.event}${C.reset}`);
  }
}

// ─────────────────────────────────────────────
//  MAIN — run three test cases
// ─────────────────────────────────────────────

async function main() {
  divider("Orca Round-Table — AHP Proof of Concept");

  console.log(`${C.dim}Runtime started. Roles registered: ${runtime.listRoles().map(r => r.name).join(", ")}${C.reset}\n`);

  // ── Test 1: Should PASS ──────────────────
  divider("Test 1 — Should PASS (answer matches expected)");
  await runTask(
    "What is the capital of France?",
    "Paris capital France"
  );

  // ── Test 2: Should WARN ──────────────────
  divider("Test 2 — Should WARN (partial match)");
  await runTask(
    "How do I sort an array in JavaScript?",
    "sort array comparator ascending descending immutable spread"
  );

  // ── Test 3: Should FAIL ──────────────────
  divider("Test 3 — Should FAIL (output doesn't match expected)");
  await runTask(
    "What is the capital of France?",
    "refactor extract function helper conventions dead code"
  );

  // ── Runtime stats ────────────────────────
  divider("Runtime Stats");
  const stats = runtime.getStats();
  console.log(`  Packets processed:    ${stats.packetsProcessed}`);
  console.log(`  Packets failed:       ${stats.packetsFailed}`);
  console.log(`  Packets retried:      ${stats.packetsRetried}`);
  console.log(`  Packets dead-lettered:${stats.packetsDeadLettered}`);
  console.log(`  Started at:           ${stats.startedAt}`);

  divider("Done");
  console.log(`${C.green}${C.bold}  ✓ AHP packet flow verified: Orchestrator → Brain → Pappy → Brain → Orchestrator${C.reset}`);
  console.log(`${C.dim}  Ready to wire into Workbench / Maestro.${C.reset}\n`);

  runtime.stop();
}

main().catch(err => {
  console.error(`${C.red}Fatal error:${C.reset}`, err);
  process.exit(1);
});
