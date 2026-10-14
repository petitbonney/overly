# The Overly Twitch application

Overly signs users in with the **Device Code Flow** and a **public** Twitch application whose Client ID ships with the app (see [ADR 0008](adr/0008-twitch-device-code-flow.md)). A Client ID is public: it is not a secret and is safe to commit. There is **no client secret**, so nothing else needs to be stored.

The Client ID lives in [`packages/shared/src/twitch.ts`](../packages/shared/src/twitch.ts).

## Registering the application

Maintainers only do this once. Forks that want their own application do the same, and users can also override the Client ID in Overly's settings.

1. Sign in at <https://dev.twitch.tv/console/apps> (Twitch requires two-factor authentication for developer applications).
2. Click **Register Your Application** and fill in:
   - **Name:** `Overly` (must be unique on Twitch)
   - **OAuth Redirect URLs:** `http://localhost`. The Device Code Flow doesn't use it, but the form requires one.
   - **Category:** Broadcaster Suite
   - **Client Type:** **Public**. The Device Code Flow only works for public clients, and public clients have no secret.
3. Click **Create**, open the application with **Manage**, and copy its **Client ID**.
4. Put the Client ID in `packages/shared/src/twitch.ts`, then run `bun run test`. A test checks that it has the format Twitch issues.

## Never commit

Tokens (access and refresh tokens) are secrets. They are stored in the OS keychain, never in the repository, config files, logs or exports. If the application ever gets a client secret (it should not), it must never be committed either.
