# 0001. Tauri v2 desktop shell with a Node sidecar

- **Status:** Accepted
- **Date:** 2026-10-14

## Context

Overly is a desktop app that sits in the system tray, but almost all of its logic (HTTP and WebSocket server, Twitch clients, pipeline engine, plugin host) is TypeScript. Plugins can ship Node backend code, so the app needs a real Node.js runtime. The shell must stay small, start fast, and give access to OS features: tray, single instance, keychain, autostart, updater, and later input injection.

## Decision

The desktop shell is a **Tauri v2** app written in Rust (`apps/desktop`). It starts a **Node sidecar**: a bundled Node.js LTS binary that runs Overly's server bundle (`server.mjs`). The shell and the sidecar talk over a stdio JSON-RPC channel. OS-level features (keychain, input injection, global hotkeys) live in the shell and are exposed to the sidecar over that channel.

## Alternatives considered

- **Electron:** includes Node, but ships a whole Chromium for a tray icon. Overly opens no windows (ADR 0002), so that cost buys nothing.
- **A Node single-executable app with a tray library:** tray, updater and code signing support are weaker and less maintained than Tauri's plugins.
- **Bun as the runtime:** see ADR 0010. Plugin authors and dependencies expect Node.

## Consequences

- Two languages: Rust for the shell, TypeScript for everything else. Most contributors only touch TypeScript, and `bun run dev` works without Rust.
- The installer carries a Node binary (tens of MB), and the shell owns the sidecar's lifecycle: spawn, readiness, restart with backoff, and clean shutdown with no orphan process.
- Tauri's tray, single-instance, updater and autostart plugins cover later phases.
