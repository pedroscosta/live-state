```typescript
// schema.ts

// id is a special field that is automatically generated and cannot be overridden
const issues = object({
  name: string(),
  description: string(),
  done: boolean(),
  owner: string(),
});

const publicRoute = object({
  bears: number(),
  honeyPots: number().optional(),
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
    // Using an pure schema creates a route without any validations
    publicRoute,
    // This is how you can create a route with validations
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

client.publicRoute.set(id, {
  bears: 10, // This is valid because honeyPots is optional
}); 
```
