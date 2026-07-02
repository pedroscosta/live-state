To Do:

- [x] Lifecycle functions
- [ ] Client-side optimistic mutations for custom mutations
- [x] Typed Context


# Routers:

A `Router` is the collection of `Routes`.

`Routes` are the collection of `Mutations` and `Queries`.

## Differences from V2

- Routes are no longer tied to an `Entity`.
- Routes are seeing a major simplification in the syntax.
- We no longer have authorization handlers, authorization is now handled inside the procedures handlers.
- We no longer have "default" procedures, we now have procedures that are explicitly defined. (Except for the legacy routes that are tied to an `Entity`. But are now deprecated.)


## Similarities to V2

- Routes still have access to the `Context`. Provided by the `ContextProvider` (Server).
- Routes still have `Middleware`s. Created on the route itself or on a router factory.

**Examples**

This is an example of a `Router` declaration:

```typescript
const router = router({
  routes: {
    // This is a legacy route that is tied to an `Entity`.
    users: routeFactory().collectionRoute(schema.users),
    // This is a new route that is not tied to an `Entity`.
    // Note that it's called withProcedures instead of withMutations
    posts: routeFactory().withProcedures(({ query, mutation }) => ({
      find: query(z.object({
        limit: z.number().optional(),
        offset: z.number().optional(),
      })).handler(async ({ req, db, ctx }) => {
        // Use the database to get the user
        // This is NOT the query that will be tracked by the query engine and sent to the client.
        // Major difference from V2: uses a syntax identical to client-side queries.
        const user = await db.users.first({id: ctx.user.id}).get();

        // Returns a unresolved query (no .get() called)
        // This is the query that will be tracked by the query engine and sent to the client.
        return db.posts.where({ authorId: user.id }).limit(req.input.limit).offset(req.input.offset);
      }),
      insert: mutation(z.object({
        title: z.string(),
        content: z.string(),
      })).handler(async ({ req, db }) => {
        // Difference from V2: uses the same syntax as client-side mutations.
        // It will internally handle the conflict resolution and propagation of the new record via the query engine.
        return db.posts.insert(req.input);
      }),
    })),
  },
});
```

# Query Builder API:

The Query Builder provides a fluent, chainable API for constructing queries on both the client and server side. It supports filtering, sorting, limiting, and including related entities.

## Basic Methods

- `.where(conditions)` - Filter records by conditions
- `.limit(n)` - Limit the number of results
- `.orderBy(key, direction)` - Sort results by a field
- `.first(where?)` - Get the first matching record
- `.one(id)` - Get a record by ID (shorthand for `.first({ id })`)
- `.get()` - Execute the query and return results
- `.subscribe(callback)` - Subscribe to real-time updates

## Including Relations

### Deprecated: Simple Object-based `.include()`

The simple object-based `.include()` syntax with boolean values is **deprecated** and will be removed in a future version:

```typescript
// ❌ DEPRECATED - Simple object-based include
const users = await db.users
  .include({ 
    posts: true,
    profile: {
      avatar: true 
    }
  })
  .get();
```

### New: Sub-query `.include()`

Use sub-queries in `.include()` for more flexibility. Instead of just passing `true`, pass a query object that supports all query methods:

```typescript
// ✅ NEW - Sub-query include
const users = await db.users
  .include({ 
    posts: {
      where: { published: true },
      limit: 10,
      orderBy: [{ key: 'createdAt', direction: 'desc' }],
      include: {
        author: true, // Simple include (no specific conditions)
      },
    },
    profile: {
      where: { avatar: true },
    },
    comments: {
      where: { approved: true },
    },
  })
  .get();
```


### Migration Example

```typescript
// Old (deprecated)
const oldQuery = db.users
  .include({ 
    posts: true,
    comments: {
      author: true
    }
  })
  .get();

// New (recommended)
const newQuery = db.users
  .include({ 
    posts: {
      include: {
        comments: {
          include: {
            author: true,
          },
        },
      },
    }
  })
  .get();
```

# Client-Side Optimistic Mutations for Custom Mutations

Currently, built-in mutations (`insert` and `update`) automatically provide optimistic updates when using the WebSocket client. Custom mutations do not have this capability. This section documents the API design for adding optimistic mutation support for custom mutations.

## Requirements

1. **Declaration-Based**: Optimistic mutations must be declared once, upfront, similar to how server mutations are declared on the router
2. **Client-Side Only**: Declarations must be client-side only - clients can only import server types, not server code
3. **Automatic Reversibility**: Optimistic mutations must be automatically undo-able without requiring extra code from developers
4. **API Consistency**: The API should follow similar patterns to existing live-state APIs

