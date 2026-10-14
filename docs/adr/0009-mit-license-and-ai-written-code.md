# 0009. MIT license; code written by AI agents, reviewed by humans

- **Status:** Accepted
- **Date:** 2026-10-14

## Context

Overly should be free to use, fork and embed. The project is developed by humans steering AI coding agents.

## Decision

- The license is **MIT**.
- The code is **vibe-coded**: written by AI agents and **reviewed by humans**, who set direction and test on real or mock streams.
- Agent instructions live in `AGENTS.md` (with `CLAUDE.md` pointing to it) so that every agent works the same way.

## Alternatives considered

- **GPL/AGPL:** would keep forks open, but makes embedding and plugin licensing harder for users.
- **Apache-2.0:** fine, but MIT is simpler and matches most of the JS ecosystem.

## Consequences

- Dependencies must have MIT-compatible licenses. This rules out embedding n8n (ADR 0004).
- Written conventions, strict types, lint and tests matter more, because agents follow what is written down and CI catches what isn't.
- Human review is required for every change.
