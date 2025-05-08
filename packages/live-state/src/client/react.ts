import { useEffect, useState } from "react";
import { Observable } from "./observable";

// export const useLiveQuery = <T extends Observable<U>, U>(
//   observable: T,
//   opts?: {
//     subscribeToRemote?: boolean;
//   }
// ): ReturnType<T["get"]> => {
//   useEffect(() => {
//     if (opts?.subscribeToRemote) {
//       return observable.subscribeToRemote();
//     }
//   }, [opts?.subscribeToRemote]);

//   const slice = useSyncExternalStore(observable.subscribe, () =>
//     observable.get()
//   );

//   return slice as ReturnType<T["get"]>;
// };
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
