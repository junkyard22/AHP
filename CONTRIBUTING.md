# Contributing to Mailman

Thanks for your interest in contributing! Here's how to get started.

---

## Development Setup

```bash
# Clone the repo
git clone https://github.com/junkyard22/mailman.git
cd mailman

# Install dependencies (requires pnpm)
pnpm install
```

## Scripts

| Command | What it does |
|---|---|
| `pnpm build` | Compile TypeScript to `dist/` |
| `pnpm dev` | Watch mode — recompiles on save |
| `pnpm test` | Run the full test suite |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm test:coverage` | Run tests with coverage report |
| `pnpm typecheck` | Type-check without emitting |
| `pnpm clean` | Delete `dist/` |

## Project Structure

```
src/
  packet/        — Packet types, createPacket, createReply
  core/          — Runtime, Registry, Router, Validator, TraceStore, Middleware
  client/        — MailmanClient (public API wrapper)
  cli/           — Commander-based CLI
  utils/         — ID generation, timestamps
examples/
  basic-ping/    — Minimal health ping demo
  task-pipeline/ — Three-role pipeline demo
```

## Running Examples

```bash
# You'll need ts-node installed
npx ts-node examples/basic-ping/index.ts
npx ts-node examples/task-pipeline/index.ts
```

## Submitting a PR

1. Fork the repo and create a feature branch
2. Make your changes
3. Add tests for new behavior
4. Run `pnpm typecheck && pnpm test && pnpm build` — all must pass
5. Open a PR against `main`

## Reporting Issues

Please use [GitHub Issues](https://github.com/your-org/mailman/issues).
Include the Mailman version, Node version, and a minimal reproduction.
