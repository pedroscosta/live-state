import { sha256 } from "crypto-hash";
import { expect, test } from "vitest";
import { hash } from "../src/utils";

test("should hash an object", async () => {
  const obj = { name: "John", age: 30 };

  expect(await hash(obj)).toStrictEqual(await sha256(JSON.stringify(obj)));
});
