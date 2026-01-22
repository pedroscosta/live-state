import { renderHook } from "@testing-library/react-hooks";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  Mock,
  test,
  vi,
} from "vitest";
import { QueryBuilder } from "../../src/core/query";
import { useLiveQuery, useLoadData } from "../../src/client/react";
import { Client } from "../../src/client/websocket/client";
import { AnyRouter } from "../../src/server";

describe("useLiveQuery", () => {
  let mockQueryBuilder: QueryBuilder<any, any>;
  let mockSubscribe: Mock;
  let mockGet: Mock;
  let mockUnsubscribe: Mock;

  beforeEach(() => {
    const random = Math.random();
    const getResult = [{ name: "John", age: 30 }];
    mockUnsubscribe = vi.fn();
    mockSubscribe = vi.fn(() => mockUnsubscribe);
    mockGet = vi.fn(() => getResult);

    mockQueryBuilder = {
      get: mockGet,
      subscribe: mockSubscribe,
      buildQueryRequest: vi.fn(() => ({
        resource: "users" + random,
        where: {},
        include: {},
      })),
    } as unknown as QueryBuilder<any, any>;
  });

  afterEach(async () => {
    vi.clearAllMocks();
  });

  test("should initialize with query result", () => {
    const { result } = renderHook(() => useLiveQuery(mockQueryBuilder));

    expect(result.current).toEqual([{ name: "John", age: 30 }]);
    expect(mockGet).toHaveBeenCalled();
  });

  test("should subscribe to query changes on mount", () => {
    renderHook(() => useLiveQuery(mockQueryBuilder));

    expect(mockSubscribe).toHaveBeenCalledWith(expect.any(Function));
  });

  test("should update state when query result changes", () => {
    const { result } = renderHook(() => useLiveQuery(mockQueryBuilder));

    // Initial value
    expect(result.current).toEqual([{ name: "John", age: 30 }]);

    // Simulate query result change
    const newValue = [{ name: "Jane", age: 25 }];
    mockGet.mockReturnValue(newValue);

    // Get the callback passed to subscribe and call it
    const subscribeCallback = mockSubscribe.mock.calls[0][0];
    subscribeCallback();

    // Re-render to get updated value
    const { result: newResult } = renderHook(() =>
      useLiveQuery(mockQueryBuilder)
    );
    expect(newResult.current).toEqual(newValue);
  });

  test("should handle subscription lifecycle correctly", async () => {
    const { result, unmount } = renderHook(() =>
      useLiveQuery(mockQueryBuilder)
    );

    // Should get initial value
    expect(result.current).toEqual([{ name: "John", age: 30 }]);
    expect(mockGet).toHaveBeenCalled();
    expect(mockSubscribe).toHaveBeenCalled();

    // Should unsubscribe on unmount
    unmount();

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(mockUnsubscribe).toHaveBeenCalled();
  });

  test("should handle query builder changes", () => {
    const { rerender } = renderHook(
      ({ queryBuilder }) => useLiveQuery(queryBuilder),
      {
        initialProps: { queryBuilder: mockQueryBuilder },
      }
    );

    const getResult = [{ name: "Updated", age: 35 }];
    // Change the query builder reference
    const newMockQueryBuilder = {
      get: vi.fn(() => getResult),
      subscribe: vi.fn(() => vi.fn()),
      buildQueryRequest: vi.fn(() => ({
        resource: "users",
        where: { active: true },
        include: {},
      })),
    };

    rerender({
      queryBuilder: newMockQueryBuilder as unknown as QueryBuilder<any, any>,
    });

    expect(newMockQueryBuilder.get).toHaveBeenCalled();
    expect(newMockQueryBuilder.subscribe).toHaveBeenCalled();
  });

  test("should unsubscribe on unmount", async () => {
    const { unmount } = renderHook(() => useLiveQuery(mockQueryBuilder));

    expect(mockSubscribe).toHaveBeenCalled();

    unmount();

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(mockUnsubscribe).toHaveBeenCalled();
  });

  test("should handle subscription sharing through Store", async () => {
    // Test that multiple hooks with the same query share subscriptions
    const { unmount: unmount1 } = renderHook(() =>
      useLiveQuery(mockQueryBuilder)
    );
    const { unmount: unmount2 } = renderHook(() =>
      useLiveQuery(mockQueryBuilder)
    );

    // Both should use the same subscription due to Store deduplication
    expect(mockSubscribe).toHaveBeenCalled();

    // Unmounting one shouldn't unsubscribe yet
    unmount1();

    // Unmounting the last one should unsubscribe
    unmount2();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(mockUnsubscribe).toHaveBeenCalled();
  });

  test("should handle multiple subscription updates", () => {
    const { result } = renderHook(() => useLiveQuery(mockQueryBuilder));

    // Get the callback and call it multiple times
    const subscribeCallback = mockSubscribe.mock.calls[0][0];

    // First update
    mockGet.mockReturnValue([{ name: "First", age: 1 }]);
    subscribeCallback();

    // Second update
    mockGet.mockReturnValue([{ name: "Second", age: 2 }]);
    subscribeCallback();

    // The hook should reflect the latest data
    expect(mockGet).toHaveBeenCalled();
  });

  test("should work with different query result types", () => {
    const getResult = "test string";
    const stringQueryBuilder = {
      get: vi.fn(() => getResult),
      subscribe: vi.fn(() => vi.fn()),
      buildQueryRequest: vi.fn(() => ({ resource: "strings", where: {}, include: {} })),
    } as unknown as QueryBuilder<any, any>;

    const { result } = renderHook(() => useLiveQuery(stringQueryBuilder));

    expect(result.current).toBe(getResult);
    expect(stringQueryBuilder.get).toHaveBeenCalled();
    expect(stringQueryBuilder.subscribe).toHaveBeenCalled();
  });

  test("should work with array query results", () => {
    const getResult = [1, 2, 3];
    const arrayQueryBuilder = {
      get: vi.fn(() => getResult),
      subscribe: vi.fn(() => vi.fn()),
      buildQueryRequest: vi.fn(() => ({ resource: "numbers", where: {}, include: {} })),
    } as unknown as QueryBuilder<any, any>;

    const { result } = renderHook(() => useLiveQuery(arrayQueryBuilder));

    expect(result.current).toEqual(getResult);
    expect(arrayQueryBuilder.get).toHaveBeenCalled();
    expect(arrayQueryBuilder.subscribe).toHaveBeenCalled();
  });
});

