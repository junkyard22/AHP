# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

## [0.1.0] — 2026-04-01

### Added
- `MailmanPacket` — canonical v1 packet shape with typed `PacketType` and `PacketStatus`
- `createPacket()` / `createReply()` — factory helpers for building packets
- `Runtime` — core send pipeline with validate → route → deliver → trace
- `Registry` — role registration and lookup
- `Router` — resolves targets and dispatches to handlers
- `Validator` — validates required fields, known types, confidence bounds, and target acceptance
- `TraceStore` — in-memory trace log indexed by `packetId` and `taskId`
- `MiddlewareFn` — koa-style middleware system with `runtime.use(fn)`
- `MailmanClient` — fluent chainable wrapper over `Runtime`
- Timeout support via `packet.meta.timeoutMs`
- Singleton `getRuntime()` / `resetRuntime()` helpers
- CLI: `start`, `status`, `roles`, `inspect`, `doctor` commands
- Unit tests for Runtime, Registry, Validator, createPacket/createReply
- Examples: `basic-ping`, `task-pipeline`
- GitHub Actions CI (Node 18 + 20) and npm publish workflow
