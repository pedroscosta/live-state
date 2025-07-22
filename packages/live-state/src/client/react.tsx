import { useEffect, useState } from "react";
import { Client, ObservableClientState } from ".";
import { AnyRouter } from "../server";
import { Simplify } from "../utils";

export const useLiveQuery = <T extends ObservableClientState<U>, U>(
  observable: T,
  opts?: {
    subscribeToRemote?: boolean;
  }
): Simplify<ReturnType<T["get"]>> => {
  const [slice, setSlice] = useState(() => observable.get());

  useEffect(() => {
    if (opts?.subscribeToRemote) {
      // TODO: Is this still needed?
      return observable.subscribeToRemote();
    }
  }, [opts?.subscribeToRemote]);

  useEffect(
    () =>
      observable.subscribe(() => {
        const newSlice = observable.get();
        setSlice(newSlice);
      }),
    []
  );

  return slice as Simplify<ReturnType<T["get"]>>;
};

export const SubscriptionProvider = ({
  children,
  client,
}: {
  children: React.ReactNode;
  client: Client<AnyRouter>["client"];
}) => {
  useEffect(() => {
    client.subscribeToRemote();
  }, []);

  return <>{children}</>;
};
