import cookie from "cookie";
import qs from "qs";
import { AnyRouter, Server } from "..";
import { DefaultMutation } from "../../core/schemas/core-protocol";
import {
  httpDefaultMutationSchema,
  httpGenericMutationSchema,
  HttpMutation,
  httpQuerySchema,
} from "../../core/schemas/http";

export const httpTransportLayer = (
  server: Server<AnyRouter>
): ((request: Request) => Promise<Response>) => {
  return async (request: Request) => {
    const headers =
      typeof (request.headers as any).getSetCookie === "function"
        ? Object.fromEntries(request.headers)
        : (request.headers as unknown as Record<string, string>);

    const requestContext: {
      headers: Record<string, any>;
      cookies: Record<string, any>;
    } = {
      headers,
      cookies: headers.cookie ? cookie.parse(headers.cookie) : {},
    };

    const url = new URL(request.url);
    const segments = url.pathname.split("/");

    if (request.method === "GET") {
      const resource = segments[segments.length - 1];

      const searchParams = url.searchParams;

      const rawParsedQs = qs.parse(searchParams.toString());

      const {
        success,
        data: parsedQs,
        error,
      } = httpQuerySchema.safeParse(rawParsedQs);

      if (!success) {
        return Response.json(
          { message: "Invalid query", code: "INVALID_QUERY", details: error },
          { status: 400 }
        );
      }

      const result = await server.handleRequest({
        req: {
          ...requestContext,
          type: "QUERY",
          resourceName: resource,
          context: {}, // TODO provide context
          where: parsedQs.where,
          // include: parsedQs.include, // TODO support include
        },
      });

      if (!result || !result.data) {
        throw new Error("Invalid resource");
      }

      return Response.json(result.data);
    }

    if (request.method === "POST") {
      try {
        const procedure = segments[segments.length - 1];
        const resource = segments[segments.length - 2];

        const rawBody = request.body ? await request.json() : {};

        let body: HttpMutation;

        if (procedure === "set") {
          const { success, data, error } =
            httpDefaultMutationSchema.safeParse(rawBody);
          if (!success) {
            return Response.json(
              {
                message: "Invalid mutation",
                code: "INVALID_REQUEST",
                details: error,
              },
              { status: 400 }
            );
          }
          body = data;
        } else {
          const { success, data, error } =
            httpGenericMutationSchema.safeParse(rawBody);
          if (!success) {
            return Response.json(
              {
                message: "Invalid mutation",
                code: "INVALID_REQUEST",
                details: error,
              },
              { status: 400 }
            );
          }
          body = data;
        }

        const result = await server.handleRequest({
          req: {
            ...requestContext,
            type: "MUTATE",
            resourceName: resource,
            input: body.payload,
            context: {}, // TODO provide context
            resourceId: (body as DefaultMutation).resourceId,
            procedure: procedure !== "set" ? procedure : undefined,
          },
        });

        return Response.json(result);
      } catch (e) {
        console.error("Error parsing mutation from the client:", e);

        return Response.json(
          { message: "Internal server error", code: "INTERNAL_SERVER_ERROR" },
          { status: 500 }
        );
      }
    }

    return Response.json(
      { message: "Not found", code: "NOT_FOUND" },
      { status: 404 }
    );
  };
};
