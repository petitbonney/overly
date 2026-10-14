# Sidecar protocol

The desktop shell (`apps/desktop`, Rust) starts the Node sidecar (`server.mjs`, from `apps/server`) and talks to it over the sidecar's standard streams ([ADR 0001](adr/0001-tauri-shell-with-node-sidecar.md)). This page is the contract between the two. The Zod schemas live in [`packages/shared/src/sidecar.ts`](../packages/shared/src/sidecar.ts); the Rust side is [`apps/desktop/src-tauri/src/protocol.rs`](../apps/desktop/src-tauri/src/protocol.rs).

## Framing

- [JSON-RPC 2.0](https://www.jsonrpc.org/specification), **one JSON message per line** (UTF-8, `\n`-terminated).
- **stdin** carries messages from the shell to the server. **stdout** carries messages from the server to the shell. Nothing else may be written to stdout: server code logs with pino (to a file), never with `console`.
- **stderr** carries plain text (for example a startup error or a Node crash). The shell copies each line into its own log.
- Lines that aren't valid JSON-RPC are logged and skipped. A request for an unknown method gets the error `-32601`.

The server only speaks this protocol when it is started with `--rpc`.

## Messages

| Direction | Kind | Method | Params | Result |
|---|---|---|---|---|
| server → shell | notification | `ready` | `{ "port": 6859, "version": "0.0.0" }` | |
| server → shell | notification | `fatal` | `{ "code": "port_in_use", "message": "…" }` | |
| shell → server | request | `getDashboardUrl` | none | `{ "url": "http://127.0.0.1:6859/?t=<token>" }` |
| shell → server | request | `shutdown` | none | `{}` |

`fatal` codes:

| Code | Meaning |
|---|---|
| `port_in_use` | Another program listens on the port. |
| `port_unavailable` | The OS refuses the port (Windows can reserve ranges for Hyper-V or WSL). |
| `config_unsupported` | `settings.json` was written by a newer version of Overly. |
| `startup_failed` | Anything else. |

Examples, one line each:

```json
{"jsonrpc":"2.0","method":"ready","params":{"port":6859,"version":"0.0.0"}}
{"jsonrpc":"2.0","id":1,"method":"getDashboardUrl"}
{"jsonrpc":"2.0","id":1,"result":{"url":"http://127.0.0.1:6859/?t=3oX2…"}}
{"jsonrpc":"2.0","id":2,"method":"shutdown"}
{"jsonrpc":"2.0","id":2,"result":{}}
```

Both sides implement a full peer (requests with ids, responses, notifications), so later phases can add server → shell requests (Phase 3: `secrets.get`, `secrets.set`, `secrets.delete` for the OS keychain) without changing the framing.

## Lifecycle

1. The shell spawns `node server.mjs --rpc` with piped stdio.
2. The server loads its settings, binds `127.0.0.1:<port>`, then sends `ready`. If it can't start, it sends `fatal` and exits with code 1.
3. The shell waits up to **20 s** for `ready`. Without it, the shell kills the process and treats it as a crash.
4. While running, the shell sends `getDashboardUrl` for every *Dashboard* click. Each URL holds a one-time token, valid for 2 minutes.
5. On *Quit*, the shell sends `shutdown`. The server answers `{}`, closes WebSockets, stops runs, flushes its files and logs, and exits with code 0 (code 1 if that takes more than **5 s**). The shell kills the process if it hasn't exited after **8 s**.

Other rules:

- **stdin closing means the shell is gone.** The server then shuts down as for `shutdown`. On Windows, the sidecar also belongs to a Job Object that kills it when the shell exits, even if the shell is killed.
- **Crashes are restarted** with a backoff of 0.5 s, doubling up to 30 s. The backoff starts over after 60 s of running.
- **`fatal` is never restarted.** The tray shows the message until the user quits.