## Current Behavior

- Built-in mutations (`insert`/`update`) automatically apply optimistic updates
- Custom mutations (`store.mutate.routeName.customMethod()`) do not apply optimistic updates
- When a mutation is rejected, the system automatically reverts optimistic updates by restoring previous state
- Server mutations are declared on the router using `routeFactory().withProcedures()`
- Clients receive router types (not code) and use them for type inference

---

## Optimistic Mutations API

This API design uses a builder pattern that provides storage operations scoped under a handler function. Operations are registered in a registry rather than being returned.

### API Design

```typescript
// client.ts - Client-side only
import type { Router } from "./server/router"; // Only importing types
import { createClient } from "@live-state/sync/client";
import { defineOptimisticMutations } from "@live-state/sync/client/optimistic";
import { schema } from "./schema";

// Declare optimistic mutations using builder
const optimisticMutations = defineOptimisticMutations<Router>({
  routes: {
    posts: {
      incrementLikes: ({ input, storage }) => {
        // Query current state using storage API
        const currentPost = storage.posts.one(input.postId).get();
        
        // Register update operation (no return - operations are registered in handler's registry)
        storage.posts.update(input.postId, {
          likes: currentPost.likes + 1,
        });
      },
      createPost: ({ input, storage }) => {
        const tempId = generateId();
        
        // Register insert operation
        storage.posts.insert({
          id: tempId,
          title: input.title,
          content: input.content,
          likes: 0,
        });
      },
      transferOwnership: ({ input, storage }) => {
        const currentPost = storage.posts.one(input.postId).get();
        const currentOwner = storage.users.one(currentPost.ownerId).get();
        const newOwner = storage.users.one(input.newOwnerId).get();
        
        // Register multiple update operations
        storage.posts.update(input.postId, {
          ownerId: input.newOwnerId,
        });
        storage.users.update(input.newOwnerId, {
          postCount: newOwner.postCount + 1,
        });
        storage.users.update(currentPost.ownerId, {
          postCount: currentOwner.postCount - 1,
        });
      },
      deletePost: ({ input, storage }) => {
        // Register delete operation
        storage.posts.delete(input.postId);
      },
      findPosts: ({ input, storage }) => {
        // Query operations use the same storage API
        const posts = storage.posts
          .where({ authorId: input.authorId })
          .limit(input.limit)
          .get();
        
        // Register updates based on query results
        posts.forEach((post) => {
          storage.posts.update(post.id, {
            views: post.views + 1,
          });
        });
      },
    },
  },
});

// Create client with optimistic mutations
const { store } = createClient<Router>({
  url: "ws://localhost:5001/ws",
  schema,
  optimisticMutations,
});

// Usage - mutations automatically apply optimistic updates
await store.mutate.posts.incrementLikes({ postId: "post-123" });
```

### Implementation Notes

- `defineOptimisticMutations<TRouter>()` creates a registry of operations that are executed when the mutation is applied.
- `storage` provides typed access to collections (e.g., `storage.posts`, `storage.users`)
- Query operations use the same API: `storage.posts.where({...}).get()`
- Mutation operations register themselves in the handler's internal stack of operations that are executed when the mutation is applied. No return needed.
- Operations are automatically reversible based on type
- All operations are type-safe and inferred from router types
- Query operations resolve state at mutation execution time

### Pros

- Clean builder API with storage operations scoped under handler
- Type-safe operations with full inference from router types
- No circular dependencies (handler resolves at execution time)
- Consistent API: queries and mutations use the same `storage.[collection]` pattern
- Clear, readable syntax that mirrors server-side storage API
- Operations registered in registry rather than returned, making the intent clear

### Cons

- Requires new builder API
- The registry needs to track operations for reversibility

# Lifecycle Hooks (Server)

Collection routes are deprecated; lifecycle hooks are **no longer declared on routes**. They are registered in a **central hook registry** keyed by **schema entity names** (the same keys used for `db.posts`, optimistic mutations, and router route names where applicable). This keeps one mental model: “hooks for `posts`,” not “hooks on the `posts` route object.”

## Requirements

1. **Optional**: If `hooks` is omitted from `server()`, no lifecycle behavior runs beyond what procedures implement themselves.
2. **Schema-keyed**: Hooks are grouped by entity (`posts`, `users`, …) and typed from `typeof schema`, not from `Route` instances.
3. **Composable across files**: Small `defineHooks` slices can live in separate modules and be merged at server startup.
4. **Type-safe**: `TSchema` and `TContext` flow through `defineHooks` so `value` / `record` / `patch` match the entity and `ctx` matches the app context.
5. **DX**: Single object-literal style per slice; mirrors `defineOptimisticMutations` and `db.[entity]` naming.

