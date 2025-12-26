/**
 * Benchmark script for live-state library
 * Single mode benchmark: nested-include-query
 * Designed to be extensible for future benchmark modes
 */

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
} from "../src/schema";
import { routeFactory, router, server, expressAdapter } from "../src/server";
import { SQLStorage } from "../src/server/storage";
import { generateId } from "../src/core/utils";
import { createClient as createFetchClient } from "../src/client/fetch";
import { createClient as createWSClient } from "../src/client/websocket/client";
import type { Server as HttpServer } from "http";
import { LogLevel } from "../src/utils";

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

const benchmarkSchema = createSchema({
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

const benchmarkRouter = router({
  schema: benchmarkSchema,
  routes: {
    orgs: publicRoute.collectionRoute(benchmarkSchema.orgs),
    users: publicRoute.collectionRoute(benchmarkSchema.users),
    posts: publicRoute.collectionRoute(benchmarkSchema.posts),
    comments: publicRoute.collectionRoute(benchmarkSchema.comments),
  },
});

interface BenchmarkResult {
  mode: string;
  iterations: number;
  totalTime: number;
  averageTime: number;
  minTime: number;
  maxTime: number;
  p50: number;
  p95: number;
  p99: number;
  throughput: number; // operations per second
}

interface BenchmarkOptions {
  mode: string;
  iterations: number;
  dataSize?: number; // Number of records per entity type
}

const calculateStats = (
  times: number[]
): Omit<BenchmarkResult, "mode" | "iterations" | "throughput"> => {
  const sorted = [...times].sort((a, b) => a - b);
  const totalTime = times.reduce((sum, time) => sum + time, 0);
  const averageTime = totalTime / times.length;
  const minTime = sorted[0];
  const maxTime = sorted[sorted.length - 1];
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const p99 = sorted[Math.floor(sorted.length * 0.99)];

  return {
    totalTime,
    averageTime,
    minTime,
    maxTime,
    p50,
    p95,
    p99,
  };
};

class BenchmarkRunner {
  private pool!: Pool;
  private storage!: SQLStorage;
  private testServer!: ReturnType<typeof server>;
  private httpServer: HttpServer | null = null;
  private serverPort: number = 0;
  private fetchClient: ReturnType<
    typeof createFetchClient<typeof benchmarkRouter>
  > | null = null;
  private wsClient: ReturnType<
    typeof createWSClient<typeof benchmarkRouter>
  > | null = null;

  async setup() {
    // Create database pool
    this.pool = new Pool({
      connectionString:
        "postgresql://admin:admin@localhost:5432/live_state_benchmark_test",
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    // Create SQL storage
    this.storage = new SQLStorage(this.pool);
    await this.storage.init(benchmarkSchema);

    // Create server
    this.testServer = server({
      router: benchmarkRouter,
      storage: this.storage,
      schema: benchmarkSchema,
      logLevel: LogLevel.ERROR, // Reduce logging for benchmarks
    });

    // Clean up all tables
    try {
      await this.pool.query(
        "TRUNCATE TABLE orgs, orgs_meta, users, users_meta, posts, posts_meta, comments, comments_meta RESTART IDENTITY CASCADE"
      );
    } catch (error) {
      // Ignore errors if tables don't exist yet
    }

    // Create Express server
    const { app } = expressWs(express());
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    expressAdapter(app, this.testServer);

    // Start server on a random port
    this.serverPort = await new Promise<number>((resolve) => {
      this.httpServer = app.listen(0, () => {
        const address = this.httpServer?.address();
        const port =
          typeof address === "object" && address?.port ? address.port : 0;
        resolve(port);
      });
    });

    // Create fetch client
    this.fetchClient = createFetchClient({
      url: `http://localhost:${this.serverPort}`,
      schema: benchmarkSchema,
    });

    // Create websocket client
    this.wsClient = createWSClient({
      url: `ws://localhost:${this.serverPort}/ws`,
      schema: benchmarkSchema,
      storage: false,
      connection: {
        autoConnect: true,
        autoReconnect: false,
      },
    });

    // Wait for websocket connection
    await this.waitForWSConnection();
  }

  private async waitForWSConnection(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (this.wsClient!.client.ws.connected()) {
        resolve();
        return;
      }

      const listener = () => {
        if (this.wsClient!.client.ws.connected()) {
          this.wsClient!.client.ws.removeEventListener(
            "connectionChange",
            listener
          );
          resolve();
        }
      };

      this.wsClient!.client.ws.addEventListener("connectionChange", listener);
    });
  }

  async teardown() {
    // Disconnect websocket client
    if (this.wsClient?.client?.ws) {
      this.wsClient.client.ws.disconnect();
    }

    // Close HTTP server
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer?.close(() => resolve());
      });
      this.httpServer = null;
    }

    // Clean up tables
    if (this.pool) {
      try {
        await this.pool.query(
          "TRUNCATE TABLE orgs, orgs_meta, users, users_meta, posts, posts_meta, comments, comments_meta RESTART IDENTITY CASCADE"
        );
      } catch (error) {
        // Ignore errors during cleanup
      }
    }

    // Close pool
    if (this.pool) {
      await this.pool.end();
    }
  }

  /**
   * Prime the database with test data
   * Creates orgs, users, posts, and comments with relationships
   */
  async primeDatabase(dataSize: number) {
    console.log(`Priming database with ${dataSize} records per entity type...`);

    const orgIds: string[] = [];
    const userIds: string[] = [];
    const postIds: string[] = [];

    // Create orgs
    for (let i = 0; i < dataSize; i++) {
      const orgId = generateId();
      orgIds.push(orgId);
      await this.storage.insert(benchmarkSchema.orgs, {
        id: orgId,
        name: `Organization ${i}`,
      });
    }

    // Create users
    for (let i = 0; i < dataSize; i++) {
      const userId = generateId();
      userIds.push(userId);
      await this.storage.insert(benchmarkSchema.users, {
        id: userId,
        name: `User ${i}`,
        email: `user${i}@example.com`,
      });
    }

    // Create posts (each org has multiple posts, each post has an author)
    for (let i = 0; i < dataSize; i++) {
      const postId = generateId();
      postIds.push(postId);
      const orgId = orgIds[i % orgIds.length];
      const authorId = userIds[i % userIds.length];

      await this.storage.insert(benchmarkSchema.posts, {
        id: postId,
        title: `Post ${i}`,
        content: `Content for post ${i}`,
        orgId,
        authorId,
        likes: i % 10,
      });
    }

    // Create comments (each post has multiple comments, each comment has an author)
    for (let i = 0; i < dataSize; i++) {
      const commentId = generateId();
      const postId = postIds[i % postIds.length];
      const authorId = userIds[i % userIds.length];

      await this.storage.insert(benchmarkSchema.comments, {
        id: commentId,
        content: `Comment ${i}`,
        postId,
        authorId,
      });
    }

    console.log("Database priming complete.");
  }

  /**
   * Benchmark nested include query
   * Queries orgs with nested includes: orgs -> posts -> comments -> author
   */
  async benchmarkNestedIncludeQuery(
    iterations: number
  ): Promise<BenchmarkResult> {
    const times: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await this.fetchClient!.query.orgs.include({
        posts: {
          comments: {
            author: true,
          },
          author: true,
        },
      }).get();
      const end = performance.now();
      times.push(end - start);
    }

    const stats = calculateStats(times);
    return {
      mode: "nested-include-query",
      iterations,
      ...stats,
      throughput: (iterations / stats.totalTime) * 1000,
    };
  }

  /**
   * Benchmark incremental query latency
   * Subscribes to a deep query, then inserts mutations and measures
   * the latency between sending the mutation and receiving it on the client
   */
  async benchmarkIncrementalQueryLatency(
    iterations: number
  ): Promise<BenchmarkResult> {
    const times: number[] = [];

    // Subscribe to deep query: orgs with nested includes
    const unsubscribe = this.wsClient?.client.load(
      this.wsClient?.store.query.orgs
        .include({
          posts: {
            comments: {
              author: true,
            },
            author: true,
          },
        })
        .buildQueryRequest()
    );

    // Track pending mutations by resourceId
    const pendingMutations = new Map<string, { sendTime: number }>();

    // Set up event listener to track when mutations are received
    const eventUnsubscribe = this.wsClient!.client.addEventListener((event) => {
      if (
        event.type === "MESSAGE_RECEIVED" &&
        event.message.type === "MUTATE"
      ) {
        console.log("Mutation received:", event.message);
        const resourceId = event.message.resourceId;
        if (resourceId && pendingMutations.has(resourceId)) {
          const pending = pendingMutations.get(resourceId)!;
          const receiveTime = performance.now();
          const latency = receiveTime - pending.sendTime;
          times.push(latency);
          pendingMutations.delete(resourceId);
        }
      }
    });

    // Get initial data to work with
    const orgs = await this.fetchClient!.query.orgs.get();
    const users = await this.fetchClient!.query.users.get();
    const posts = await this.fetchClient!.query.posts.get();

    if (orgs.length === 0 || users.length === 0 || posts.length === 0) {
      throw new Error(
        "Database must be primed with data before running incremental query latency benchmark"
      );
    }

    // Run benchmark iterations
    for (let i = 0; i < iterations; i++) {
      const commentId = generateId();
      const postId = posts[i % posts.length].id;
      const authorId = users[i % users.length].id;

      // Create promise to track when this mutation is received

      const sendTime = performance.now();
      pendingMutations.set(commentId, { sendTime });

      // Send mutation
      this.wsClient!.store.mutate.comments.insert({
        id: commentId,
        content: `Benchmark comment ${i}`,
        postId,
        authorId,
      });

      // Small delay between mutations
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    // Cleanup
    eventUnsubscribe();
    unsubscribe?.();

    const stats = calculateStats(times);
    return {
      mode: "incremental-query-latency",
      iterations,
      ...stats,
      throughput: (iterations / stats.totalTime) * 1000,
    };
  }

  async runBenchmark(options: BenchmarkOptions): Promise<BenchmarkResult[]> {
    const results: BenchmarkResult[] = [];
    const { mode, iterations, dataSize = 100 } = options;

    console.log(`\nRunning benchmark: ${mode} (${iterations} iterations)`);
    console.log(`Data size: ${dataSize} records per entity type`);

    if (mode === "nested-include-query") {
      // Drop all data
      try {
        await this.pool.query(
          "TRUNCATE TABLE orgs, orgs_meta, users, users_meta, posts, posts_meta, comments, comments_meta RESTART IDENTITY CASCADE"
        );
      } catch (error) {
        // Ignore errors
      }

      // Prime database with data
      await this.primeDatabase(dataSize);

      // Run benchmark
      results.push(await this.benchmarkNestedIncludeQuery(iterations));
    } else if (mode === "incremental-query-latency") {
      // Drop all data
      try {
        await this.pool.query(
          "TRUNCATE TABLE orgs, orgs_meta, users, users_meta, posts, posts_meta, comments, comments_meta RESTART IDENTITY CASCADE"
        );
      } catch (error) {
        // Ignore errors
      }

      // Prime database with data
      await this.primeDatabase(dataSize);

      // Wait a bit for data to sync
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Run benchmark
      results.push(await this.benchmarkIncrementalQueryLatency(iterations));
    } else {
      throw new Error(`Unknown benchmark mode: ${mode}`);
    }

    return results;
  }
}

