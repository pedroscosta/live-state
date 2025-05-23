import { useEffect, useState } from "react";
import { Client } from ".";
import { AnyRouter } from "../server";
import { Observable } from "./observable";

export const useLiveQuery = <T extends Observable<U>, U>(
  observable: T,
  opts?: {
    subscribeToRemote?: boolean;
  }
): ReturnType<T["get"]> => {
  const [slice, setSlice] = useState(() => observable.get());

  useEffect(() => {
    if (opts?.subscribeToRemote) {
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

  return slice as ReturnType<T["get"]>;
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
