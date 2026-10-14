# 0008. Twitch sign-in with a shipped Client ID and the Device Code Flow

- **Status:** Accepted
- **Date:** 2026-10-14

## Context

Overly runs on users' machines, so it can't keep a client secret. Asking every streamer to register their own Twitch application is a big hurdle. A loopback redirect (`http://localhost:<port>`) needs a stable port registered with Twitch.

## Decision

- Overly ships a **project Client ID** for a Twitch application registered as a **public client**.
- Sign-in uses the **Device Code Flow**: the dashboard shows a code and a link to `twitch.tv/activate`, then polls for the token. No secret, no redirect.
- Users can **override the Client ID** in settings, for example to use their own application.
- Tokens are stored in the **OS keychain** through the shell, never in config files or exports.

The Client ID lives in `packages/shared/src/twitch.ts`. Registration steps are in [docs/twitch-app.md](../twitch-app.md).

## Alternatives considered

- **Authorization Code flow with a secret:** impossible to keep a secret in a desktop app.
- **Implicit flow with a loopback redirect:** deprecated pattern, and it ties sign-in to a fixed port.

## Consequences

- Public clients get rotating, single-use refresh tokens. The token refresh logic must handle that (Phase 3).
- All Overly users share the application's rate limits for app-level calls; user-token calls are per user.