## Current Behavior (V2) vs V3

- **V2**: Hooks lived on collection routes: `routeFactory().collectionRoute(schema.posts).withHooks({ beforeInsert: ... })`.
- **V3**: Hooks are declared with `defineHooks` and passed to `server({ hooks })`. Routes only define procedures; lifecycle is orthogonal.

---

## Lifecycle Hooks API

Hooks are declared with `defineHooks` and passed to `server({ hooks })`. When you have **multiple** hook slices (e.g. split across files), combine them with `mergeHooks` — that helper is **completely optional**; if everything lives in one `defineHooks` object, pass it straight to `hooks` with no merge. Multiple slices for the same entity merge at the **hook name** level when you do use `mergeHooks` (see Implementation Notes).

### API Design

```typescript
// hooks/posts.insert.ts — one concern per file
import { defineHooks } from '@live-state/sync/server';
import type { AppContext } from '../context';
import { schema } from '../schema';

export const postsInsertHooks = defineHooks<typeof schema, AppContext>({
	posts: {
		beforeInsert: async ({ ctx, value, db }) => {
			// `value` is typed from schema.posts insert shape
			if (ctx?.role !== 'admin') throw new Error('Unauthorized');
		},
		afterInsert: async ({ ctx, record, db }) => {
			// `record` is typed as the inserted row
		},
	},
});
```

```typescript
// hooks/users.ts
import { defineHooks } from '@live-state/sync/server';
import type { AppContext } from '../context';
import { schema } from '../schema';

export const usersHooks = defineHooks<typeof schema, AppContext>({
	users: {
		beforeUpdate: async ({ ctx, id, patch, db }) => {
			// ...
		},
	},
});
```

```typescript
// server.ts — single hooks definition (no merge needed)
import { defineHooks } from '@live-state/sync/server';
import type { AppContext } from './context';
import { schema } from './schema';

const hooks = defineHooks<typeof schema, AppContext>({
	posts: {
		beforeInsert: async ({ ctx, value, db }) => {
			/* ... */
		},
	},
	users: {
		beforeUpdate: async ({ ctx, id, patch, db }) => {
			/* ... */
		},
	},
});

const app = server({
	router,
	storage,
	schema,
	contextProvider,
	hooks, // omit entirely if you do not need lifecycle hooks
});
```

```typescript
// server.ts — multiple slices from separate modules: use mergeHooks
import { mergeHooks } from '@live-state/sync/server';
import { postsInsertHooks } from './hooks/posts.insert';
import { usersHooks } from './hooks/users';

const hooks = mergeHooks(postsInsertHooks, usersHooks);

const app = server({
	router,
	storage,
	schema,
	contextProvider,
	hooks,
});
```

### Implementation Notes

- `defineHooks<TSchema, TContext>(definition)` validates that top-level keys are entities on `TSchema` and narrows handler payloads per entity.
- **`mergeHooks` is optional.** Use it only when combining two or more hook objects (e.g. from different files). A single `defineHooks(...)` result can be assigned directly to `server({ hooks })` without calling `mergeHooks`.
- `mergeHooks(a, b, ...)` combines multiple definitions. **Merge semantics** for the same entity and same hook name (e.g. two `beforeInsert` for `posts`) must be documented and implemented consistently — e.g. **order preserved by argument order** (first wins, last wins, or **sequential chain**); the recommended default is **sequential execution in merge order** so multiple files can each append behavior safely.
- Hook names align with storage lifecycle events (exact set TBD by implementation): e.g. `beforeInsert`, `afterInsert`, `beforeUpdate`, `afterUpdate`, `beforeDelete`, `afterDelete`. Handlers receive `{ ctx, db, ... }` consistent with V2 collection hooks where applicable.
- Lifecycle runs when the sync engine / storage performs the corresponding mutation (including paths invoked from procedure handlers such as `db.posts.insert(...)`), unless explicitly scoped otherwise in implementation.
- `ctx` follows the same `TContext` as `contextProvider` / procedures; optional context remains optional in handlers if the server allows missing context.

### Pros

- Clear separation from routes: procedures stay thin; cross-cutting rules live in one registry.
- Easy to split large codebases: one file per entity or per concern, merged at the server.
- Same entity naming as schema and client-side patterns — easy for humans and agents to discover and extend.
- Optional: no hooks object means zero lifecycle overhead at the API level.

### Cons

- When using `mergeHooks`, teams need clear rules and ordering documentation when multiple slices target the same hook.
- Duplicated entity keys across `defineHooks` slices are merged — teams should agree on file boundaries (by entity vs by concern) to avoid surprises.

# Typed Context

