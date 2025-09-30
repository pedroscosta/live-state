import { z } from "zod";
import {
  defaultMutationSchema,
  genericMutationSchema,
  querySchema,
} from "./core-protocol";

export const httpQuerySchema = querySchema.omit({
  resource: true,
});

export const httpGenericMutationSchema = genericMutationSchema.omit({
  id: true,
  type: true,
  resource: true,
  procedure: true,
});

export const httpDefaultMutationSchema = defaultMutationSchema.omit({
  id: true,
  type: true,
  resource: true,
  procedure: true,
});

export const httpMutationSchema = z.union([
  httpDefaultMutationSchema,
  httpGenericMutationSchema,
]);

export type HttpMutation = z.infer<typeof httpMutationSchema>;
