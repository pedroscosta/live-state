import { Pool } from "pg";
import express from "express";
import expressWs from "express-ws";
import {
	createRelations,
	createSchema,
	id,
	number,
	object,
	reference,
	string,
} from "../../src/schema";
import {
	routeFactory,
	router,
	server,
	expressAdapter,
} from "../../src/server";
import { SQLStorage } from "../../src/server/storage";
import { generateId } from "../../src/core/utils";
import { createClient as createFetchClient } from "../../src/client/fetch";
import { createClient as createWSClient } from "../../src/client/websocket/client";
import type { Server as HttpServer } from "http";
import { LogLevel } from "../../src/utils";

/**
 * Benchmark schema: orgs -> posts -> comments -> users
 */
const org = object("orgs", {
	id: id(),
	name: string(),
});

const user = object("users", {
	id: id(),
	name: string(),
	email: string(),
});

const post = object("posts", {
	id: id(),
	title: string(),
	content: string(),
	orgId: reference("orgs.id"),
	authorId: reference("users.id"),
	likes: number(),
});

const comment = object("comments", {
	id: id(),
	content: string(),
	postId: reference("posts.id"),
	authorId: reference("users.id"),
});

const orgRelations = createRelations(org, ({ many }) => ({
	posts: many(post, "orgId"),
}));

const userRelations = createRelations(user, ({ many }) => ({
	posts: many(post, "authorId"),
	comments: many(comment, "authorId"),
}));

const postRelations = createRelations(post, ({ one, many }) => ({
	org: one(org, "orgId"),
	author: one(user, "authorId"),
	comments: many(comment, "postId"),
}));

const commentRelations = createRelations(comment, ({ one }) => ({
	post: one(post, "postId"),
	author: one(user, "authorId"),
}));

export const benchmarkSchema = createSchema({
	orgs: org,
	users: user,
	posts: post,
	comments: comment,
	orgRelations,
	userRelations,
	postRelations,
	commentRelations,
});

const publicRoute = routeFactory();

export const benchmarkRouter = router({
	schema: benchmarkSchema,
	routes: {
		orgs: publicRoute.collectionRoute(benchmarkSchema.orgs),
		users: publicRoute.collectionRoute(benchmarkSchema.users),
		posts: publicRoute.collectionRoute(benchmarkSchema.posts),
		comments: publicRoute.collectionRoute(benchmarkSchema.comments),
	},
});

export type BenchmarkInfrastructure = {
	pool: Pool;
	storage: SQLStorage;
	testServer: ReturnType<typeof server>;
	httpServer: HttpServer | null;
	serverPort: number;
	fetchClient: ReturnType<
		typeof createFetchClient<typeof benchmarkRouter>
	> | null;
};

export type WSClient = ReturnType<
	typeof createWSClient<typeof benchmarkRouter>
>;

/**
 * Helper function to create a WebSocket client and wait for connection
 */
export async function createWSClientAndWait(
	serverPort: number,
): Promise<WSClient> {
	const wsClient = createWSClient({
		url: `ws://localhost:${serverPort}/ws`,
		schema: benchmarkSchema,
		storage: false,
		connection: {
			autoConnect: true,
			autoReconnect: false,
		},
	});

	// Wait for connection
	await new Promise<void>((resolve) => {
		if (wsClient.client.ws.connected()) {
			resolve();
			return;
		}

		const listener = () => {
			if (wsClient.client.ws.connected()) {
				wsClient.client.ws.removeEventListener(
					"connectionChange",
					listener,
				);
				resolve();
			}
		};

		wsClient.client.ws.addEventListener("connectionChange", listener);
	});

	return wsClient;
}

// Mutex to prevent concurrent setup/teardown
let setupTeardownLock: Promise<void> = Promise.resolve();

/**
 * Setup function to initialize test infrastructure
 */
