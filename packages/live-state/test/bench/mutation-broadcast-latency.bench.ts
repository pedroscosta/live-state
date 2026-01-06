import { bench, describe } from "vitest";
import {
  setupBenchmarkInfrastructure,
  teardownBenchmarkInfrastructure,
  primeDatabase,
  createWSClientAndWait,
  type BenchmarkInfrastructure,
  type WSClient,
} from "./utils";
import { generateId } from "../../src/core/utils";

// Global infrastructure state for benchmarks
let infra: BenchmarkInfrastructure | null = null;

// Setup data for each benchmark
type SimpleCommentSetup = {
  sender: WSClient;
  receiver: WSClient;
  postId: string;
  authorId: string;
};

type PostUpdateSetup = {
  sender: WSClient;
  receiver: WSClient;
  postId: string;
};

type ConcurrentMutationsSetup = {
  sender: WSClient;
  receiver: WSClient;
  posts: Array<{ id: string }>;
  users: Array<{ id: string }>;
  mutationCount: number;
};

let simpleCommentSetup: SimpleCommentSetup | null = null;
let postUpdateSetup: PostUpdateSetup | null = null;
let commentWithRelationsSetup: SimpleCommentSetup | null = null;
let concurrentMutationsSetup: ConcurrentMutationsSetup | null = null;
let deepNestedQuerySetup: SimpleCommentSetup | null = null;

/**
 * Helper function to measure mutation broadcast latency
 * Returns a promise that resolves with the latency when mutation is received
 */
function measureMutationLatency(
  sender: WSClient,
  receiver: WSClient,
  mutationFn: () => void,
  resourceId: string
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    let resolved = false;
    let eventUnsubscribe: (() => void) | null = null;

    // Record start time just before setting up listener and sending mutation
    const startTime = performance.now();

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        if (eventUnsubscribe) {
          eventUnsubscribe();
        }
        reject(new Error(`Timeout waiting for mutation ${resourceId}`));
      }
    }, 5000); // 5 second timeout

    // Set up event listener to track when mutation is received
    eventUnsubscribe = receiver.client.addEventListener((event) => {
      if (
        event.type === "MESSAGE_RECEIVED" &&
        event.message.type === "MUTATE" &&
        event.message.resourceId === resourceId &&
        !resolved
      ) {
        resolved = true;
        clearTimeout(timeout);
        const endTime = performance.now();
        const latency = endTime - startTime;
        if (eventUnsubscribe) {
          eventUnsubscribe();
        }
        resolve(latency);
      }
    });

    // Send mutation
    mutationFn();
  });
}

