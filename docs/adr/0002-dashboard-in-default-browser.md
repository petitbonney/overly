# 0002. The dashboard opens in the default browser

- **Status:** Accepted
- **Date:** 2026-10-14

## Context

Streamers already have a browser open next to OBS. The dashboard is a web app served by the local server anyway, because overlays are web pages loaded by OBS Browser Sources.

## Decision

The dashboard opens in the user's **default browser** at the local server's URL. Overly opens **no native windows**: the tray menu (*Dashboard*, *Quit*) is the only native UI.

## Alternatives considered

- **A Tauri webview window:** adds window management and a second rendering engine (WebView2 on Windows) to test, for no clear gain. It also hides the URL, which users need to understand overlays.

## Consequences

- The local server must be safe to expose to a browser that also visits other sites: Host allowlist, Origin checks and a session cookie created from a one-time token (see ADR 0007).
- The dashboard must work in all mainstream browsers, not one known engine.
- A future remote dashboard (phone on the LAN) follows naturally.
