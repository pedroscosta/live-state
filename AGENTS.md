# AGENTS.md - Coding Agent Guidelines

This file contains instructions for AI coding agents working in this repository.

## Project Overview

This is a monorepo for `@live-state/sync` - a real-time sync engine with built-in client store and ORM. The project uses pnpm workspaces and Turborepo.

### Key Packages

- `packages/live-state/` - Core sync engine (`@live-state/sync`)
- `packages/config-typescript/` - Shared TypeScript configurations
- `docs/` - Documentation site (Next.js + Fumadocs)
- `examples/` - Example applications

## Build, Test, and Lint Commands

### Prerequisites

- Node.js >= 18
- pnpm 10.7.0 (specified in `package.json`)

### Installation

```bash
pnpm install
```

### Build

```bash
pnpm build                    # Build all packages
pnpm dev                      # Dev mode for all packages
```

### Testing

```bash
# Run all tests
pnpm test

# Run tests for packages only
pnpm test --filter="./packages/*"

# Run tests with coverage
pnpm test --filter="./packages/*" -- --coverage

# Run a SINGLE test file (from packages/live-state/)
cd packages/live-state
pnpm test -- path/to/test.test.ts

# Run a single test file in watch mode
pnpm test:watch -- path/to/test.test.ts

# Examples:
pnpm test -- test/server/router.test.ts
pnpm test -- test/e2e/e2e.test.ts
```

### Linting and Type Checking

```bash
pnpm lint                     # Run linting via Turbo
pnpm typecheck                # Run TypeScript type checking
pnpm format                   # Format with Prettier
```

## Code Style Guidelines

### Formatting (Biome)

- **Indentation**: Tabs (not spaces)
- **Quotes**: Single quotes for JavaScript/TypeScript
- **Imports**: Auto-organized by Biome

### TypeScript

- Strict mode enabled (`strict: true`, `strictNullChecks: true`)
- Module system: ESNext with Bundler resolution
- Allow importing `.ts` extensions

### Import Patterns

```typescript
// Type-only imports - use 'import type' for types
import type { LiveObjectAny, Schema, WhereClause } from "../schema";

// Mixed imports - inline 'type' keyword for type-only imports
import { type InferLiveType, LiveType, type LiveTypeAny } from "./live-type";

// Barrel exports via index.ts
export * from "./atomic-types";
export * from "./live-type";
```

### Naming Conventions

| Element           | Convention       | Example                                |
| ----------------- | ---------------- | -------------------------------------- |
| Classes           | PascalCase       | `LiveObject`, `QueryBuilder`, `Server` |
| Functions/methods | camelCase        | `createSchema`, `handleQuery`          |
| Types/Interfaces  | PascalCase       | `WhereClause`, `QueryResult`           |
| Type parameters   | TPrefix          | `TSchema`, `TRouter`, `TShape`         |
| Constants/Enums   | UPPER_SNAKE_CASE | `LogLevel.INFO`                        |
| Files             | kebab-case       | `sql-storage.ts`, `core-protocol.ts`   |

### Error Handling

- Use explicit error classes when applicable
- Throw descriptive errors: `throw new Error("Method not implemented.");`

### Biome Ignore Patterns

When bypassing lint rules, use comments with explanations:

```typescript
/** biome-ignore-all lint/suspicious/noExplicitAny: reason here */

// biome-ignore lint/suspicious/noExplicitAny: reason here
```

## Testing Guidelines

Test files are located in `packages/live-state/test/` and use Vitest.

### Test File Patterns

- Unit tests: `test/**/*.test.ts`
- Type tests: `test/**/*.test-d.ts`
- E2E tests: `test/e2e/*.test.ts`

### Test Style

Use other tests as guidance for code behavior. Prefer fuzzy matching over precise matching:

```typescript
// PREFERRED: Use expect.objectContaining for partial matching
expect(mockStorage.rawFind).toHaveBeenCalledWith(
  expect.objectContaining({
    resource: "users",
    where: {},
  }),
);

// Only use precise matching when verifying a property is NOT present
```

### Test Structure

```typescript
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

describe("FeatureName", () => {
  beforeEach(() => {
    // Setup
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("should do something specific", () => {
    // Arrange, Act, Assert
  });
});
```

## Project Structure (packages/live-state/)

```
src/
├── index.ts              # Main exports (schema + LogLevel)
├── utils.ts              # Utilities (hash, applyWhere, Logger)
├── schema/               # Schema definition system
├── client/               # Client-side code (browser platform)
│   ├── react.tsx         # React hooks (useLiveQuery, useLoadData)
│   ├── query.ts          # QueryBuilder
│   ├── websocket/        # WebSocket client
│   └── fetch/            # HTTP fetch client
├── server/               # Server-side code
│   ├── router.ts         # Router, Route, mutations
│   ├── storage/          # Storage layer (SQL, etc.)
│   ├── adapters/         # Framework adapters (Express)
│   └── transport-layers/ # WebSocket, HTTP transports
└── core/                 # Shared core utilities
    ├── query-engine/     # Query processing
    └── schemas/          # Protocol schemas (Zod)
```

## Entry Points

The package exports multiple entry points:

- `@live-state/sync` - Schema exports
- `@live-state/sync/server` - Server-side exports
- `@live-state/sync/client` - WebSocket client (browser)
- `@live-state/sync/client/fetch` - Fetch-based client (browser)

## PR and Commit Guidelines

PR titles must follow **Conventional Commits** specification:

- `feat: add new feature`
- `fix: resolve bug`
- `docs: update documentation`
- `refactor: restructure code`
- `test: add tests`
- `chore: maintenance tasks`

## CI Requirements

Before submitting PRs, ensure:

1. Type checking passes: `pnpm typecheck --filter="./packages/*"`
2. Linting passes: `pnpm lint --filter="./packages/*" -- --diagnostic-level error`
3. Tests pass: `pnpm test --filter="./packages/*"`

## Key Dependencies

- `zod` (v4) - Schema validation
- `kysely` - SQL query builder
- `idb` - IndexedDB wrapper (client)
- `ws` - WebSocket (server)
- `vitest` - Testing framework
- `tsup` - Bundling
