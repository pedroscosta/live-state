/**
 * Regression test for issue #184: child-relation matching must re-apply an
 * `include`'s own `where` predicate, so a related-but-filtered-out object is
 * not broadcast to that query's subscribers (ADR-0003).
 */

import { beforeEach, describe, expect, test } from "vitest";
import { QueryEngine } from "../../../src/core/query-engine";
import type { RawQueryRequest, SyncDelta } from "../../../src/core/schemas/core-protocol";
import {
	createRelations,
	createSchema,
	id,
	object,
	reference,
	string,
} from "../../../src/schema";
import { Logger, LogLevel } from "../../../src/utils";

const user = object("users", {
	id: id(),
	name: string(),
});

const post = object("posts", {
	id: id(),
	title: string(),
	status: string(),
	authorId: reference("users.id"),
});

const userRelations = createRelations(user, ({ many }) => ({
	posts: many(post, "authorId"),
}));

const postRelations = createRelations(post, ({ one }) => ({
	author: one(user, "authorId"),
}));

const schema = createSchema({
	users: user,
	posts: post,
	userRelations,
	postRelations,
});

/** Wrap a plain field value in the `{ value, _meta }` materialized shape. */
const field = (value: unknown) => ({
	value,
	_meta: { timestamp: "2026-06-30T00:00:00.000Z" },
});

/** Materialize a plain object's own columns (no relations). */
const materialize = (obj: Record<string, unknown>) => ({
	value: Object.fromEntries(
		Object.entries(obj).map(([k, v]) => [k, field(v)]),
	),
	_meta: { timestamp: "2026-06-30T00:00:00.000Z" },
});

describe("getMatchingQueries — nested include where (issue #184)", () => {
	const query: RawQueryRequest = {
		resource: "users",
		include: { posts: { where: { status: "published" } } },
	};

	const userU1 = { id: "u1", name: "Alice" };
	const publishedPost = {
		id: "p1",
		title: "Hello",
		status: "published",
		authorId: "u1",
	};

	let engine: QueryEngine;

	beforeEach(async () => {
		// Storage resolves the whole `include` tree in one query (ADR-0003): a
		// user with only its published posts nested under `.posts`.
		const storage = {
			get: async () => [
				{
					...materialize(userU1),
					value: {
						...materialize(userU1).value,
						posts: {
							value: [materialize(publishedPost)],
							_meta: { timestamp: "2026-06-30T00:00:00.000Z" },
						},
					},
				},
			],
		};

		engine = new QueryEngine({
			storage,
			schema,
			logger: new Logger({ level: LogLevel.CRITICAL }),
		});

		engine.subscribe(query, () => {});
		// Ingest the resolved tree so object nodes / relations / matched-query
		// state are populated for realtime matching.
		await engine.get(query);
	});

	const matchPost = (status: string) =>
		engine.getMatchingQueries(
			{
				op: "UPDATE",
				resource: "posts",
				resourceId: "p1",
				type: "SYNC",
				payload: { status: field(status) },
			} as SyncDelta,
			{ ...publishedPost, status },
		);

	test("a related row satisfying the include's where matches", async () => {
		expect(await matchPost("published")).toHaveLength(1);
	});

	test("a related row failing the include's where does NOT match", async () => {
		// Relation membership still holds (p1 still authored by u1), but the
		// include's `where: { status: 'published' }` no longer holds.
		expect(await matchPost("draft")).toHaveLength(0);
	});
});
