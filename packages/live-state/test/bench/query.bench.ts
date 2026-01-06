import { bench, describe } from "vitest";
import {
  setupBenchmarkInfrastructure,
  teardownBenchmarkInfrastructure,
  primeDatabase,
} from "./utils";
import type { BenchmarkInfrastructure } from "./utils";

// Global infrastructure state for benchmarks
let infra: BenchmarkInfrastructure | null = null;

describe("live-state query benchmarks", () => {
  bench(
    "nested include query - orgs with posts, comments, and authors",
    async () => {
      await infra!
        .fetchClient!.query.orgs.include({
          posts: {
            comments: {
              author: true,
            },
            author: true,
          },
        })
        .get();
    },
    {
      setup: async () => {
        infra = await setupBenchmarkInfrastructure();
        await primeDatabase(infra, 50); // Use 50 records for benchmarks
      },
      teardown: async () => {
        if (infra) {
          await teardownBenchmarkInfrastructure(infra);
          infra = null;
        }
      },
    }
  );

  bench(
    "simple query - fetch all users",
    async () => {
      await infra!.fetchClient!.query.users.get();
    },
    {
      setup: async () => {
        infra = await setupBenchmarkInfrastructure();
        await primeDatabase(infra, 50);
      },
      teardown: async () => {
        if (infra) {
          await teardownBenchmarkInfrastructure(infra);
          infra = null;
        }
      },
    }
  );

  bench(
    "shallow include - posts with author",
    async () => {
      await infra!
        .fetchClient!.query.posts.include({
          author: true,
        })
        .get();
    },
    {
      setup: async () => {
        infra = await setupBenchmarkInfrastructure();
        await primeDatabase(infra, 50);
      },
      teardown: async () => {
        if (infra) {
          await teardownBenchmarkInfrastructure(infra);
          infra = null;
        }
      },
    }
  );
});
