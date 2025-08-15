import { useEffect, useState } from "react";
import { Client } from ".";
import { AnyRouter } from "../server";
import { Simplify } from "../utils";
import { DeepSubscribable } from "./types";

export const useLiveQuery = <T extends DeepSubscribable<U>, U>(
  observable: T
): Simplify<ReturnType<T["get"]>> => {
  const [slice, setSlice] = useState(() => observable.get());

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
    client.subscribe();
  }, []);

  return <>{children}</>;
};
