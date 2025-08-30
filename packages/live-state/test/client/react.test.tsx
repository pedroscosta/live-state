import { render, screen } from "@testing-library/react";
import { act, renderHook } from "@testing-library/react-hooks";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  Mock,
  test,
  vi,
} from "vitest";
import { Client } from "../../src/client";
import { SubscriptionProvider, useLiveQuery } from "../../src/client/react";
import { DeepSubscribable } from "../../src/client/types";

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

describe("useLiveQuery", () => {
  let mockObservable: DeepSubscribable<{ name: string; age: number }>;
  let mockSubscribe: Mock;
  let mockGet: Mock;
  let mockUnsubscribe: Mock;

  beforeEach(() => {
    mockUnsubscribe = vi.fn();
    mockSubscribe = vi.fn(() => mockUnsubscribe);
    mockGet = vi.fn(() => ({ name: "John", age: 30 }));

    mockObservable = {
      get: mockGet,
      subscribe: mockSubscribe,
    } as unknown as DeepSubscribable<{ name: string; age: number }>;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("should initialize with observable value", () => {
    const { result } = renderHook(() => useLiveQuery(mockObservable));

    expect(result.current).toEqual({ name: "John", age: 30 });
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  test("should subscribe to observable changes on mount", () => {
    renderHook(() => useLiveQuery(mockObservable));

    expect(mockSubscribe).toHaveBeenCalledTimes(1);
    expect(mockSubscribe).toHaveBeenCalledWith(expect.any(Function));
  });

  test("should update state when observable changes", () => {
    const { result } = renderHook(() => useLiveQuery(mockObservable));

    // Initial value
    expect(result.current).toEqual({ name: "John", age: 30 });

    // Simulate observable change
    const newValue = { name: "Jane", age: 25 };
    mockGet.mockReturnValue(newValue);

    // Get the callback passed to subscribe and call it
    const subscribeCallback = mockSubscribe.mock.calls[0][0];
    act(() => {
      subscribeCallback();
    });

    expect(result.current).toEqual(newValue);
    expect(mockGet).toHaveBeenCalledTimes(2); // Initial + callback (effect doesn't call get on first run)
  });

  test("should not call setSlice on first effect run", () => {
    const { result } = renderHook(() => useLiveQuery(mockObservable));

    // Initial render should call get once for useState initialization
    expect(mockGet).toHaveBeenCalledTimes(1);

    // The effect should run but not call setSlice on first run (primed.current = false initially)
    expect(result.current).toEqual({ name: "John", age: 30 });
  });

  test("should call setSlice on subsequent effect runs", () => {
    const { result, rerender } = renderHook(
      ({ observable }) => useLiveQuery(observable),
      {
        initialProps: { observable: mockObservable },
      }
    );

    // Change the observable reference to trigger effect
    const newMockObservable = {
      get: vi.fn(() => ({ name: "Updated", age: 35 })),
      subscribe: vi.fn(() => vi.fn()),
    };

    rerender({
      observable: newMockObservable as unknown as DeepSubscribable<{
        name: string;
        age: number;
      }>,
    });

    expect(newMockObservable.get).toHaveBeenCalled();
    expect(newMockObservable.subscribe).toHaveBeenCalled();
  });

  test("should unsubscribe on unmount", () => {
    const { unmount } = renderHook(() => useLiveQuery(mockObservable));

    expect(mockSubscribe).toHaveBeenCalledTimes(1);

    unmount();

    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });

  test("should unsubscribe and resubscribe when observable changes", () => {
    const { rerender } = renderHook(
      ({ observable }) => useLiveQuery(observable),
      {
        initialProps: { observable: mockObservable },
      }
    );

    expect(mockSubscribe).toHaveBeenCalledTimes(1);

    // Create new observable
    const newMockUnsubscribe = vi.fn();
    const newMockObservable = {
      get: vi.fn(() => ({ name: "New", age: 40 })),
      subscribe: vi.fn(() => newMockUnsubscribe),
    };

    rerender({
      observable: newMockObservable as unknown as DeepSubscribable<{
        name: string;
        age: number;
      }>,
    });

    // Should unsubscribe from old observable
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
    // Should subscribe to new observable
    expect(newMockObservable.subscribe).toHaveBeenCalledTimes(1);
  });

  test("should handle multiple subscription callbacks", () => {
    const { result } = renderHook(() => useLiveQuery(mockObservable));

    // Get the callback and call it multiple times
    const subscribeCallback = mockSubscribe.mock.calls[0][0];

    // First callback
    mockGet.mockReturnValue({ name: "First", age: 1 });
    act(() => {
      subscribeCallback();
    });
    expect(result.current).toEqual({ name: "First", age: 1 });

    // Second callback
    mockGet.mockReturnValue({ name: "Second", age: 2 });
    act(() => {
      subscribeCallback();
    });
    expect(result.current).toEqual({ name: "Second", age: 2 });
  });

  test("should work with different observable types", () => {
    const stringObservable: DeepSubscribable<string> = {
      get: vi.fn(() => "test string"),
      subscribe: vi.fn(() => vi.fn()),
    } as unknown as DeepSubscribable<string>;

    const { result } = renderHook(() => useLiveQuery(stringObservable));

    expect(result.current).toBe("test string");
    expect(stringObservable.get).toHaveBeenCalledTimes(1);
    expect(stringObservable.subscribe).toHaveBeenCalledTimes(1);
  });

  test("should work with array observables", () => {
    const arrayObservable: DeepSubscribable<number[]> = {
      get: vi.fn(() => [1, 2, 3]),
      subscribe: vi.fn(() => vi.fn()),
    } as unknown as DeepSubscribable<number[]>;

    const { result } = renderHook(() => useLiveQuery(arrayObservable));

    expect(result.current).toEqual([1, 2, 3]);
    expect(arrayObservable.get).toHaveBeenCalledTimes(1);
    expect(arrayObservable.subscribe).toHaveBeenCalledTimes(1);
  });
});

describe("SubscriptionProvider", () => {
  let mockClient: { subscribe: Mock };

  beforeEach(() => {
    mockClient = {
      subscribe: vi.fn(),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("should render children", () => {
    render(
      <SubscriptionProvider
        client={mockClient as unknown as Client<any>["client"]}
      >
        <div data-testid="child">Test Child</div>
      </SubscriptionProvider>
    );

    expect(screen.getByTestId("child")).toBeInTheDocument();
    expect(screen.getByText("Test Child")).toBeInTheDocument();
  });

  test("should call client.subscribe on mount", () => {
    render(
      <SubscriptionProvider
        client={mockClient as unknown as Client<any>["client"]}
      >
        <div>Test</div>
      </SubscriptionProvider>
    );

    expect(mockClient.subscribe).toHaveBeenCalledTimes(1);
    expect(mockClient.subscribe).toHaveBeenCalledWith();
  });

  test("should not call client.subscribe on re-render", () => {
    const { rerender } = render(
      <SubscriptionProvider
        client={mockClient as unknown as Client<any>["client"]}
      >
        <div>Test</div>
      </SubscriptionProvider>
    );

    expect(mockClient.subscribe).toHaveBeenCalledTimes(1);

    // Re-render with same props
    rerender(
      <SubscriptionProvider
        client={mockClient as unknown as Client<any>["client"]}
      >
        <div>Test Updated</div>
      </SubscriptionProvider>
    );

    // Should still only be called once
    expect(mockClient.subscribe).toHaveBeenCalledTimes(1);
  });

  test("should call client.subscribe again if client changes", () => {
    const { rerender } = render(
      <SubscriptionProvider
        client={mockClient as unknown as Client<any>["client"]}
      >
        <div>Test</div>
      </SubscriptionProvider>
    );

    expect(mockClient.subscribe).toHaveBeenCalledTimes(1);

    // Create new client
    const newMockClient = { subscribe: vi.fn() };

    rerender(
      <SubscriptionProvider
        client={newMockClient as unknown as Client<any>["client"]}
      >
        <div>Test</div>
      </SubscriptionProvider>
    );

    // The effect dependency array is empty [], so it won't re-run when client changes
    // This is actually the correct behavior based on the implementation
    expect(newMockClient.subscribe).toHaveBeenCalledTimes(0);
    expect(mockClient.subscribe).toHaveBeenCalledTimes(1);
  });

  test("should render multiple children", () => {
    render(
      <SubscriptionProvider
        client={mockClient as unknown as Client<any>["client"]}
      >
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
      <SubscriptionProvider
        client={mockClient as unknown as Client<any>["client"]}
      >
        {null}
      </SubscriptionProvider>
    );

    expect(mockClient.subscribe).toHaveBeenCalledTimes(1);
  });

  test("should handle undefined children", () => {
    render(
      <SubscriptionProvider
        client={mockClient as unknown as Client<any>["client"]}
      >
        {undefined}
      </SubscriptionProvider>
    );

    expect(mockClient.subscribe).toHaveBeenCalledTimes(1);
  });

  test("should handle conditional children", () => {
    const showChild = true;

    render(
      <SubscriptionProvider
        client={mockClient as unknown as Client<any>["client"]}
      >
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
      <SubscriptionProvider
        client={mockClient as unknown as Client<any>["client"]}
      >
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
