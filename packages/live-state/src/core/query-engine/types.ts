import type { WhereClause } from '../../schema';
import type { Batcher } from '../../server/storage/batcher';
import type { RawQueryRequest } from '../schemas/core-protocol';
import type { PromiseOrSync } from '../utils';

export interface DataSource {
	get(
		query: RawQueryRequest,
		extra?: { context?: any; batcher?: Batcher },
	): PromiseOrSync<any[]>;
}

export interface QueryStepResult {
	includedBy?: string;
	data: any[];
}

export interface QueryStep {
	query: RawQueryRequest;
	stepPath: string[];
	/** For child steps: function to create where clause from parent ID */
	getWhere?: (id: string) => WhereClause<any>;
	/** For child steps: function to extract IDs from parent results */
	referenceGetter?: (parentData: any[]) => string[];
	/** Whether this is a one-to-many relation */
	isMany?: boolean;
	/** The relation name in parent's schema */
	relationName?: string;
	/** Where clause derived from the parent step (relational filtering) */
	relationalWhere?: WhereClause<any>;
	/** Relation names included on this step, preserved after `include` is stripped from the query */
	includedRelations?: string[];
}

export type DataRouter<_Context = unknown> = DataSource;
