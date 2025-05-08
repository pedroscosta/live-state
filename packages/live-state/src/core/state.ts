import {
  InferIndex,
  LiveObjectAny,
  MaterializedLiveObject,
  MutationType,
} from "../schema";
import { MutationMessage } from "./internals";

export function mergeMutation<TSchema extends LiveObjectAny>(
  schema: TSchema,
  prevState: Record<InferIndex<TSchema>, MaterializedLiveObject<TSchema>>,
  mutationMsg: MutationMessage
): Record<InferIndex<TSchema>, MaterializedLiveObject<TSchema>> {
  const { mutationType, payload, resourceId } = mutationMsg;

  if (mutationType === "insert") {
    const newRecord = schema.mergeMutation(
      mutationType as MutationType,
      payload
    )[0] as MaterializedLiveObject<TSchema>;

    return {
      ...prevState,
      [(newRecord.value as any).id.value]: newRecord,
    };
  } else if (mutationType === "update") {
    if (!resourceId) return prevState;

    const updatedRecords: Record<
      InferIndex<TSchema>,
      MaterializedLiveObject<TSchema>
    > = {};

    const record = prevState?.[resourceId];

    if (!record) return prevState;

    const updatedRecord = schema.mergeMutation(
      mutationType as MutationType,
      payload,
      record
    )[0] as MaterializedLiveObject<TSchema>;

    updatedRecords[(updatedRecord.value as any).id.value] = updatedRecord;

    return {
      ...prevState,
      ...updatedRecords,
    };
  }

  return prevState;
}

export function mergeMutationReducer<TSchema extends LiveObjectAny>(
  schema: TSchema
) {
  return (
    prevState: Record<InferIndex<TSchema>, MaterializedLiveObject<TSchema>>,
    mutationMsg: MutationMessage
  ) => mergeMutation(schema, prevState, mutationMsg);
}
