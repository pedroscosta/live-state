import type { RawQueryRequest } from '../schemas/core-protocol';
import type { PromiseOrSync } from '../utils';

export interface DataSource {
	get(query: RawQueryRequest, extra?: { context?: any }): PromiseOrSync<any[]>;
}

export interface QueryStep {
	query: RawQueryRequest;
	stepPath: string[];
	/** Whether this is a one-to-many relation (relative to the parent step) */
	isMany?: boolean;
	/** The relation name in parent's schema */
	relationName?: string;
	/** Relation names included on this step, preserved after `include` is stripped from the query */
	includedRelations?: string[];
}
