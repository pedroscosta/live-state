# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a monorepo for `@live-state/sync` - a real-time sync engine with built-in client store and ORM. The project uses pnpm workspaces and Turborepo.

## Build and Development Commands

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Dev mode (watch)
pnpm dev

# Run all tests
pnpm test

# Run single test file (from packages/live-state/)
cd packages/live-state && pnpm test -- test/server/router.test.ts

# Watch mode for single test
cd packages/live-state && pnpm test:watch -- test/server/router.test.ts

# Linting and type checking
pnpm lint
pnpm typecheck

# Format code
pnpm format
```

## Architecture

### Package Structure

- `packages/live-state/` - Core sync engine (`@live-state/sync`)
- `packages/config-typescript/` - Shared TypeScript configurations
- `docs/` - Documentation site (Next.js + Fumadocs)
- `examples/` - Example applications (api, storefront, complex-relations)

### Entry Points

The main package exports multiple entry points:
- `@live-state/sync` - Schema definitions and LogLevel
- `@live-state/sync/server` - Server class, Router, Route, Storage, Express adapter
- `@live-state/sync/client` - WebSocket client, React hooks
- `@live-state/sync/client/fetch` - Fetch-based client

### Core Abstractions

**Server-side:**
- `Server` - Main server class that orchestrates routing, storage, and query processing
- `Router` - Maps resources to routes, manages hooks registry
- `Route` - Handles queries and mutations for a specific resource with authorization
- `Storage` - Abstract storage layer (SQL implementations available)
- `QueryEngine` - Processes queries with relational support

**Client-side:**
- `Client` - WebSocket client with IndexedDB caching
- `QueryBuilder` - Fluent API for building queries
- React hooks: `useLiveQuery`, `useLoadData`

**Schema:**
- `LiveObject` - Defines entity schemas with fields and relations
- `LiveType` - Type definitions for atomic types (string, number, etc.)
- `Schema` - Container for all LiveObjects

## Code Style

- **Indentation**: Tabs (Biome configured)
- **Quotes**: Single quotes
- **Type imports**: Use `import type` for type-only imports
- **Type parameters**: Prefix with `T` (e.g., `TSchema`, `TRouter`)
- **Files**: kebab-case (e.g., `sql-storage.ts`)

### Biome Ignores

```typescript
/** biome-ignore-all lint/suspicious/noExplicitAny: reason here */
// biome-ignore lint/suspicious/noExplicitAny: reason here
```

## Testing

Tests use Vitest and are in `packages/live-state/test/`.

**Test patterns:**
- Unit tests: `test/**/*.test.ts`
- Type tests: `test/**/*.test-d.ts`
- E2E tests: `test/e2e/*.test.ts`

**Prefer fuzzy matching:**
```typescript
expect(mockStorage.rawFind).toHaveBeenCalledWith(
  expect.objectContaining({
    resource: "users",
    where: {},
  })
);
```

## CI Requirements

Before submitting PRs:
1. `pnpm typecheck --filter="./packages/*"`
2. `pnpm lint --filter="./packages/*" -- --diagnostic-level error`
3. `pnpm test --filter="./packages/*"`

## Key Dependencies

- `zod` (v4) - Schema validation
- `kysely` - SQL query builder
- `idb` - IndexedDB wrapper (client)
- `ws` - WebSocket (server)
- `vitest` - Testing
- `tsup` - Bundling
