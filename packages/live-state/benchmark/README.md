# Live-State Benchmark Suite

This benchmark script measures the performance of various live-state operations based on the e2e test suite.

## Prerequisites

- PostgreSQL database running on `localhost:5432`
- Database `live_state_e2e_test` must exist
- Database credentials: `admin:admin`

## Usage

Run benchmarks using pnpm:

```bash
pnpm benchmark [options]
```

### Options

- `--mode=<mode>`: Benchmark mode to run (default: `all`)
  - `empty-query`: Empty query benchmarks
  - `query-with-data`: Query with data benchmarks
  - `shallow-include-one`: Shallow include (one relation) benchmarks
  - `shallow-include-many`: Shallow include (many relation) benchmarks
  - `nested-include`: Nested include benchmarks
  - `mutation-insert`: Insert mutation benchmarks
  - `mutation-update`: Update mutation benchmarks
  - `multi-client-sync`: Multi-client synchronization benchmarks
  - `all`: Run all benchmarks (default)

- `--iterations=<number>`: Number of iterations to run (default: `10`)

- `--data-size=<number>`: Number of records to create for data benchmarks (default: `10`)

- `--client=<type>`: Client type to benchmark (default: `both`)
  - `ws`: WebSocket client only
  - `fetch`: Fetch client only
  - `both`: Both clients (default)

## Examples

Run all benchmarks with default settings:
```bash
pnpm benchmark
```

Run empty query benchmark with 100 iterations:
```bash
pnpm benchmark --mode=empty-query --iterations=100
```

Run query with data benchmark using WebSocket client only:
```bash
pnpm benchmark --mode=query-with-data --client=ws --data-size=100 --iterations=50
```

Run mutation benchmarks:
```bash
pnpm benchmark --mode=mutation-insert --iterations=50
```

## Output

The benchmark outputs the following metrics for each mode:

- **Total Time**: Total execution time for all iterations
- **Average Time**: Average time per iteration
- **Min Time**: Minimum iteration time
- **Max Time**: Maximum iteration time
- **P50**: 50th percentile (median)
- **P95**: 95th percentile
- **P99**: 99th percentile
- **Throughput**: Operations per second

## Benchmark Modes Explained

### empty-query
Measures the performance of querying an empty collection. Tests the overhead of query execution without data processing.

### query-with-data
Measures query performance with varying amounts of data. Useful for understanding how performance scales with data size.

### shallow-include-one
Benchmarks queries that include a single related entity (one-to-one or many-to-one relations).

### shallow-include-many
Benchmarks queries that include multiple related entities (one-to-many relations).

### nested-include
Measures performance of queries with nested includes (e.g., users -> posts -> author).

### mutation-insert
Benchmarks the performance of insert mutations through the WebSocket client.

### mutation-update
Benchmarks the performance of update mutations through the WebSocket client.

### multi-client-sync
Measures the time for mutations to propagate from one client to another, testing real-time synchronization performance.

### mutation-notification-shallow
Measures the latency for mutation notifications on shallow queries (simple queries without includes). Tests how quickly subscribed queries receive updates when mutations occur.

### mutation-notification-deep
Measures the latency for mutation notifications on deep queries (queries with nested includes). Tests how quickly complex subscribed queries receive updates when mutations occur on related resources.