const printResults = (results: BenchmarkResult[]) => {
  console.log("\n" + "=".repeat(80));
  console.log("BENCHMARK RESULTS");
  console.log("=".repeat(80));

  for (const result of results) {
    console.log(`\nMode: ${result.mode}`);
    console.log(`Iterations: ${result.iterations}`);
    console.log(`Total Time: ${result.totalTime.toFixed(2)}ms`);
    console.log(`Average Time: ${result.averageTime.toFixed(2)}ms`);
    console.log(`Min Time: ${result.minTime.toFixed(2)}ms`);
    console.log(`Max Time: ${result.maxTime.toFixed(2)}ms`);
    console.log(`P50: ${result.p50.toFixed(2)}ms`);
    console.log(`P95: ${result.p95.toFixed(2)}ms`);
    console.log(`P99: ${result.p99.toFixed(2)}ms`);
    console.log(`Throughput: ${result.throughput.toFixed(2)} ops/sec`);
  }

  console.log("\n" + "=".repeat(80));
};

const main = async () => {
  const args = process.argv.slice(2);
  const mode =
    args.find((arg) => arg.startsWith("--mode="))?.split("=")[1] ||
    "incremental-query-latency";
  const iterations =
    parseInt(
      args.find((arg) => arg.startsWith("--iterations="))?.split("=")[1] || "10"
    ) || 10;
  const dataSize =
    parseInt(
      args.find((arg) => arg.startsWith("--data-size="))?.split("=")[1] || "100"
    ) || 100;

  console.log("Live-State Benchmark Suite");
  console.log(`Mode: ${mode}`);
  console.log(`Iterations: ${iterations}`);
  console.log(`Data Size: ${dataSize} records per entity type`);

  const runner = new BenchmarkRunner();

  try {
    await runner.setup();
    const results = await runner.runBenchmark({
      mode,
      iterations,
      dataSize,
    });
    printResults(results);
  } catch (error) {
    console.error("Benchmark failed:", error);
    process.exit(1);
  } finally {
    await runner.teardown();
  }
};

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
