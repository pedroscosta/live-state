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
```