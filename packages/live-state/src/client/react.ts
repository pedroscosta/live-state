import React from "react";
import { LiveStore, StoreState } from ".";
import { AnyRoute } from "../server";

export const identity = <T>(arg: T): T => arg;

export function useStore<TStore extends LiveStore<AnyRoute>>(
  store: TStore
): StoreState<TStore>;

export function useStore<TStore extends LiveStore<AnyRoute>, StateSlice>(
  store: TStore,
  selector: (state: StoreState<TStore>) => StateSlice
): StateSlice;

export function useStore<TStore extends LiveStore<AnyRoute>, StateSlice>(
  store: TStore,
  selector: (state: StoreState<TStore>) => StateSlice = identity as any
) {
  const slice = React.useSyncExternalStore(store.subscribe.bind(store), () =>
    selector(store.get())
  );
  React.useDebugValue(slice);
  return slice;
}
