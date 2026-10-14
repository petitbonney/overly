# 0011. Dashboard stack: React Router, TanStack Query and Mantine

- **Status:** Accepted
- **Date:** 2026-10-14

## Context

The dashboard is a React + Vite SPA (ADR 0002). Phase 1 only needs a layout, but the next phases need a lot of UI quickly: a widget library modal, settings forms generated from JSON Schema, toggles, lists, menus, notifications, and a pipeline canvas (React Flow, ADR 0004). It must look right in light and dark mode and be accessible (Phase 10 does an accessibility pass). Most of the code is written by AI agents, so well-known libraries with stable APIs are worth more than full visual control.

## Decision

- **Routing:** React Router, with declarative routes.
- **Server state:** TanStack Query for every HTTP call.
- **Components and theming:** **Mantine** (`@mantine/core`, `@mantine/hooks`, with `postcss-preset-mantine`). Light, dark and auto (OS) color schemes come from Mantine; the user's choice is stored in the browser's local storage.

## Alternatives considered

- **Tailwind CSS with Radix primitives (shadcn-style):** very flexible and common in AI-written code, but the component code is copied into the repository and becomes ours to maintain.
- **Plain CSS Modules with design tokens:** the smallest dependency footprint, but every modal, menu and input would be built and made accessible by hand.
- **TanStack Router:** stronger typing, but less familiar, and Phase 1 has two routes.

## Consequences

- Modals, menus, inputs and dark mode are available without building them. Their look is Mantine's, adjusted through the theme in `apps/dashboard/src/theme.ts`.
- Generated settings forms (Phase 2) should render Mantine inputs.
- Mantine needs `matchMedia` and `ResizeObserver`, so the dashboard's test setup stubs them for jsdom.
