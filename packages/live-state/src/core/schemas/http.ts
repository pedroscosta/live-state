import { z } from "zod";
import {
  genericMutationSchema,
  querySchema,
  syncDeltaSchema,
} from "./core-protocol";

export const httpQuerySchema = querySchema.omit({
  resource: true,
});

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

export const httpDefaultMutationSchema = syncDeltaSchema
  .omit({
    id: true,
    type: true,
    resource: true,
    op: true,
  })
  .extend({
    // resourceId may be supplied via the URL path / payload id instead of the body.
    resourceId: z.string().optional(),
  });

export const httpMutationSchema = z.union([
  httpDefaultMutationSchema,
  httpGenericMutationSchema,
]);

export type HttpMutation = z.infer<typeof httpMutationSchema>;
