import cookie from "cookie";
import qs from "qs";
import type { DefaultMutation } from "../../core/schemas/core-protocol";
import {
  type HttpMutation,
  httpDefaultMutationSchema,
  httpGenericMutationSchema,
  httpQuerySchema,
} from "../../core/schemas/http";
import type { AnyRouter, Server } from "..";

export const httpTransportLayer = (
  server: Server<AnyRouter>
): ((request: Request) => Promise<Response>) => {
  const logger = server.logger;

  return async (request: Request) => {
    try {
      const headers =
        typeof (request.headers as any).getSetCookie === "function"
          ? Object.fromEntries(request.headers as any)
          : (request.headers as unknown as Record<string, string>);

      const baseRequestData: {
        headers: Record<string, any>;
        cookies: Record<string, any>;
      } = {
        headers,
        cookies: headers.cookie ? cookie.parse(headers.cookie) : {},
      };

      const url = new URL(request.url);
      const segments = url.pathname.split("/");

      const searchParams = url.searchParams;

      const rawParsedQs = qs.parse(searchParams.toString()) as Record<
        string,
        any
      >;

      const initialContext =
        (await server.contextProvider?.({
          transport: "HTTP",
          headers: baseRequestData.headers,
          cookies: baseRequestData.cookies,
          queryParams: rawParsedQs,
        })) ?? {};

      if (request.method === "GET") {
        const resource = segments[segments.length - 1];

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

        const result = await server.handleQuery({
          req: {
            ...baseRequestData,
            ...parsedQs,
            type: "QUERY",
            resource: resource,
            context: initialContext,
            queryParams: rawParsedQs as Record<string, any>,
          },
        });

        if (!result || !result.data) {
          return Response.json(
            {
              message: "Invalid resource",
              code: "INVALID_RESOURCE",
            },
            { status: 400 }
          );
        }

        return Response.json(result.data);
      }

      if (request.method === "POST") {
        try {
          const procedure = segments[segments.length - 1];
          const resource = segments[segments.length - 2];

          const rawBody = request.body ? await request.json() : {};

          let body: HttpMutation;

          if (procedure === "insert" || procedure === "update") {
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

          const result = await server.handleMutation({
            req: {
              ...baseRequestData,
              type: "MUTATE",
              resource: resource,
              input: body.payload,
              context: initialContext,
              resourceId: (body as DefaultMutation).resourceId,
              procedure:
                procedure === "insert" || procedure === "update"
                  ? procedure.toUpperCase()
                  : procedure,
              queryParams: {},
            },
          });

          return Response.json(result);
        } catch (e) {
          logger.error("Error parsing mutation from the client:", e);

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
    } catch (e) {
      logger.error("Unexpected error:", e);
      return Response.json(
        { message: "Internal server error", code: "INTERNAL_SERVER_ERROR" },
        { status: 500 }
      );
    }
  };
};
