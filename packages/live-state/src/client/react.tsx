import { useEffect, useSyncExternalStore } from 'react';
import type { AnyRouter } from '../server';
import { hash } from '../utils';
import type { Client } from '.';
import type { QueryBuilder } from './query';

class Store {
	private subscriptions: Map<
		string,
		{
			subscribe: (cb: () => void) => () => void;
			callbacks: Set<() => void>;
		}
	> = new Map();

	getOrStoreSubscription(
		builder: QueryBuilder<any>,
	): (cb: () => void) => () => void {
		const key = hash(builder);

		if (this.subscriptions.has(key))
			return this.subscriptions.get(key)!.subscribe;

		this.subscriptions.set(key, {
			subscribe: (cb: () => void) => {
				this.subscriptions.get(key)?.callbacks.add(cb);

				const unsub = builder.subscribe(() => {
					this.subscriptions.get(key)?.callbacks.forEach((cb) => {
						cb();
					});
				});

				return () => {
					this.subscriptions.get(key)?.callbacks.delete(cb);

					setTimeout(() => {
						if (this.subscriptions.get(key)?.callbacks.size === 0) {
							this.subscriptions.delete(key);
							unsub();
						}
					}, 10);
				};
			},
			callbacks: new Set(),
		});

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

export const useLoadData = (
	client: Client<AnyRouter>['client'],
	query: QueryBuilder<any, any>,
) => {
	useEffect(() => {
		const unsub = client.load(query.buildQueryRequest());

		return () => {
			unsub();
		};
	}, [query, client.load]);
};
