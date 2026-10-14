# 0010. Bun for tooling, Node.js LTS as the shipped runtime

- **Status:** Accepted
- **Date:** 2026-10-14

## Context

The repository is a TypeScript monorepo with several workspaces. Installs and scripts should be fast. The shipped server and third-party plugin backends need a stable, well-known runtime.

## Decision

- **Bun** is the package manager, workspace manager and script runner. The version is pinned in the root `packageManager` field, and `bun.lock` is committed. Installs use Bun's **isolated** linker, so each workspace only sees the dependencies it declares.
- **Node.js LTS** is the runtime of the shipped sidecar.
- Server tests run **under Node through Vitest**, so behavior matches production. Use `bun run test`, not `bun test` (which starts Bun's own test runner).

## Alternatives considered

- **pnpm or npm:** work well, but are slower and need a separately installed tool.
- **Bun as the runtime too:** smaller toolchain, but Node compatibility gaps would surface in plugins and dependencies, and Node has longer LTS support.

## Consequences

- Contributors need Bun and Node.js LTS installed (and Rust only for the desktop shell).
- CI sets up both Bun and Node.
- Code must not use Bun-only APIs (`Bun.*`, `bun:*` modules) outside build scripts.