export async function setupBenchmarkInfrastructure(): Promise<BenchmarkInfrastructure> {
	// Wait for any ongoing teardown to complete
	await setupTeardownLock;

	// Acquire lock
	let releaseLock: () => void;
	setupTeardownLock = new Promise<void>((resolve) => {
		releaseLock = resolve;
	});

	try {
		const pool = new Pool({
			connectionString:
				process.env.DATABASE_URL ||
				"postgresql://admin:admin@localhost:5432/live_state_benchmark_test",
			max: 10,
			idleTimeoutMillis: 30000,
			connectionTimeoutMillis: 2000,
		});

		// Create SQL storage
		const storage = new SQLStorage(pool);
		await storage.init(benchmarkSchema);

		// Create server
		const testServer = server({
			router: benchmarkRouter,
			storage: storage,
			schema: benchmarkSchema,
			logLevel: LogLevel.ERROR,
		});

		// Clean up all tables
		try {
			await pool.query(
				"TRUNCATE TABLE orgs, orgs_meta, users, users_meta, posts, posts_meta, comments, comments_meta RESTART IDENTITY CASCADE",
			);
		} catch (error) {
			// Ignore errors if tables don't exist yet
		}

		// Create Express server
		const { app } = expressWs(express());
		app.use(express.json());
		app.use(express.urlencoded({ extended: true }));

		expressAdapter(app, testServer);

		// Start server on a random port
		let httpServer: HttpServer | null = null;
		const serverPort = await new Promise<number>((resolve) => {
			httpServer = app.listen(0, () => {
				const address = httpServer?.address();
				const port =
					typeof address === "object" && address?.port ? address.port : 0;
				resolve(port);
			});
		});

		// Create fetch client
		const fetchClient = createFetchClient({
			url: `http://localhost:${serverPort}`,
			schema: benchmarkSchema,
		});

		return {
			pool,
			storage,
			testServer,
			httpServer,
			serverPort,
			fetchClient,
		};
	} finally {
		// Release lock
		releaseLock!();
	}
}

/**
 * Teardown function to clean up test infrastructure
 */
export async function teardownBenchmarkInfrastructure(
	infra: BenchmarkInfrastructure,
): Promise<void> {
	// Wait for any ongoing setup to complete
	await setupTeardownLock;

	// Acquire lock
	let releaseLock: () => void;
	setupTeardownLock = new Promise<void>((resolve) => {
		releaseLock = resolve;
	});

	try {
		// Close HTTP server
		if (infra.httpServer) {
			await new Promise<void>((resolve) => {
				infra.httpServer?.close(() => resolve());
			});
		}

		// Clean up tables
		if (infra.pool) {
			try {
				await infra.pool.query(
					"TRUNCATE TABLE orgs, orgs_meta, users, users_meta, posts, posts_meta, comments, comments_meta RESTART IDENTITY CASCADE",
				);
			} catch (error) {
				// Ignore errors during cleanup
			}
		}

		// Close pool
		if (infra.pool) {
			await infra.pool.end();
		}
	} finally {
		// Release lock
		releaseLock!();
	}
}

/**
 * Prime the database with test data
 */
export async function primeDatabase(
	infra: BenchmarkInfrastructure,
	dataSize: number,
): Promise<void> {
	const orgIds: string[] = [];
	const userIds: string[] = [];
	const postIds: string[] = [];

	// Create orgs
	for (let i = 0; i < dataSize; i++) {
		const orgId = generateId();
		orgIds.push(orgId);
		await infra.storage.insert(benchmarkSchema.orgs, {
			id: orgId,
			name: `Organization ${i}`,
		});
	}

	// Create users
	for (let i = 0; i < dataSize; i++) {
		const userId = generateId();
		userIds.push(userId);
		await infra.storage.insert(benchmarkSchema.users, {
			id: userId,
			name: `User ${i}`,
			email: `user${i}@example.com`,
		});
	}

	// Create posts
	for (let i = 0; i < dataSize; i++) {
		const postId = generateId();
		postIds.push(postId);
		const orgId = orgIds[i % orgIds.length];
		const authorId = userIds[i % userIds.length];

		await infra.storage.insert(benchmarkSchema.posts, {
			id: postId,
			title: `Post ${i}`,
			content: `Content for post ${i}`,
			orgId,
			authorId,
			likes: i % 10,
		});
	}

	// Create comments
	for (let i = 0; i < dataSize; i++) {
		const commentId = generateId();
		const postId = postIds[i % postIds.length];
		const authorId = userIds[i % userIds.length];

		await infra.storage.insert(benchmarkSchema.comments, {
			id: commentId,
			content: `Comment ${i}`,
			postId,
			authorId,
		});
	}
}

