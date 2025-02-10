```typescript
const counterShape = number();
const issueShape = array({
  object({
    name: string(),
    description: string(),
    id: number(),
  }),
});

const router = createRouter({
  counter: fromShape(counterShape).withMutations({
    set: update()
  }),
  issues: table('issues') // Table is a utility function that creates a shape for a database table
    .withShape(issueShape)
    .withMutations({
      add: insert(),
      update: update(),
      remove: remove(),
      markAsDone: mutation()
        .input(z.object({id: z.nanoId()}))
        .set(({ shape }) => {
          return {
            ...shape,
            done: true,
          };
        })
        .where(({ input }) => eq(issueShape.id, input.id)),
    }),
});

// Server with no database
const server = createWSServer(router, {
  database: new MemoryDatabase(),
});

// Server with a drizzle database
const server = createWSServer(router, {
  database: drizzleAdapter({
    url: "https://...",
  }),
});
```

## TODO

- Merge mutations from the client properly
- Add mutations
- Add filters
