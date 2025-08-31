import { sha256 } from "crypto-hash";
import { expect, test, vi } from "vitest";
import { hash } from "../src/utils";

vi.mock("crypto-hash", () => ({
  sha256: vi.fn()
}));

test("should hash an object", async () => {
  const obj = { name: "John", age: 30 };
  
  (sha256 as any).mockImplementation((input: string) => 
    Promise.resolve(`hashed-${input}`)
  );

  const result = await hash(obj);
  const expectedHash = `hashed-${JSON.stringify(obj)}`;

  expect(result).toStrictEqual(expectedHash);
  expect(sha256).toHaveBeenCalledWith(JSON.stringify(obj));
});
