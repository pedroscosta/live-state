import { useEffect, useSyncExternalStore } from "react";
import { Client } from ".";
import { AnyRouter } from "../server";
import { hash } from "../utils";
import { QueryBuilder } from "./query";

class Store {
  private subscriptions: Map<
    string,
    {
      subscribe: (cb: () => void) => () => void;
      callbacks: Set<() => void>;
    }
  > = new Map();

  getOrStoreSubscription(
    builder: QueryBuilder<any>
  ): (cb: () => void) => () => void {
    const key = hash(builder);

    if (this.subscriptions.has(key))
      return this.subscriptions.get(key)!.subscribe;

    this.subscriptions.set(key, {
      subscribe: (cb: () => void) => {
        this.subscriptions.get(key)?.callbacks.add(cb);

        const unsub = builder.subscribe(() => {
          this.subscriptions.get(key)?.callbacks.forEach((cb) => cb());
        });

        return () => {
          const refCount = this.subscriptions.get(key)?.callbacks.size;

          this.subscriptions.get(key)?.callbacks.delete(cb);

          unsub();

          if (refCount === 1) {
            this.subscriptions.delete(key);
          }
        };
      },
      callbacks: new Set(),
    });

    return this.subscriptions.get(key)!.subscribe;
  }
}

const store = new Store();

export const useLiveQuery = <
  T extends { get: () => U; subscribe: (cb: (v: U) => void) => () => void },
  U,
>(
  observable: T
) => {
  return useSyncExternalStore(
    store.getOrStoreSubscription(
      observable as unknown as QueryBuilder<any, any>
    ),
    observable.get
  ) as ReturnType<T["get"]>;
};

export const SubscriptionProvider = ({
  children,
  client,
}: {
  children: React.ReactNode;
  client: Client<AnyRouter>["client"];
}) => {
  useEffect(() => {
    client.subscribe();
  }, []);

  return <>{children}</>;
};
