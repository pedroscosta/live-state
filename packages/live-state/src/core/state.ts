import {
  InferIndex,
  LiveObject,
  MaterializedLiveType,
  MutationType,
} from "../schema";
import { MutationMessage } from "./internals";

export function mergeMutation<TSchema extends LiveObject<any>>(
  schema: TSchema,
  prevState: Record<InferIndex<TSchema>, MaterializedLiveType<TSchema>>,
  mutationMsg: MutationMessage
): Record<InferIndex<TSchema>, MaterializedLiveType<TSchema>> {
  const { mutationType, payload, where } = mutationMsg;

  if (mutationType === "insert") {
    const newRecord = schema.decode(
      mutationType as MutationType,
      payload
    ) as MaterializedLiveType<TSchema>;

    return {
      ...prevState,
      [(newRecord.value as any).id.value]: newRecord,
    };
  } else if (mutationType === "update") {
    if (!where) return prevState;

    const updatedRecords: Record<
      InferIndex<TSchema>,
      MaterializedLiveType<TSchema>
    > = {};

    for (const id of where) {
      const record = prevState?.[id];

      if (!record) continue;

      const updatedRecord = schema.decode(
        mutationType as MutationType,
        payload,
        record
      ) as MaterializedLiveType<TSchema>;

      updatedRecords[(updatedRecord.value as any).id.value] = updatedRecord;
    }

    return {
      ...prevState,
      ...updatedRecords,
    };
  }

  return prevState;
}

export function mergeMutationReducer<TSchema extends LiveObject<any>>(
  schema: TSchema
) {
  return (
    prevState: Record<InferIndex<TSchema>, MaterializedLiveType<TSchema>>,
    mutationMsg: MutationMessage
  ) => mergeMutation(schema, prevState, mutationMsg);
}
