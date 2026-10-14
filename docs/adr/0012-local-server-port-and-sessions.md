# 0012. Fixed default port 6859 and signed dashboard sessions

- **Status:** Accepted
- **Date:** 2026-10-14

## Context

OBS Browser Sources store full overlay URLs (`http://127.0.0.1:<port>/o/<id>`), so the port must stay the same from one start to the next. Streamers often run other local tools next to Overly, each with its own port: OBS WebSocket (4455), DroidCam (4747), Streamer.bot (7474 and 8080), plus web dev servers (3000, 5173, 8080).

ADR 0007 requires a dashboard session created from a one-time token. The sidecar can restart after a crash, and restarts constantly during development, so a session kept only in memory would send the user back to the tray after every restart.

## Decision

- The server listens on **127.0.0.1:6859** by default ("OVLY" on a phone keypad). `server.port` in `settings.json` changes it. If the port is taken, the server reports `port_in_use` to the shell and is not restarted (see [docs/sidecar-protocol.md](../sidecar-protocol.md)). `bun run dev` uses 6860, so it can run next to an installed Overly.
- **Session exchange:** the tray opens `/?t=<token>`. The token is random (32 bytes), single-use and valid for 2 minutes. The server answers with the session cookie and a `303` redirect to `/`, which removes the token from the address bar and the history. The token never appears in logs.
- **Session cookie:** `overly_session`, `HttpOnly; SameSite=Strict; Path=/`, valid for 30 days. It is **stateless and signed** (HMAC, through `@fastify/cookie`) with a 32-byte key stored in `<data>/session.key`, created on first run with owner-only permissions. Sessions therefore survive server restarts. **Deleting `session.key` signs every browser out.**
- Every `/api/*` route except `/api/health`, and the `/ws` upgrade, need the session. Overlays get their own per-widget authorization in Phase 2, because OBS doesn't share the browser's cookies.

## Alternatives considered

- **A random port on each start:** no conflicts, but every OBS scene would break after a restart.
- **Sessions kept in memory:** simpler, but a crash or a dev reload would sign the user out.
- **Storing the session key in the OS keychain:** stronger, but it only protects local sessions on a machine where the attacker would already be able to read the user's files, and the keychain arrives in Phase 3.

## Consequences

- Users whose port 6859 is taken must change `server.port`; the tray shows the exact file to edit.
- A stolen `overly_session` cookie stays valid until it expires or `session.key` is deleted; there is no per-session revocation.
- Cookies are not isolated by port: another web app served from `127.0.0.1` receives the cookie when the browser visits it, and could replay it. Programs running on the machine are outside the threat model of ADR 0007; they could read `session.key` anyway. Web pages from other sites can't use the cookie, because of `SameSite=Strict` and the Host and Origin checks.
