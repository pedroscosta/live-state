import React, { useDebugValue, useEffect, useSyncExternalStore } from "react";
import { Client, ClientState } from ".";
import { AnyRouter } from "../server";
import { Simplify } from "../utils";

const identity = <T>(arg: T): T => arg;

function useLiveData<TClient extends Client<AnyRouter>>(
  store: TClient
): Simplify<ClientState<TClient["_router"]>>;

function useLiveData<TClient extends Client<AnyRouter>, StateSlice>(
  store: TClient,
  selector: (state: ClientState<TClient["_router"]>) => StateSlice
): Simplify<StateSlice>;

function useLiveData<TClient extends Client<AnyRouter>, StateSlice>(
  store: TClient,
  selector: (
    state: ClientState<TClient["_router"]>
  ) => StateSlice = identity as any
) {
  const slice = React.useSyncExternalStore(store.subscribeToState, () =>
    selector(store.get() as ClientState<TClient["_router"]>)
  );
  React.useDebugValue(slice);
  return slice;
}

function createUseLiveData<TClient extends Client<AnyRouter>>(
  store: TClient
): <StateSlice = ClientState<TClient["_router"]>>(
  selector?: (state: ClientState<TClient["_router"]>) => StateSlice
) => Simplify<StateSlice> {
  return function useData<StateSlice = ClientState<TClient["_router"]>>(
    selector?: (state: ClientState<TClient["_router"]>) => StateSlice
  ) {
    const getSnapshot = React.useCallback(
      () =>
        selector
          ? selector(store.get() as ClientState<TClient["_router"]>)
          : store.get(),
      [selector]
    );

    const slice = useSyncExternalStore(
      store.subscribeToState.bind(store),
      getSnapshot
    );

    useDebugValue(slice);
    return slice as Simplify<StateSlice>;
  };
}

function createUseSubscribe<TClient extends Client<AnyRouter>>(
  client: TClient
) {
  return function useSubscribe(route: keyof TClient["_router"]["routes"]) {
    useEffect(() => {
      const unsubscribe = client.subscribeToRoute(route as string);

      return () => {
        unsubscribe();
      };
    }, [route]);
  };
}

export function reactiveClient<
  TRouter extends AnyRouter,
  TClient extends Client<TRouter>,
>(client: TClient) {
  return {
    useLiveData: createUseLiveData(client),
    useSubscribe: createUseSubscribe(client),
  };
}
