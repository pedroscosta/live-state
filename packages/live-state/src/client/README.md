```typescript

  const client = createClient({
    url: "ws://localhost:5001/ws",
  });

  const counterStore = client.counter.createStore();

  // Simple setter
  counterStore.set(10);

  // Simple getter
  console.log(counterStore.get());

  // Simple subscriber
  counterStore.subscribe((value) => {
    console.log("Counter value changed to", value);
  });

  // Setter with callback
  counterStore.set((currentValue) => {
    return currentValue + 1;
  });

  const issueStore = client.issues.createStore();

  // Insert a new issue
  issueStore.add({
    name: "My issue",
    description: "This is my issue",
    id: nanoid(),
  });

  // Update an issue
  issueStore.update({
    id: issue_id,
    name: "My issue",
    description: "This is my issue",
  })

  // Remove an issue
  issueStore.remove({
    id: nanoid(),
  });

  // Mark an issue as done
  issueStore.markAsDone({
    id: nanoid(),
  });
```

## TODO

- Add mutations
- Merge mutations from the server properly
- Add filters