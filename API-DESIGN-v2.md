This documents is comprised of notes regarding the API design of the project.

# Shared

## Schema

- `Entity` is the name given to an object/document that is stored in the database.

  It's a collection of `Field`s and `Relation`s to other entities.

- `Field` is the name given to a property of an entity.

- `Relation` is the name given to a reference to another entity.

- `Schema` is the name given to a collection of entities.

> The schema should be shared between the client and the server, because both of them need to decode, validate and apply mutations.

**Examples**

This is an example of a simple `Schema` declaration with one `Entity`:

```typescript
export const issues = object({
  name: string(),
  description: string().optional(),
  done: boolean({ defaultValue: false }),
});

export const schema = {
  issues
};
```

This is an example of a more complex `Schema` declaration:

```typescript
export const user = entity({
  name: string(),
  email: string(),
  password: string().hidden(), // This is a sensitive field, so it should be hidden from queries
  role: string(),
  issues: hasMany(issues),
});

export const issues = object({
  name: string(),
  description: string().optional(),
  done: boolean({ defaultValue: false }),
});

export const issueRelations = relations(issues, ({one, many}) {
  creator: one(user)
});

export const schema = createSchema({
  entities: [
    user,
    issues
  ],
  relations: [
    issueRelations
  ]
});
```

# Server

The server is a `Router` and with one (or more) `Adapter`s and a `Storage`.

## Middlewares

A `Middleware` is a function that wraps a `Route` handler.

**Examples**

This is an example of a `Middleware` declaration that authenticates the user and provides the user context:

```typescript
export const authMiddleware: Middleware = (opts) => {
  const token = opts.req.token;

  if (!token) {
    throw new Error("Not authenticated");
  }

  const user = await getUser(token);

  if (!user) {
    throw new Error("Not authenticated");
  }

  return {
    ...opts,
    ctx: {
      ...opts.ctx,
      user
    },
  };
};
```

## Route Factories

A `RouteFactory` is a function that returns a `Route`.

**Examples**

This is an example of a `RouteFactory` declaration:

```typescript
export const routeFactory = createDefaultRouteFactory(schema);
```

This is an example of a `RouteFactory` declaration that extends the default route factory with a middleware:

```typescript
export const protectedRoute = routeFactory.use(middleware);
```

## Router
A `Router` is the collection of `Routes`.

`Routes` are the collection of `Mutations` and `Queries` that can be applied to the `Entity`. Every `Entity` must have a `Route`.

**Examples**

This is an example of a `Router` declaration that default routes for all entities:

```typescript
export const lsServer = server({
  // ...
  router: router(schema),
});
```

This is an example of a `Router` declaration that extends the default router:

```typescript
export const lsServer = server({
  // ...
  router: router(schema, {
    issues: protectedRoute(issues),
  }),
});
```

This is an example of a `Router` declaration that extends the default router by replacing a default mutation handler:

```typescript
export const lsServer = server({
  // ...
  router: router(schema, {
    issues: protectedRoute(issues).handlers({
      update: (opts) => {
        const user = opts.ctx.user;
        const input = opts.input;

        const previousState = opts.db.get(input.id);

        if (user.role !== 'admin' && previousState.owner !== user.id) {
          throw new Error('Not authorized');
        }

        return opts.db.update(input.id, input);
      },
    }),
  }),
});
```

# Client

A `Client` is a proxy based store that provides a reactive interface to the `Router`. 

## Client declaration

**Examples**
```typescript
export const { client, store } = createClient({
  url: "ws://localhost:5001/ws",
  schema,
});
```
## Querying

The `useLiveQuery` hook is used to query the store. If the local store has the entity, it will return it immediately. Otherwise, it will wait for the entity to be fetched from the server.

Even if the local store has the entity, it will fetch the server to get updated data.

The `useLiveQuery` hook also subscribes the client to updates of that entity by default.

**Examples**

This is an example of getting many entities from the store:

```typescript
// React
const issues = useLiveQuery(store.issues);
```

This is an example of getting a specific entity from the store:

```typescript
// React
const issue = useLiveQuery(store.issues['1']);
```

This is an example of getting many entities from the store with filters, the filters (selector) are only client-side:

```typescript
// React
const doneIssues = useLiveQuery(store.issues, {
  selector: (issues) => Object.fromEntries(Object.entries(issues).filter(([id, issue]) => issue.done === true)),
});
```
..
This is an example of getting a value but not subscribing to updates:

```typescript
// React
const issue = useLiveQuery(store.issues['1'], {
  subscribe: false,
});
```

This is an example of manually subscribing to updates:

```typescript
// React
const issue = useSubscription(store.issues['1']);
```

This is an example of getting a store value with initial data, this allows SSR:

```typescript
// React
const doneIssues = useLiveQuery(store.issues, {
  initialData
});
```

## Mutating

The `useMutation` hook is used to mutate the store. It will send a mutation to the server and store the mutation in the client's mutation stack.

**Examples**

This is an example of creating a new issue:

```typescript
// React
const createIssue = useMutation(store.issues.insert);

// Use the mutation
createIssue({
  name: 'New issue',
  description: 'New issue description',
  done: false,
  owner: '1',
});
```

This is an example of updating an existing issue:

```typescript
// React
const updateIssue = useMutation(store.issues.update);

// Use the mutation
updateIssue({
  id: '1',
  done: true,
});
```

This is an example of deleting an existing issue:

```typescript
// React
const deleteIssue = useMutation(store.issues.delete);

// Use the mutation
deleteIssue({
  id: '1',
});
```




