describe("useLoadData", () => {
  let mockClient: Pick<Client<AnyRouter>["client"], "load">;
  let mockQueryBuilder: Pick<QueryBuilder<any, any>, "buildQueryRequest">;
  let mockUnsubscribe: Mock;

  beforeEach(() => {
    mockUnsubscribe = vi.fn();
    mockClient = {
      load: vi.fn(() => mockUnsubscribe),
    };
    mockQueryBuilder = {
      buildQueryRequest: vi.fn(() => ({
        resource: "users",
        where: {},
        include: {},
      })),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("should call client.load with built query on mount", () => {
    renderHook(() => useLoadData(mockClient as any, mockQueryBuilder as any));

    expect(mockQueryBuilder.buildQueryRequest).toHaveBeenCalledTimes(1);
    expect(mockClient.load).toHaveBeenCalledTimes(1);
    expect(mockClient.load).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: "users",
      })
    );
  });

  test("should not recall client.load when rerendered with same query", () => {
    const { rerender } = renderHook(
      ({ query }) => useLoadData(mockClient as any, query as any),
      {
        initialProps: { query: mockQueryBuilder },
      }
    );

    rerender({ query: mockQueryBuilder });

    expect(mockClient.load).toHaveBeenCalledTimes(1);
  });

  test("should call client.load again when query changes", () => {
    const { rerender } = renderHook(
      ({ query }) => useLoadData(mockClient as any, query as any),
      {
        initialProps: { query: mockQueryBuilder },
      }
    );

    const newQuery = {
      buildQueryRequest: vi.fn(() => ({
        resource: "posts",
        where: { published: true },
        include: {},
      })),
    };

    rerender({ query: newQuery as any });

    expect(mockClient.load).toHaveBeenCalledTimes(2);
    expect(newQuery.buildQueryRequest).toHaveBeenCalledTimes(1);
    expect(mockClient.load).toHaveBeenLastCalledWith(
      expect.objectContaining({
        resource: "posts",
        where: { published: true },
      })
    );
  });

  test("should accept custom query requests", () => {
    const customQuery = {
      buildQueryRequest: vi.fn(() => ({
        resource: "users",
        procedure: "getActiveUsers",
        input: { active: true },
      })),
    };

    renderHook(() => useLoadData(mockClient as any, customQuery as any));

    expect(mockClient.load).toHaveBeenCalledTimes(1);
    expect(mockClient.load).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: "users",
        procedure: "getActiveUsers",
        input: { active: true },
      })
    );
  });

  test("should unsubscribe on unmount", () => {
    const { unmount } = renderHook(() =>
      useLoadData(mockClient as any, mockQueryBuilder as any)
    );

    unmount();

    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });
});
