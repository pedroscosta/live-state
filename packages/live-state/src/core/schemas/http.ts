import { querySchema } from "./core-protocol";

export const httpQuerySchema = querySchema.omit({
  type: true,
  resource: true,
});
