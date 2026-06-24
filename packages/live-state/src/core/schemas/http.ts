import { z } from "zod";
import { genericMutationSchema } from "./core-protocol";

export const httpGenericMutationSchema = genericMutationSchema
  .omit({
    id: true,
    type: true,
    resource: true,
    procedure: true,
  })
  .extend({
    meta: genericMutationSchema.shape.meta,
  });

export const httpMutationSchema = httpGenericMutationSchema;

export type HttpMutation = z.infer<typeof httpMutationSchema>;
