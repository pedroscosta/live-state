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
  issues: fromShape(issueShape).withMutations({
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
```

## TODO

- Merge mutations from the client properly
- Add mutations
- Add filters
