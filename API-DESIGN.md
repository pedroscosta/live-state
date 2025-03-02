```typescript
// schema.ts

const issues = table({
  name: string(),
  description: string(),
  id: number(),
  done: boolean(),
  owner: string(),
});

const issues = table({
  name: string(),
  description: string(),
  id: number(),
  done: boolean(),
  owner: string(),
});

// server.ts

const authMiddleware = middleware(async (opts) => {
  const user = await getCurrentUser();

  if (!user) {
    throw new Error("Not authenticated");
  }

  return ({
    ...opts,
    ctx: {
      ...opts.ctx,
      user
    }
  });
})

const protectedRoute = routeFactory({
  middlewares: [authMiddleware],
});

const router = router({
  routes: {
    // Using an pure table schema creates a route without any validations
    issues: protectedRoute(issues),
  },
  database: new MemoryDatabase(),
});

export type Router = typeof router;

// client.ts

const client = createClient<Router>({
  url: "ws://localhost:5001/ws",
  schema,
});
```
