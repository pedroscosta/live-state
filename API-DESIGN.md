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

const useLiveState = createStore(client);

const Component = () => {
  //// V1

  // Returns all the issues in the client store
  const { data, isFetchingRemote, isLoading, error } = useLiveState("issues");

  // Returns issues with filtering, sorting and pagination
  const { data, isFetchingRemote, isLoading, error } = useLiveState("issues", {
    where: {
      owner: "1",
    },
    orderBy: {
      name: "asc",
    },
    limit: 10,
    offset: 0
  });

  // Returns a specific issue
  const { data, isFetchingRemote, isLoading, error } = useLiveState("issues", {
    where: {
      id: "1",
    },
  });

  // Returns a specific issue with specific fields
  const { data, isFetchingRemote, isLoading, error } = useLiveState("issues", {
    where: {
      id: "1",
    },
    include: {
      name: true,
      done: true,
    },
  });

  //// V1

  // Creates the hooks
  const { useLive, useSubscription } = reactiveClient(client);

  // Gets all the issues
  const data = useLive((s) => s.issues)

  // Filters the issues
  const filteredData = useLive((s) => Object.values(s.issues).filter((i) => i.done === true));

  // Returns a specific issue
  const issue = useLive((s) => s.issues['1']);

  // Returns a specific issue with specific fields
  const issue = useLive((s) => {
    const issue = s.issues['1'];
    return {
      name: issue.name,
      done: issue.done
    };
  });

  // Subscriptions are explicit

  // Subscribe to all the issues
  useSubscription("issues");

  // Subscribe to issues with filtering
  useSubscription("issues", {
    where: {
      owner: "1",
    },
  });

  // Subscribe to a specific issue
  useSubscription("issues", {
    where: {
      id: "1",
    },
  });

  // Subscribe to a specific issue with specific fields
  useSubscription("issues", {
    where: {
      id: "1",
    },
    include: {
      name: true,
      done: true,
    },
  });
};
```
