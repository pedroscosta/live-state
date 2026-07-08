/**
 * Unit tests for the Relation Graph (see CONTEXT.md → Relation Graph). These
 * exercise edge topology and query membership directly, with no QueryEngine,
 * Storage, or subscriptions — the seam this module was extracted to expose.
 */

import { beforeEach, describe, expect, test } from "vitest";
import { RelationGraph } from "../../../src/core/query-engine/relation-graph";
import {
	createRelations,
	createSchema,
	id,
	object,
	reference,
	string,
} from "../../../src/schema";

const user = object("users", {
	id: id(),
	name: string(),
});

const post = object("posts", {
	id: id(),
	title: string(),
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

/** A mutation payload only needs the touched column's key present. */
const touched = (column: string) => ({ [column]: { value: null } });

describe("RelationGraph", () => {
	let graph: RelationGraph;

	beforeEach(() => {
		graph = new RelationGraph(schema);
	});

	describe("applyWrite — edge topology", () => {
		test("an INSERT wires the FK edge in both directions", () => {
			graph.applyWrite("posts", "p1", { id: "p1", authorId: "u1" });

			// child → parent (query perspective: follow posts' inverse up to author)
			expect(graph.reference("p1", "users", "posts")).toBe("u1");
			// parent → children (reverse-ref fan-out lookup)
			expect(Array.from(graph.referencedBy("u1", "posts", "author"))).toEqual([
				"p1",
			]);
		});

		test("re-parenting unlinks the old author and links the new one", () => {
			graph.applyWrite("posts", "p1", { id: "p1", authorId: "u1" });
			graph.applyWrite(
				"posts",
				"p1",
				{ id: "p1", authorId: "u2" },
				touched("authorId"),
			);

			expect(graph.reference("p1", "users", "posts")).toBe("u2");
			expect(graph.referencedBy("u1", "posts", "author").size).toBe(0);
			expect(Array.from(graph.referencedBy("u2", "posts", "author"))).toEqual([
				"p1",
			]);
		});

		test("an FK set to null just unlinks", () => {
			graph.applyWrite("posts", "p1", { id: "p1", authorId: "u1" });
			graph.applyWrite(
				"posts",
				"p1",
				{ id: "p1", authorId: null },
				touched("authorId"),
			);

			expect(graph.reference("p1", "users", "posts")).toBeUndefined();
			expect(graph.referencedBy("u1", "posts", "author").size).toBe(0);
		});

		test("a payload that does not touch the FK leaves the edge intact", () => {
			graph.applyWrite("posts", "p1", { id: "p1", authorId: "u1" });
			graph.applyWrite(
				"posts",
				"p1",
				{ id: "p1", authorId: "u1", title: "renamed" },
				touched("title"),
			);

			expect(graph.reference("p1", "users", "posts")).toBe("u1");
		});
	});

	describe("ingest — resolved nested tree", () => {
		test("wires the FK edge for a post with its author nested inline", () => {
			graph.ingest("posts", {
				id: "p1",
				title: "Hello",
				authorId: "u1",
				author: { id: "u1", name: "Alice" },
			});

			expect(graph.reference("p1", "users", "posts")).toBe("u1");
			expect(Array.from(graph.referencedBy("u1", "posts", "author"))).toEqual([
				"p1",
			]);
			expect(graph.has("u1")).toBe(true);
		});

		test("creates a node for every row in a parent's nested many-relation", () => {
			graph.ingest("users", {
				id: "u1",
				name: "Alice",
				posts: [
					{ id: "p1", authorId: "u1" },
					{ id: "p2", authorId: "u1" },
				],
			});

			// The reverse ref for a `many` is wired from each child's own FK ingest
			// step, not this parent-tree walk — but every row still gets a node.
			expect(graph.has("u1")).toBe(true);
			expect(graph.has("p1")).toBe(true);
			expect(graph.has("p2")).toBe(true);
		});
	});

	describe("membership", () => {
		test("setMatched / matches / clearMatched round-trip", () => {
			graph.setMatched("p1", "queryA");
			expect(graph.matches("p1", "queryA")).toBe(true);
			expect(graph.matches("p1", "queryB")).toBe(false);

			graph.clearMatched("p1", "queryA");
			expect(graph.matches("p1", "queryA")).toBe(false);
		});

		test("matchedQueriesOf reflects all current matches", () => {
			graph.setMatched("p1", "queryA");
			graph.setMatched("p1", "queryB");
			expect(Array.from(graph.matchedQueriesOf("p1")).sort()).toEqual([
				"queryA",
				"queryB",
			]);
		});

		test("membership on an untracked id is empty, not an error", () => {
			expect(graph.matches("ghost", "queryA")).toBe(false);
			expect(graph.matchedQueriesOf("ghost").size).toBe(0);
			expect(graph.has("ghost")).toBe(false);
		});
	});

	describe("reads tolerate missing edges", () => {
		test("reference / referencedBy on unknown ids return empty", () => {
			expect(graph.reference("nope", "users", "posts")).toBeUndefined();
			expect(graph.referencedBy("nope", "posts", "author").size).toBe(0);
		});
	});
});
