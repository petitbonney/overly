# 0013. Plugin schemas are a JSON Schema subset, validated with Zod and rendered by Overly

- **Status:** Accepted
- **Date:** 2026-10-15

## Context

Plugins describe widget settings, action parameters and outputs, and event payloads (ADR 0003, ADR 0005). The dashboard must turn settings into a form, and the server must validate settings, parameters and events at every boundary. Plugin authors know JSON Schema, and editors understand it. But full JSON Schema allows constructs (`oneOf`, `$ref`, `if`/`then`, `pattern`) that no form generator renders well, and the usual validator (Ajv) compiles schemas into JavaScript with `new Function`, which the dashboard's Content-Security-Policy forbids. The rest of Overly validates with Zod (AGENTS.md).

## Decision

- Plugin schemas use a **subset of JSON Schema 2020-12**: `string`, `number`, `integer`, `boolean`, `object` and `array`, with `enum`, `default`, `required`, length, range, `multipleOf` and item-count keywords, plus `title`, `description` and **UI hints under `x-overly`** (`textarea`, `color`, `asset` with `accept`, `slider`, `unit`, `placeholder`, `enumLabels`). Anything else is a manifest error. Nesting is limited to 5 levels.
- Every setting has a **default**, so a new widget is always valid.
- `schemaToZod` in `@overly/shared` converts a schema into Zod. The server and the dashboard validate with it; defaults use Zod `prefault`, so they are validated too.
- The dashboard renders forms with **its own small renderer** of Mantine inputs (with `@mantine/form`), one input per type and hint.
- The manifest's JSON Schema is generated from Zod (`bun run generate:schemas`), and a test fails when the committed file is out of date.

## Alternatives considered

- **Full JSON Schema with Ajv and react-jsonschema-form (`@rjsf/mantine`):** more expressive for authors, but Ajv needs `unsafe-eval` in the CSP, RJSF is large and Apache-2.0, many valid schemas render poorly, and the asset and color pickers would be custom widgets anyway.
- **JSON Forms with a separate UI schema:** two documents per form for plugin authors, and Ajv again.
- **A home-made schema language:** simplest to implement, but authors and editors couldn't use their JSON Schema knowledge or tools.

## Consequences

- Every valid manifest validates and renders; authors get clear manifest errors instead of forms that half work.
- Adding a keyword or a hint later is a format change: new manifests using it fail on older versions of Overly. Changes are free until the format freezes at v1.0 (Phase 10), then follow `apiVersion`.
- `pattern` is not supported, which also avoids regular-expression denial of service from third-party schemas.
