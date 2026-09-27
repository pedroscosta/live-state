/** biome-ignore-all lint/suspicious/noExplicitAny: too much work to fix right now -- PRs welcome! */
import cookie from 'cookie';
import { parse } from 'qs';
import type WebSocket from 'ws';
import type { GenericMutation } from '../../core/schemas/core-protocol';
import { clientMessageSchema } from '../../core/schemas/web-socket';
import { generateId } from '../../core/utils';
import { serializePublicError } from '../../errors';
import type { LiveObjectAny, MaterializedLiveType } from '../../schema';
import { hash } from '../../utils';
import type { AnyRouter, Server } from '../';

export interface WebSocketRequest {
	headers: Record<string, any>;
	url: string;
}

export interface WebSocketTransport {
	send(message: string): unknown;
}

export interface WebSocketConnection {
	handleMessage(message: unknown): Promise<void>;
	handleClose(): void;
}

const decodeMessage = (message: unknown): string => {
	if (typeof message === 'string') return message;

	if (message instanceof ArrayBuffer) {
		return new TextDecoder().decode(message);
	}

	if (ArrayBuffer.isView(message)) {
		return new TextDecoder().decode(message as Uint8Array);
	}

	return String(message);
};

/**
 * Creates the protocol state for one WebSocket connection.
 *
 * The returned handlers are intentionally independent from a WebSocket
 * library's event API. Bun registers one shared handler object for all
 * connections, while `ws` registers listeners on each socket.
 */
export const createWebSocketConnection = (
	server: Server<AnyRouter, any>,
	transport: WebSocketTransport,
	request: WebSocketRequest,
): WebSocketConnection => {
	const logger = server.logger;
	const clientId = generateId();
	let isOpen = true;
	const subscriptions: Map<string, () => void> = new Map();

	const send = (message: unknown) => {
		if (!isOpen) return;
		transport.send(JSON.stringify(message));
	};

	const requestContext: {
		headers: Record<string, any>;
		cookies: Record<string, any>;
	} = {
		headers: request.headers,
		cookies:
			typeof request.headers.cookie === 'string'
				? cookie.parse(request.headers.cookie)
				: {},
	};

	const parsedUrl = new URL(request.url, 'http://localhost');
	const parsedQs = parse(parsedUrl.search.slice(1)) as Record<string, any>;

	const initialContext = server.contextProvider?.({
		transport: 'WEBSOCKET',
		headers: requestContext.headers,
		cookies: requestContext.cookies,
		queryParams: parsedQs,
	});

	logger.info('Client connected:', clientId);

	const handleMessage = async (message: unknown) => {
		try {
			logger.debug('Message received from the client:', message);

			const parsedMessage = clientMessageSchema.parse(
				JSON.parse(decodeMessage(message)),
			);

			if (
				parsedMessage.type === 'SUBSCRIBE' ||
				parsedMessage.type === 'QUERY'
			) {
				const { type, id, ...queryOrCustom } = parsedMessage;
				const isSubscribe = type === 'SUBSCRIBE';

				try {
					const result = await server.handleCustomQuery({
						req: {
							...requestContext,
							type: 'CUSTOM_QUERY',
							resource: queryOrCustom.resource,
							procedure: queryOrCustom.procedure,
							input: queryOrCustom.input,
							context: (await initialContext) ?? {},
							queryParams: parsedQs,
						},
						subscription: isSubscribe
							? (mutation) => {
									if (
										!mutation.resourceId ||
										!mutation.payload ||
										!Object.keys(mutation.payload).length
									)
										return;

									send(mutation);
								}
							: undefined,
					});

					if (isSubscribe) {
						if (!result || !result.data || !result.query) {
							throw new Error(
								'Cannot subscribe to a one-shot query: the procedure must return a query builder (a Tracked Query), not a computed value',
							);
						}

						if (result.unsubscribe) {
							subscriptions.set(hash(queryOrCustom), result.unsubscribe);
						}

						send({
							id,
							type: 'REPLY',
							data: {
								resource: result.query.resource,
								data: (result.data ?? []).map(
									(v: MaterializedLiveType<LiveObjectAny>) => v.value,
								),
							},
						});
					} else {
						send({
							id,
							type: 'REPLY',
							data: result,
						});
					}
				} catch (error) {
					send({
						id,
						type: 'REJECT',
						resource: queryOrCustom.resource,
						error: serializePublicError(error),
					});
					logger.error('Error handling query from the client:', error);
				}
			} else if (parsedMessage.type === 'UNSUBSCRIBE') {
				const { type: _type, id: _id, ...queryOrCustom } = parsedMessage;

				const unsubscribe = subscriptions.get(hash(queryOrCustom));

				if (unsubscribe) {
					unsubscribe();
					subscriptions.delete(hash(queryOrCustom));
				}
			} else if (parsedMessage.type === 'CUSTOM_QUERY') {
				const { resource, procedure, input, id } = parsedMessage;
				logger.debug('Received custom query from client:', parsedMessage);
				try {
					const result = await server.handleCustomQuery({
						req: {
							...requestContext,
							type: 'CUSTOM_QUERY',
							resource,
							procedure,
							input,
							context: (await initialContext) ?? {},
							queryParams: parsedQs,
						},
					});

					send({
						id,
						type: 'REPLY',
						data: result,
					});
				} catch (error) {
					send({
						id,
						type: 'REJECT',
						resource,
						error: serializePublicError(error),
					});
					logger.error('Error handling custom query from the client:', error);
				}
			} else if (parsedMessage.type === 'MUTATE') {
				const { resource } = parsedMessage;
				logger.debug('Received mutation from client:', parsedMessage);
				try {
					const result = await server.handleMutation({
						req: {
							...requestContext,
							type: 'MUTATE',
							resource,
							input: parsedMessage.payload,
							context: {
								messageId: parsedMessage.id,
								...((await initialContext) ?? {}),
							},
							resourceId: parsedMessage.resourceId,
							procedure: (parsedMessage as GenericMutation).procedure,
							queryParams: parsedQs,
							meta: (parsedMessage as GenericMutation).meta,
						},
					});

					send({
						id: parsedMessage.id,
						type: 'REPLY',
						data: result,
					});
				} catch (error) {
					send({
						id: parsedMessage.id,
						type: 'REJECT',
						resource,
						error: serializePublicError(error),
					});
					logger.error('Error parsing mutation from the client:', error);
				}
			}
		} catch (error) {
			// Invalid messages do not have a reliable id or resource to reply with.
			logger.error('Error handling message from the client:', error);
		}
	};

	const handleClose = () => {
		if (!isOpen) return;
		isOpen = false;
		logger.info('Connection closed', clientId);
		for (const unsubscribe of Array.from(subscriptions.values())) {
			unsubscribe();
		}
		subscriptions.clear();
	};

	return { handleMessage, handleClose };
};

export const webSocketAdapter = (server: Server<AnyRouter, any>) => {
	return (ws: WebSocket, request: WebSocketRequest) => {
		const connection = createWebSocketConnection(
			server,
			{ send: (message) => ws.send(message) },
			request,
		);

		ws.on('message', connection.handleMessage);
		ws.on('close', connection.handleClose);
	};
};
