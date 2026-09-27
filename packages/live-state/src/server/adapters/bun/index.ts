import type { AnyRouter, Server } from '../../';
import { httpTransportLayer } from '../../transport-layers/http';
import {
	createWebSocketConnection,
	type WebSocketConnection,
	type WebSocketRequest,
} from '../../transport-layers/web-socket';

export interface BunWebSocketData {
	request: Request;
}

export interface BunServerWebSocket {
	data: BunWebSocketData;
	send(message: string): unknown;
}

export interface BunServer {
	upgrade(request: Request, options: { data: BunWebSocketData }): boolean;
}

export interface BunWebSocketHandler {
	data: BunWebSocketData;
	open(ws: BunServerWebSocket): void | Promise<void>;
	message(ws: BunServerWebSocket, message: unknown): void | Promise<void>;
	close(
		ws: BunServerWebSocket,
		code: number,
		reason: string,
	): void | Promise<void>;
}

export interface BunAdapter {
	fetch(
		request: Request,
		server: BunServer,
	): Response | undefined | Promise<Response | undefined>;
	websocket: BunWebSocketHandler;
}

const normalizeBasePath = (basePath?: string): string => {
	if (!basePath || basePath === '/') return '';
	return `/${basePath.replace(/^\/+|\/+$/g, '')}`;
};

const toWebSocketRequest = (request: Request): WebSocketRequest => ({
	headers: Object.fromEntries(
		request.headers as unknown as Iterable<readonly [string, string]>,
	),
	url: request.url,
});

/**
 * Creates the handlers expected by Bun.serve().
 *
 * ```ts
 * const { fetch, websocket } = bunAdapter(lsServer);
 * Bun.serve({ port: 5001, fetch, websocket });
 * ```
 */
export const bunAdapter = (
	server: Server<AnyRouter>,
	options?: { basePath?: string },
): BunAdapter => {
	const websocketPath = `${normalizeBasePath(options?.basePath)}/ws`;
	const httpHandler = httpTransportLayer(server);
	const connections = new WeakMap<BunServerWebSocket, WebSocketConnection>();

	const websocket: BunWebSocketHandler = {
		data: {} as BunWebSocketData,

		open(ws) {
			const request = ws.data?.request;
			if (!request) {
				server.logger.error(
					'Bun WebSocket connection opened without upgrade request data',
				);
				return;
			}

			connections.set(
				ws,
				createWebSocketConnection(
					server,
					{ send: (message) => ws.send(message) },
					toWebSocketRequest(request),
				),
			);
		},

		message(ws, message) {
			return connections.get(ws)?.handleMessage(message);
		},

		close(ws) {
			const connection = connections.get(ws);
			connection?.handleClose();
			connections.delete(ws);
		},
	};

	return {
		fetch(request, bunServer) {
			const url = new URL(request.url);

			if (url.pathname === websocketPath) {
				if (
					bunServer.upgrade(request, {
						data: { request },
					})
				) {
					return;
				}

				return new Response('WebSocket upgrade failed', { status: 400 });
			}

			return httpHandler(request);
		},
		websocket,
	};
};
