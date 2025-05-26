import cookie from "cookie";
import qs from "qs";
import { AnyRouter, Server } from "..";
import { httpQuerySchema } from "../../core/schemas/http";

export const httpTransportLayer = (
  server: Server<AnyRouter>
): ((request: Request) => Promise<Response>) => {
  return async (request: Request) => {
    console.log("[HTTP] request received", request);
    console.log("[HTTP] request headers", request.headers);

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

    if (request.method === "GET") {
      const searchParams = new URL(request.url).searchParams;

      const rawParsedQs = qs.parse(searchParams.toString());

      console.debug("[HTTP] parsed qs", rawParsedQs);

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

      const splitUrl = request.url.split("/");
      const resource = splitUrl[splitUrl.length - 1];

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
    }

    return Response.json(
      { message: "Not found", code: "NOT_FOUND" },
      { status: 404 }
    );

    // const reply = (msg: ServerMessage) => {
    //   ws.send(JSON.stringify(msg));
    // };
    // // TODO add ability to refuse connection
    // const requestContext: {
    //   headers: Record<string, any>;
    //   cookies: Record<string, any>;
    // } = {
    //   headers: request.headers,
    //   cookies:
    //     typeof request.headers.cookie === "string"
    //       ? cookie.parse(request.headers.cookie)
    //       : {},
    // };
    // connections[clientId] = ws;
    // console.log("Client connected:", clientId);
    // ws.on("message", async (message) => {
    //   try {
    //     console.log("Message received from the client:", message);
    //     const parsedMessage = clientMessageSchema.parse(
    //       JSON.parse(message.toString())
    //     );
    //     if (parsedMessage.type === "SUBSCRIBE") {
    //       const { resource } = parsedMessage;
    //       if (!subscriptions[resource]) subscriptions[resource] = {};
    //       subscriptions[resource][clientId] = {};
    //       // TODO send bootstrap
    //     } else if (parsedMessage.type === "SYNC") {
    //       const { resources: _res } = parsedMessage;
    //       const resources = _res ?? Object.keys(server.schema);
    //       console.log("Syncing resources:", resources);
    //       await Promise.all(
    //         resources.map(async (resourceName) => {
    //           const result = await server.handleRequest({
    //             req: {
    //               ...requestContext,
    //               type: "QUERY",
    //               resourceName,
    //               context: {}, // TODO provide context
    //             },
    //           });
    //           if (!result || !result.data) {
    //             throw new Error("Invalid resource");
    //           }
    //           reply({
    //             id: parsedMessage.id,
    //             type: "SYNC",
    //             resource: resourceName,
    //             data: Object.fromEntries(
    //               Object.entries(
    //                 (result.data ?? {}) as Record<
    //                   string,
    //                   MaterializedLiveType<LiveObjectAny>
    //                 >
    //               ).map(([id, v]) => [id, v.value])
    //             ),
    //           });
    //         })
    //       );
    //     } else if (parsedMessage.type === "MUTATE") {
    //       const { resource } = parsedMessage;
    //       console.log("Received mutation from client:", parsedMessage);
    //       try {
    //         const result = await server.handleRequest({
    //           req: {
    //             ...requestContext,
    //             type: "MUTATE",
    //             resourceName: resource,
    //             input: parsedMessage.payload,
    //             context: { messageId: parsedMessage.id }, // TODO provide context
    //             resourceId: (parsedMessage as DefaultMutation).resourceId,
    //             procedure: (parsedMessage as GenericMutation).procedure,
    //           },
    //         });
    //         if ((parsedMessage as GenericMutation).procedure) {
    //           reply({
    //             id: parsedMessage.id,
    //             type: "REPLY",
    //             data: result,
    //           });
    //         }
    //       } catch (e) {
    //         reply({
    //           id: parsedMessage.id,
    //           type: "REJECT",
    //           resource,
    //           message: (e as Error).message,
    //         });
    //         console.error("Error parsing mutation from the client:", e);
    //       }
    //     }
    //   } catch (e) {
    //     // TODO send error to client
    //     console.error("Error handling message from the client:", e);
    //   }
    // });
    // ws.on("close", () => {
    //   console.log("Connection closed", clientId);
    //   delete connections[clientId];
    // });
  };
};