Context is now fully typed throughout the system. Instead of `Record<string, any>`, you can define an application-specific context type that flows from the `RouteFactory` through to procedure handlers (where authorization now lives) and lifecycle hooks (`defineHooks`). Deprecated collection routes also receive it in their `read`/`insert` access rules.

## Defining Typed Context

Pass a `TContext` type parameter to `routeFactory` to type context across all routes created by that factory:

```typescript
type AppContext = { user: string; role: "admin" | "user" };

// Context type flows to all routes created by this factory
const protectedRoute = routeFactory<typeof schema, AppContext>();

// ctx is now typed as AppContext
posts: protectedRoute.collectionRoute(schema.posts, {
  read: ({ ctx }) => ({ authorId: ctx.user }),  // ✅ ctx.user is string
  insert: ({ ctx }) => ctx.role === "admin",     // ✅ ctx.role is "admin" | "user"
});
```

## Context in Procedures

Procedure handlers receive the typed context through `req.context`:

```typescript
protectedRoute.withProcedures(({ query, mutation }) => ({
  find: query(z.object({ limit: z.number() })).handler(({ req, db }) => {
    const userId = req.context.user;  // ✅ typed as string
    return db.posts.where({ authorId: userId }).limit(req.input.limit);
  }),
}));
```

## Context in Lifecycle Hooks

Lifecycle hook handlers receive the typed context through `ctx` (see **Lifecycle Hooks (Server)**). They are declared with `defineHooks<typeof schema, AppContext>`, not on routes:

```typescript
defineHooks<typeof schema, AppContext>({
  posts: {
    beforeInsert: ({ ctx, value, db }) => {
      // ctx is typed as AppContext | undefined (or narrowed if server guarantees context)
      if (ctx?.role !== "admin") throw new Error("Unauthorized");
    },
  },
});
```

Legacy `collectionRoute(...).withHooks(...)` remains for deprecated collection routes only; new code should use the central registry and `server({ hooks })`.

## Context Provider

The `Server` infers `TContext` from the `contextProvider` return type:

Headers are client-controlled and, under strict Node typings, may be `string | string[] | undefined`. Normalize and validate them before trusting them as auth context (in practice you'd verify a signed token rather than a raw id):

```typescript
const first = (h: string | string[] | undefined) =>
  Array.isArray(h) ? h[0] : h;

const app = server({
  router: appRouter,
  storage,
  schema,
  // TContext is inferred from the validated result: { user: string; role: "admin" | "user" }
  contextProvider: (req) => {
    const user = first(req.headers["x-user-id"]);
    const role = first(req.headers["x-role"]);
    if (!user) throw new Error("Unauthorized");
    if (role !== "admin" && role !== "user") throw new Error("Invalid role");
    return { user, role };
  },
});
```

## Typed Middleware with `createMiddleware`

Raw middleware (`({ req, next }) => ...`) preserves the existing context type. To **transform** the context type (e.g., narrowing optional fields after authentication), use `createMiddleware`:

```typescript
import { createMiddleware, routeFactory } from "@live-state/sync/server";

// Narrows { user?: string } to { user: string }
const authMiddleware = createMiddleware<{ user?: string }, { user: string }>(
  ({ ctx, next }) => {
    if (!ctx.user) throw new Error("Unauthorized");
    return next({ user: ctx.user });  // passes narrowed context to next
  },
);

// Factory starts with optional user
const publicRoute = routeFactory<typeof schema, { user?: string }>();

// After .use(authMiddleware), context is narrowed to { user: string }
const protectedRoute = publicRoute.use(authMiddleware);

// ctx.user is guaranteed to be string — no optional chaining needed
protectedRoute.collectionRoute(schema.posts, {
  read: ({ ctx }) => ({ authorId: ctx.user }),  // ✅ string, not string | undefined
});
```

### Chaining Typed Middleware

Multiple typed middlewares can be chained to accumulate context transformations:

```typescript
const withAuth = createMiddleware<Record<string, any>, { user: string }>(
  ({ next }) => next({ user: "resolved-user" }),
);

const withOrg = createMiddleware<{ user: string }, { user: string; org: string }>(
  ({ ctx, next }) => next({ ...ctx, org: "resolved-org" }),
);

// Context type is { user: string; org: string }
const orgRoute = routeFactory<typeof schema>()
  .use(withAuth)
  .use(withOrg);
```

## Backward Compatibility

All `TContext` parameters default to `Record<string, any>`, so existing code continues to work unchanged:

```typescript
// These are equivalent — both use Record<string, any> for context
const route = routeFactory<typeof schema>();
const route = routeFactory<typeof schema, Record<string, any>>();
```

