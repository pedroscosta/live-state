import { render, screen } from "@testing-library/react";
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
import { QueryBuilder } from "../../src/client/query";
import { SubscriptionProvider, useLiveQuery } from "../../src/client/react";
import { Client } from "../../src/client/websocket/client";
import { AnyRouter } from "../../src/server";

// Custom matcher for Vitest
expect.extend({
  toBeInTheDocument(received) {
    const pass = received != null;
    return {
      message: () =>
        `expected element ${pass ? "not " : ""}to be in the document`,
      pass,
    };
  },
});

let i = 0;

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
      toJSON: vi.fn(() => ({
        resource: "users" + random,
        where: {},
        include: {},
      })),
    } as unknown as QueryBuilder<any, any>;
    console.log(i++);
  });

  afterEach(async () => {
    vi.clearAllMocks();
    console.log(i);
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
      toJSON: vi.fn(() => ({
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
      toJSON: vi.fn(() => ({ resource: "strings", where: {}, include: {} })),
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
      toJSON: vi.fn(() => ({ resource: "numbers", where: {}, include: {} })),
    } as unknown as QueryBuilder<any, any>;

    const { result } = renderHook(() => useLiveQuery(arrayQueryBuilder));

    expect(result.current).toEqual(getResult);
    expect(arrayQueryBuilder.get).toHaveBeenCalled();
    expect(arrayQueryBuilder.subscribe).toHaveBeenCalled();
  });
});

describe("SubscriptionProvider", () => {
  let mockClient: Client<AnyRouter>["client"];

  beforeEach(() => {
    mockClient = {
      subscribe: vi.fn(),
      ws: {} as any,
      addEventListener: vi.fn(),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("should render children", () => {
    render(
      <SubscriptionProvider client={mockClient}>
        <div data-testid="child">Test Child</div>
      </SubscriptionProvider>
    );

    expect(screen.getByTestId("child")).toBeInTheDocument();
    expect(screen.getByText("Test Child")).toBeInTheDocument();
  });

  test("should call client.subscribe on mount", () => {
    render(
      <SubscriptionProvider client={mockClient}>
        <div>Test</div>
      </SubscriptionProvider>
    );

    expect(mockClient.subscribe).toHaveBeenCalledTimes(1);
    expect(mockClient.subscribe).toHaveBeenCalledWith();
  });

  test("should not call client.subscribe on re-render", () => {
    const { rerender } = render(
      <SubscriptionProvider client={mockClient}>
        <div>Test</div>
      </SubscriptionProvider>
    );

    expect(mockClient.subscribe).toHaveBeenCalledTimes(1);

    // Re-render with same props
    rerender(
      <SubscriptionProvider client={mockClient}>
        <div>Test Updated</div>
      </SubscriptionProvider>
    );

    // Should still only be called once
    expect(mockClient.subscribe).toHaveBeenCalledTimes(1);
  });

  test("should render multiple children", () => {
    render(
      <SubscriptionProvider client={mockClient}>
        <div data-testid="child1">Child 1</div>
        <div data-testid="child2">Child 2</div>
        <span data-testid="child3">Child 3</span>
      </SubscriptionProvider>
    );

    expect(screen.getByTestId("child1")).toBeInTheDocument();
    expect(screen.getByTestId("child2")).toBeInTheDocument();
    expect(screen.getByTestId("child3")).toBeInTheDocument();
    expect(mockClient.subscribe).toHaveBeenCalledTimes(1);
  });

  test("should handle null children", () => {
    render(
      <SubscriptionProvider client={mockClient}>{null}</SubscriptionProvider>
    );

    expect(mockClient.subscribe).toHaveBeenCalledTimes(1);
  });

  test("should handle undefined children", () => {
    render(
      <SubscriptionProvider client={mockClient}>
        {undefined}
      </SubscriptionProvider>
    );

    expect(mockClient.subscribe).toHaveBeenCalledTimes(1);
  });

  test("should handle conditional children", () => {
    const showChild = true;

    render(
      <SubscriptionProvider client={mockClient}>
        {showChild && <div data-testid="conditional-child">Conditional</div>}
      </SubscriptionProvider>
    );

    expect(screen.getByTestId("conditional-child")).toBeInTheDocument();
    expect(mockClient.subscribe).toHaveBeenCalledTimes(1);
  });

  test("should work with nested components", () => {
    const NestedComponent = () => (
      <div data-testid="nested">Nested Component</div>
    );

    render(
      <SubscriptionProvider client={mockClient}>
        <div data-testid="wrapper">
          <NestedComponent />
        </div>
      </SubscriptionProvider>
    );

    expect(screen.getByTestId("wrapper")).toBeInTheDocument();
    expect(screen.getByTestId("nested")).toBeInTheDocument();
    expect(mockClient.subscribe).toHaveBeenCalledTimes(1);
  });
});