describe("live-state mutation broadcast latency benchmarks", () => {
  bench(
    "insert mutation broadcast latency - simple comment insert",
    async () => {
      // console.log("simpleCommentSetup", simpleCommentSetup);
      const { sender, receiver, postId, authorId } = simpleCommentSetup!;

      const commentId = generateId();

      await measureMutationLatency(
        sender,
        receiver,
        () => {
          sender.store.mutate.comments.insert({
            id: commentId,
            content: "Benchmark comment",
            postId,
            authorId,
          });
        },
        commentId
      );
    },
    {
      setup: async () => {
        console.log("setting up simple comment setup");
        infra = await setupBenchmarkInfrastructure();
        await primeDatabase(infra, 50);

        const sender = await createWSClientAndWait(infra.serverPort);
        const receiver = await createWSClientAndWait(infra.serverPort);

        // Subscribe receiver to comments
        receiver.client.load(receiver.store.query.comments.buildQueryRequest());

        // Wait for subscription to be established
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Get a post and user for the comment
        const posts = await infra.fetchClient!.query.posts.get();
        const users = await infra.fetchClient!.query.users.get();

        if (posts.length === 0 || users.length === 0) {
          console.log("failed to get posts or users");
          throw new Error("Database must be primed with data");
        }

        simpleCommentSetup = {
          sender,
          receiver,
          postId: posts[0].id,
          authorId: users[0].id,
        };
        console.log("end of simpleCommentSetup", simpleCommentSetup);
      },
      teardown: async () => {
        if (simpleCommentSetup) {
          simpleCommentSetup.sender.client.ws.disconnect();
          simpleCommentSetup.receiver.client.ws.disconnect();
          simpleCommentSetup = null;
        }
        if (infra) {
          await teardownBenchmarkInfrastructure(infra);
          infra = null;
        }
      },
    }
  );

  bench(
    "update mutation broadcast latency - post update",
    async () => {
      const { sender, receiver, postId } = postUpdateSetup!;

      await measureMutationLatency(
        sender,
        receiver,
        () => {
          sender.store.mutate.posts.update(postId, {
            title: "Updated title",
            likes: 100,
          });
        },
        postId
      );
    },
    {
      setup: async () => {
        infra = await setupBenchmarkInfrastructure();
        await primeDatabase(infra, 50);

        const sender = await createWSClientAndWait(infra.serverPort);
        const receiver = await createWSClientAndWait(infra.serverPort);

        // Subscribe receiver to posts
        receiver.client.load(receiver.store.query.posts.buildQueryRequest());

        // Wait for subscription to be established
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Get a post to update
        const posts = await infra.fetchClient!.query.posts.get();

        if (posts.length === 0) {
          throw new Error("Database must be primed with data");
        }

        postUpdateSetup = {
          sender,
          receiver,
          postId: posts[0].id,
        };
      },
      teardown: async () => {
        if (postUpdateSetup) {
          postUpdateSetup.sender.client.ws.disconnect();
          postUpdateSetup.receiver.client.ws.disconnect();
          postUpdateSetup = null;
        }
        if (infra) {
          await teardownBenchmarkInfrastructure(infra);
          infra = null;
        }
      },
    }
  );

  bench(
    "insert mutation with relations broadcast latency - comment with post and author",
    async () => {
      const { sender, receiver, postId, authorId } = commentWithRelationsSetup!;

      const commentId = generateId();

      await measureMutationLatency(
        sender,
        receiver,
        () => {
          sender.store.mutate.comments.insert({
            id: commentId,
            content: "Benchmark comment with relations",
            postId,
            authorId,
          });
        },
        commentId
      );
    },
    {
      setup: async () => {
        infra = await setupBenchmarkInfrastructure();
        await primeDatabase(infra, 50);

        const sender = await createWSClientAndWait(infra.serverPort);
        const receiver = await createWSClientAndWait(infra.serverPort);

        // Subscribe receiver to comments with relations
        receiver.client.load(
          receiver.store.query.comments
            .include({
              post: true,
              author: true,
            })
            .buildQueryRequest()
        );

        // Wait for subscription to be established
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Get a post and user for the comment
        const posts = await infra.fetchClient!.query.posts.get();
        const users = await infra.fetchClient!.query.users.get();

        if (posts.length === 0 || users.length === 0) {
          throw new Error("Database must be primed with data");
        }

        commentWithRelationsSetup = {
          sender,
          receiver,
          postId: posts[0].id,
          authorId: users[0].id,
        };
      },
      teardown: async () => {
        if (commentWithRelationsSetup) {
          commentWithRelationsSetup.sender.client.ws.disconnect();
          commentWithRelationsSetup.receiver.client.ws.disconnect();
          commentWithRelationsSetup = null;
        }
        if (infra) {
          await teardownBenchmarkInfrastructure(infra);
          infra = null;
        }
      },
    }
  );

  bench(
    "concurrent mutations broadcast latency - multiple comment inserts",
    async () => {
      const { sender, receiver, posts, users, mutationCount } =
        concurrentMutationsSetup!;

      // Measure latency for concurrent mutations
      const latencies: Promise<number>[] = [];

      for (let i = 0; i < mutationCount; i++) {
        const commentId = generateId();
        const postId = posts[i % posts.length].id;
        const authorId = users[i % users.length].id;

        latencies.push(
          measureMutationLatency(
            sender,
            receiver,
            () => {
              sender.store.mutate.comments.insert({
                id: commentId,
                content: `Concurrent comment ${i}`,
                postId,
                authorId,
              });
            },
            commentId
          )
        );
      }

      // Wait for all mutations to complete
      await Promise.all(latencies);
    },
    {
      setup: async () => {
        infra = await setupBenchmarkInfrastructure();
        await primeDatabase(infra, 50);

        const sender = await createWSClientAndWait(infra.serverPort);
        const receiver = await createWSClientAndWait(infra.serverPort);

        // Subscribe receiver to comments
        receiver.client.load(receiver.store.query.comments.buildQueryRequest());

        // Wait for subscription to be established
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Get posts and users for comments
        const posts = await infra.fetchClient!.query.posts.get();
        const users = await infra.fetchClient!.query.users.get();

        if (posts.length === 0 || users.length === 0) {
          throw new Error("Database must be primed with data");
        }

        concurrentMutationsSetup = {
          sender,
          receiver,
          posts,
          users,
          mutationCount: 5,
        };
      },
      teardown: async () => {
        if (concurrentMutationsSetup) {
          concurrentMutationsSetup.sender.client.ws.disconnect();
          concurrentMutationsSetup.receiver.client.ws.disconnect();
          concurrentMutationsSetup = null;
        }
        if (infra) {
          await teardownBenchmarkInfrastructure(infra);
          infra = null;
        }
      },
    }
  );

  bench(
    "deep nested query subscription + mutation broadcast latency",
    async () => {
      const { sender, receiver, postId, authorId } = deepNestedQuerySetup!;

      const commentId = generateId();

      await measureMutationLatency(
        sender,
        receiver,
        () => {
          sender.store.mutate.comments.insert({
            id: commentId,
            content: "Deep nested query comment",
            postId,
            authorId,
          });
        },
        commentId
      );
    },
    {
      setup: async () => {
        infra = await setupBenchmarkInfrastructure();
        await primeDatabase(infra, 50);

        const sender = await createWSClientAndWait(infra.serverPort);
        const receiver = await createWSClientAndWait(infra.serverPort);

        // Subscribe receiver to deep nested query
        receiver.client.load(
          receiver.store.query.orgs
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

        // Wait a bit for subscription to be established
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Get a post and user for the comment
        const posts = await infra.fetchClient!.query.posts.get();
        const users = await infra.fetchClient!.query.users.get();

        if (posts.length === 0 || users.length === 0) {
          throw new Error("Database must be primed with data");
        }

        deepNestedQuerySetup = {
          sender,
          receiver,
          postId: posts[0].id,
          authorId: users[0].id,
        };
      },
      teardown: async () => {
        if (deepNestedQuerySetup) {
          deepNestedQuerySetup.sender.client.ws.disconnect();
          deepNestedQuerySetup.receiver.client.ws.disconnect();
          deepNestedQuerySetup = null;
        }
        if (infra) {
          await teardownBenchmarkInfrastructure(infra);
          infra = null;
        }
      },
    }
  );
});
