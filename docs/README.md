# Node.js SDK Documentation

## Get Started

- [Quickstart](quickstart.md) — 15-minute walkthrough: install, declare an agent + tool, run the worker, verify in the admin UI
- [Concepts](concepts.md) — mental model: agents, tools, instructions, baselines, overrides, inheritance state machine

## Reference

- [API reference](api.md) — `ConnectorApp`, `@agent`, `@tool`, `ToolHandler`, `ToolContext`, Zod integration

## Operate

- [Operations](operations.md) — Docker, environment variables, observability, reconnect supervisor, Node.js async notes, troubleshooting
- [Upgrading](upgrading.md) — coming from the PHP or Python SDK; v0.2.0 release notes

## Connector Protocol

- [Protocol overview](protocol/overview.md) — the bidi gRPC stream lifecycle
- [Messages](protocol/messages.md) — every frame, field by field
- [Authentication](protocol/auth.md) — JWT, rotation, revoke
- [Lifecycle](protocol/lifecycle.md) — handshake, heartbeats, drain, reconnect
- [Audit events](protocol/audit.md) — what the hub records
