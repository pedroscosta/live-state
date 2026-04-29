import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { QueryBuilder } from '../core/query';
import type {
	CustomQueryRequest,
	RawQueryRequest,
} from '../core/schemas/core-protocol';
import { hash } from '../utils';
import type { Client } from '.';
import type { ClientRouterConstraint } from './types';
import type { ClientBootstrapStatus } from './websocket/client';

class Store {
	private subscriptions: Map<
		string,
		{
			subscribe: (cb: () => void) => () => void;
			callbacks: Set<() => void>;
			unsubscribe?: () => void;
		}
	> = new Map();

	getOrStoreSubscription(
		builder: QueryBuilder<any>,
	): (cb: () => void) => () => void {
		const queryRequest = builder.buildQueryRequest();
		const key = hash(queryRequest) as string;

		if (this.subscriptions.has(key))
			return this.subscriptions.get(key)!.subscribe;

		const entry = {
			subscribe: (cb: () => void) => {
				const subscriptionEntry = this.subscriptions.get(key)!;
				subscriptionEntry.callbacks.add(cb);

				if (!subscriptionEntry.unsubscribe) {
					subscriptionEntry.unsubscribe = () => {
						// Temporary placeholder to prevent concurrent subscriptions
					};

					subscriptionEntry.unsubscribe = builder.subscribe(() => {
						subscriptionEntry.callbacks.forEach((cb) => {
							cb();
						});
					});
				}

				return () => {
					this.subscriptions.get(key)?.callbacks.delete(cb);

					setTimeout(() => {
						const subscriptionEntry = this.subscriptions.get(key);
						if (subscriptionEntry && subscriptionEntry.callbacks.size === 0) {
							subscriptionEntry.unsubscribe?.();
							this.subscriptions.delete(key);
						}
					}, 10);
				};
			},
			callbacks: new Set<() => void>(),
			unsubscribe: undefined as (() => void) | undefined,
		};

		this.subscriptions.set(key, entry);

		return this.subscriptions.get(key)!.subscribe;
	}
}

const store = new Store();

export const useLiveQuery = <
	T extends { get: () => U; subscribe: (cb: (v: U) => void) => () => void },
	U,
>(
	observable: T,
) => {
	return useSyncExternalStore(
		store.getOrStoreSubscription(
			observable as unknown as QueryBuilder<any, any>,
		),
		observable.get,
	) as ReturnType<T['get']>;
};

export type ClientState = {
	bootstrapStatus: ClientBootstrapStatus;
	connected: boolean;
};

export const useClientState = (
	client: Client<ClientRouterConstraint>['client'],
): ClientState => {
	const { subscribe, getSnapshot } = useMemo(() => {
		let snapshot: ClientState = {
			bootstrapStatus: client.bootstrapStatus,
			connected: client.ws.connected(),
		};

		const recompute = () => {
			const next: ClientState = {
				bootstrapStatus: client.bootstrapStatus,
				connected: client.ws.connected(),
			};
			if (
				next.bootstrapStatus !== snapshot.bootstrapStatus ||
				next.connected !== snapshot.connected
			) {
				snapshot = next;
			}
		};

		return {
			subscribe: (cb: () => void) => {
				return client.addEventListener((event) => {
					if (
						event.type === 'BOOTSTRAP_STATUS_CHANGE' ||
						event.type === 'CONNECTION_STATE_CHANGE'
					) {
						recompute();
						cb();
					}
				});
			},
			getSnapshot: () => snapshot,
		};
	}, [client]);

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};

export const useLoadData = (
	client: Client<ClientRouterConstraint>['client'],
	query: {
		buildQueryRequest: () => RawQueryRequest | CustomQueryRequest;
	},
) => {
	useEffect(() => {
		const unsub = client.load(query.buildQueryRequest());

		return () => {
			unsub();
		};
	}, [query, client.load]);
};
