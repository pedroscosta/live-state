import { xxHash32 } from "js-xxhash";
import { expect, test, vi } from "vitest";
import { hash } from "../src/utils";

vi.mock("js-xxhash", () => ({
  xxHash32: vi.fn(),
}));

test("should hash an object", () => {
  const obj = { name: "John", age: 30 };

  (xxHash32 as any).mockImplementation((input: string) => `hashed-${input}`);

  const result = hash(obj);
  const expectedHash = `hashed-${JSON.stringify(obj)}`;

  expect(result).toStrictEqual(expectedHash);
  expect(xxHash32).toHaveBeenCalledWith(JSON.stringify(obj));
});
