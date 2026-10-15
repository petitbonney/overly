# Built-in plugins

Built-in widgets and nodes live here, one folder per plugin, in the same format as third-party plugins (see [docs/plugins/](../docs/plugins/README.md) and [ADR 0005](../docs/adr/0005-plugins-with-isolated-backends.md)).

| Folder | Plugin | Widget types |
|---|---|---|
| `text-banner/` | `overly.text-banner` | `banner`: a line of text, shown and hidden by actions |

## Layout of a plugin folder

```
<plugin>/
  overly.plugin.json   the manifest
  package.json         a workspace, @overly/plugin-<name>, exporting "./backend"
  tsconfig.json        type-checks the backend, the overlay JS (checkJs) and the tests
  icons/               icons, served publicly
  overlay/             the overlay page: plain JS modules with // @ts-check, served publicly
  src/backend.ts       the backend (definePluginBackend), bundled into the sidecar
  src/*.test.ts        tests; overlay tests use // @vitest-environment jsdom
```

- Only the folder of each overlay entry and the icons are served over HTTP (`/plugins/<id>/…`) and copied into the build. Keep tests and anything private out of `overlay/`.
- Overlays have no build step: write ES modules that run as they are in OBS.
- A built-in backend is registered in `apps/server/src/plugins/builtin.ts`.

Each plugin folder is a Bun workspace (`plugins/*`) and a Vitest project.
