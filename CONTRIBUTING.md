# Contributing to Overly

Thanks for your interest! Overly is built by humans steering AI coding agents (see [ADR 0009](docs/adr/0009-mit-license-and-ai-written-code.md)). Contributions written by hand or with an agent are both welcome, and are reviewed the same way.

## Before you start

- **Open an issue first** for anything bigger than a small fix, so we can agree on the approach.
- Check [ROADMAP.md](ROADMAP.md): work follows the phases in order.
- Read [AGENTS.md](AGENTS.md). It holds the architecture, conventions, commands and definition of done. If you use an AI agent, point it there (Claude Code reads it through `CLAUDE.md`).

## Setup

Prerequisites:

- [Bun](https://bun.sh), at the version in the root `package.json` `packageManager` field
- [Node.js LTS](https://nodejs.org) (version in `.node-version`)
- [Rust stable](https://rustup.rs), only to work on the desktop shell (`apps/desktop`), plus the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS

```bash
bun install
bun run lint
bun run typecheck
bun run test
```

## Pull requests

- Keep PRs focused: one change per PR, with tests.
- Make sure the checks in the [definition of done](AGENTS.md#definition-of-done) pass.
- Describe **how you verified** the change, ideally on a real or mock stream for user-facing features.
- Say if the change was written with an AI agent. That's fine and expected; it helps reviewers.
- Never commit secrets (tokens, keys, `.env` files).

## Reporting bugs and security issues

Use the issue templates for bugs and feature requests. Report security vulnerabilities **privately** through [GitHub security advisories](https://github.com/petitbonney/overly/security/advisories/new), not in public issues.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating, you agree to uphold it.
